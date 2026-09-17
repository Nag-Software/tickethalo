'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createShow, updateShowStatus } from '@/lib/actions/shows'
import { acceptBookingOfferById, automateFullbookedShow, bookShow, cancelConfirmedSpotForOffer, runAutomaticBookingForShow, sendFallbackOffersForShow, sendManualBookingOffer, sendOffersForReopenedRequirement } from '@/lib/actions/booking'
import { runAfterResponse } from '@/lib/background'
import { assertOfferAccess, assertRequirementAccess, assertShowAccess, assertSpotAccess, getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { assertArtistBookableForShow } from '@/lib/club-artists'
import { canonicalRoleLabel } from '@/lib/artist-roles'
import { defaultLineupSpots } from '@/lib/lineup-defaults'
import { normalizeCurrency } from '@/lib/currencies'
import { assertClubCanSell } from '@/lib/stripe-connect'
import { MARKETING_DESIGN_BUCKET, sanitizeStorageFileName } from '@/lib/marketing/storage'
import { getAuthUser, getSessionProfile } from '@/lib/session'
import { refundShow } from '@/lib/refunds'
import {
  CheckoutSessionExpiryError,
  checkShowDetailsChange,
  deleteShowBlockedMessage,
  earliestOutstandingSaleAt,
  expireOpenCheckoutSessions,
  getShowSalesOverview,
  getShowSalesSummary,
  hasOutstandingSales,
  hasRefundableSales,
  isTicketSalesStopped,
  resumeTicketSales,
  stopSalesBeforeDeletion,
  stopTicketSales,
  toShowSalesOverviewDto,
  type ShowSalesOverviewDto,
} from '@/lib/show-sales'
import { ticketSalesState } from '@/lib/ticket-sales'
import type { BookingOfferStatus, ConfirmedSpotStatus, MarketingDesignFileType, MarketingDesignKind, RequirementCompensationType, RequirementEnergy, RequirementGender, ShowStatus } from '@/types/database'

export type ManualSpotActionState = {
  status: 'idle' | 'success' | 'error'
  message: string | null
  submittedAt: number | null
}

function manualSpotState(status: ManualSpotActionState['status'], message: string): ManualSpotActionState {
  return { status, message, submittedAt: Date.now() }
}

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function optionalInteger(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? Number(text) : null
}

function optionalMoneyToMinor(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim().replace(',', '.')
  return text.length > 0 ? Math.round(Number(text) * 100) : null
}

function optionalDecimal(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim().replace(',', '.')
  return text.length > 0 ? Number(text) : null
}

function optionalCompensationType(value: FormDataEntryValue | null): RequirementCompensationType | null {
  return value === 'fixed' || value === 'percent' ? value : null
}

/**
 * Taket for hvor mye av billettinntekten lineupen kan love bort.
 *
 * Det er klubbens `artist_share_bps` — den samme potten honorar-kjøringen
 * fordeler etter showet (migrasjon 035/036). Sto grensen på 100 % her, kunne
 * en booker avtale mer enn det som faktisk blir utbetalt, og prosentene ble
 * skalert ned uten at noen hadde sagt det.
 */
async function artistSharePercent(showId: string) {
  const db = createAdminClient()
  const { data: show } = await db.from('shows').select('club_id').eq('id', showId).maybeSingle()
  if (!show?.club_id) return 100

  const { data: club } = await db
    .from('clubs')
    .select('artist_share_bps')
    .eq('id', show.club_id)
    .maybeSingle()

  return (club?.artist_share_bps ?? 10000) / 100
}

async function ensurePercentAllocationWithinLimit(
  showId: string,
  nextPercent: number | null,
  reqId?: string
) {
  if (nextPercent == null) {
    return
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('show_requirements')
    .select('id, compensation_type, compensation_percent')
    .eq('show_id', showId)

  if (error) {
    throw new Error(error.message)
  }

  const currentTotal = (data ?? []).reduce((sum, requirement) => {
    if (reqId && requirement.id === reqId) {
      return sum
    }

    if (requirement.compensation_type !== 'percent') {
      return sum
    }

    return sum + Number(requirement.compensation_percent ?? 0)
  }, 0)

  const limit = await artistSharePercent(showId)
  if (currentTotal + nextPercent > limit + 0.0001) {
    throw new Error(`Total percentage for the lineup cannot exceed ${limit}% of ticket sales.`)
  }
}

async function nextLineupPosition(showId: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('show_requirements')
    .select('lineup_position')
    .eq('show_id', showId)
    .order('lineup_position', { ascending: false })
    .limit(1)

  if (error) {
    throw new Error(error.message)
  }

  return Math.max(1, (data?.[0]?.lineup_position ?? 0) + 1)
}

async function normalizeRequirementPositions(showId: string) {
  const db = createAdminClient()
  const { data, error } = await db
    .from('show_requirements')
    .select('id')
    .eq('show_id', showId)
    .order('lineup_position')
    .order('created_at')

  if (error) {
    throw new Error(error.message)
  }

  const results = await Promise.all(
    (data ?? []).map((requirement, index) =>
      db
        .from('show_requirements')
        .update({ lineup_position: index + 1 })
        .eq('id', requirement.id)
        .eq('show_id', showId)
    )
  )

  const firstError = results.find((result) => result.error)?.error
  if (firstError) {
    throw new Error(firstError.message)
  }
}

async function getRequirementWriteInput(formData: FormData, showId: string) {
  const compensationType = optionalCompensationType(formData.get('compensation_type'))
  const compensationAmount = compensationType === 'fixed'
    ? optionalMoneyToMinor(formData.get('compensation_amount'))
    : null
  const compensationPercent = compensationType === 'percent'
    ? optionalDecimal(formData.get('compensation_percent'))
    : null

  if (compensationPercent != null && (Number.isNaN(compensationPercent) || compensationPercent < 0 || compensationPercent > 100)) {
    throw new Error('Percentage must be between 0 and 100.')
  }

  if (compensationAmount != null && (Number.isNaN(compensationAmount) || compensationAmount < 0)) {
    throw new Error('A fixed amount must be 0 or higher.')
  }

  return {
    role_name: canonicalRoleLabel(String(formData.get('role_name') ?? '').trim()) ?? '',
    quantity: Math.max(1, Number(formData.get('quantity') ?? 1)),
    lineup_position: Math.max(1, Number(formData.get('lineup_position') ?? (await nextLineupPosition(showId)))),
    min_score: optionalInteger(formData.get('min_score')),
    energy_level: ((formData.get('energy_level') as RequirementEnergy | null) ?? 'any'),
    required_gender: ((formData.get('required_gender') as RequirementGender | null) ?? 'any'),
    // Står som streng i skjemaet — en avslått checkbox sender ingenting, og
    // `'false'` er sant som streng. Sammenlikningen må derfor være eksplisitt.
    submissions_open: String(formData.get('submissions_open') ?? '') === 'true',
    compensation_type: compensationType,
    compensation_amount: compensationAmount,
    compensation_percent: compensationPercent,
  }
}

function scheduleShowAutomation(showId: string, reason: string) {
  runAfterResponse(`show-automation-${reason}-${showId}`, async () => {
    await runAutomaticBookingForShow(showId)
    revalidatePath(`/admin-app/shows/${showId}`)
    revalidatePath('/admin-app/bookings')
    revalidatePath('/admin-app')
  })
}

function scheduleFullbookedAutomation(showId: string, reason: string) {
  runAfterResponse(`fullbooked-automation-${reason}-${showId}`, async () => {
    await automateFullbookedShow(showId)
    revalidatePath(`/admin-app/shows/${showId}`)
    revalidatePath('/admin-app/marketing')
    revalidatePath('/admin-app')
  })
}

async function excludeArtistFromAutomaticBooking(
  db: ReturnType<typeof createAdminClient>,
  showId: string,
  artistId: string,
  reason: string,
) {
  const { error } = await db
    .from('show_artist_booking_exclusions')
    .upsert({ show_id: showId, artist_id: artistId, reason }, { onConflict: 'show_id,artist_id' })

  if (error) throw new Error(error.message)
}

/**
 * Opphever eksklusjonen igjen.
 *
 * Eksklusjonsraden betyr «admin tok denne artisten av showet». Velger admin
 * artisten på nytt, er det grepet angret — da skal ikke et gammelt spor stå
 * og holde automatikken unna samme person.
 */
async function clearArtistBookingExclusion(
  db: ReturnType<typeof createAdminClient>,
  showId: string,
  artistId: string,
) {
  const { error } = await db
    .from('show_artist_booking_exclusions')
    .delete()
    .eq('show_id', showId)
    .eq('artist_id', artistId)

  if (error) throw new Error(error.message)
}

/**
 * Kopierer markedsføringsfilene fra showet som klones.
 *
 * Bare filer som ligger *på* showet kopieres. Malene i klubbens bibliotek er
 * felles allerede, så de skal deles — ikke dupliseres. Peker det klonede
 * showet på en biblioteksmal, arver det nye showet samme peker.
 */
async function cloneMarketingDesigns(
  db: ReturnType<typeof createAdminClient>,
  templateShowId: string,
  newShowId: string,
) {
  const [{ data: templateShow }, { data: newShow }, { data: templateDesigns }] = await Promise.all([
    db.from('shows').select('selected_marketing_design_id').eq('id', templateShowId).single(),
    db.from('shows').select('club_id').eq('id', newShowId).single(),
    db
      .from('show_marketing_designs')
      .select('id, label, file_url, file_path, file_name, mime_type, file_type, file_size, kind, slot_count, width, height')
      .eq('show_id', templateShowId)
      .order('created_at'),
  ])

  const clubId = newShow?.club_id ?? null

  const selectedId = templateShow?.selected_marketing_design_id ?? null
  const selectedIsShowScoped = (templateDesigns ?? []).some((design) => design.id === selectedId)

  // Biblioteksmalen kopieres ikke — den arves som den er.
  let selectedMarketingDesignId: string | null =
    selectedId && !selectedIsShowScoped ? selectedId : null

  if (!templateDesigns?.length) {
    if (selectedMarketingDesignId) {
      const { error } = await db
        .from('shows')
        .update({ selected_marketing_design_id: selectedMarketingDesignId })
        .eq('id', newShowId)

      if (error) throw new Error(error.message)
    }
    return
  }

  for (const design of templateDesigns) {
    const safeName = sanitizeStorageFileName(design.file_name)
    const nextPath = `${newShowId}/${crypto.randomUUID()}-${safeName}`
    let filePath = design.file_path
    let fileUrl = design.file_url

    const { error: copyError } = await db.storage
      .from(MARKETING_DESIGN_BUCKET)
      .copy(design.file_path, nextPath)

    if (copyError) throw new Error('Could not copy the design files from the show being cloned.')

    filePath = nextPath
    const { data: urlData } = db.storage.from(MARKETING_DESIGN_BUCKET).getPublicUrl(nextPath)
    fileUrl = urlData.publicUrl

    const { data: clonedDesign, error } = await db
      .from('show_marketing_designs')
      .insert({
        show_id: newShowId,
        club_id: clubId,
        label: design.label,
        file_url: fileUrl,
        file_path: filePath,
        file_name: design.file_name,
        mime_type: design.mime_type,
        file_type: design.file_type as MarketingDesignFileType,
        file_size: design.file_size,
        kind: design.kind as MarketingDesignKind,
        slot_count: design.slot_count,
        width: design.width,
        height: design.height,
      })
      .select('id')
      .single()

    if (error) throw new Error(error.message)

    if (design.id === selectedId) {
      selectedMarketingDesignId = clonedDesign.id
    }
  }

  if (selectedMarketingDesignId) {
    const { error } = await db
      .from('shows')
      .update({ selected_marketing_design_id: selectedMarketingDesignId })
      .eq('id', newShowId)

    if (error) throw new Error(error.message)
  }
}

/**
 * Legger standardoppsettet inn i lineupen på et nytt show.
 *
 * Radene er vanlige krav — bookeren døper om, endrer honorar eller sletter
 * dem fra Lineup-fanen. Se `defaultLineupSpots` for selve oppsettet.
 */
async function seedDefaultLineup(showId: string) {
  const db = createAdminClient()
  const { error } = await db
    .from('show_requirements')
    .insert(defaultLineupSpots().map((spot) => ({ show_id: showId, ...spot })))

  // Showet er allerede opprettet her, så feilen sier hva som mangler — ikke
  // at opprettelsen feilet.
  if (error) throw new Error(`The event was created, but the standard lineup could not be added: ${error.message}`)
}

export async function createShowAction(formData: FormData) {
  const clubId = await getDefaultClubIdForAdmin()
  const input = {
    title: formData.get('title') as string,
    slug: formData.get('slug') as string,
    description: (formData.get('description') as string) || undefined,
    date: formData.get('date') as string,
    start_time: (formData.get('start_time') as string) || undefined,
    end_time: (formData.get('end_time') as string) || undefined,
    venue_address: (formData.get('venue_address') as string) || undefined,
    capacity: formData.get('capacity') ? Number(formData.get('capacity')) : undefined,
    ticket_price: formData.get('ticket_price') ? Math.round(Number(formData.get('ticket_price')) * 100) : undefined,
    currency: (formData.get('currency') as string) || 'NOK',
    club_id: clubId,
  }

  const show = await createShow(input)
  await seedDefaultLineup(show.id)
  // Standardoppsettet er det første bookeren skal se på — ikke oversikten.
  redirect(`/admin-app/shows/${show.id}?tab=lineup`)
}

export async function cloneShowAction(formData: FormData) {
  const templateId = formData.get('template_id') as string
  await assertShowAccess(templateId)
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()

  // Create the new show
  const show = await createShow({
    title: formData.get('title') as string,
    slug: formData.get('slug') as string,
    date: formData.get('date') as string,
    start_time: optionalText(formData.get('start_time')) ?? undefined,
    end_time: optionalText(formData.get('end_time')) ?? undefined,
    venue_address: optionalText(formData.get('venue_address')) ?? undefined,
    capacity: optionalInteger(formData.get('capacity')) ?? undefined,
    ticket_price: optionalMoneyToMinor(formData.get('ticket_price')) ?? undefined,
    currency: optionalText(formData.get('currency')) ?? 'NOK',
    club_id: clubId,
  })

  // Collect requirements from indexed form fields (req_0_*, req_1_*, …)
  const newReqs: Array<{
    show_id: string
    role_name: string
    quantity: number
    lineup_position: number
    min_score: number | null
    energy_level: RequirementEnergy
    required_gender: RequirementGender
    compensation_type: RequirementCompensationType | null
    compensation_amount: number | null
    compensation_percent: number | null
  }> = []

  let i = 0
  while (formData.has(`req_${i}_role_name`)) {
    const roleName = canonicalRoleLabel(String(formData.get(`req_${i}_role_name`) ?? '').trim())
    if (roleName) {
      const compensationType = optionalCompensationType(formData.get(`req_${i}_compensation_type`))
      newReqs.push({
        show_id: show.id,
        role_name: roleName,
        quantity: Math.max(1, Number(formData.get(`req_${i}_quantity`) ?? 1)),
        lineup_position: Math.max(1, Number(formData.get(`req_${i}_lineup_position`) ?? (i + 1))),
        min_score: optionalInteger(formData.get(`req_${i}_min_score`)),
        energy_level: ((formData.get(`req_${i}_energy_level`) as RequirementEnergy | null) ?? 'any'),
        required_gender: ((formData.get(`req_${i}_required_gender`) as RequirementGender | null) ?? 'any'),
        compensation_type: compensationType,
        compensation_amount: compensationType === 'fixed' ? optionalMoneyToMinor(formData.get(`req_${i}_compensation_amount`)) : null,
        compensation_percent: compensationType === 'percent' ? optionalDecimal(formData.get(`req_${i}_compensation_percent`)) : null,
      })
    }
    i++
  }

  // If no requirements in form, copy from template
  if (newReqs.length === 0) {
    const { data: templateReqs } = await db
      .from('show_requirements')
      .select('role_name, quantity, lineup_position, min_score, energy_level, required_gender, compensation_type, compensation_amount, compensation_percent')
      .eq('show_id', templateId)
      .order('lineup_position')
      .order('created_at')
    for (const r of templateReqs ?? []) {
      newReqs.push({
        show_id: show.id,
        role_name: canonicalRoleLabel(r.role_name) ?? r.role_name,
        quantity: r.quantity,
        lineup_position: r.lineup_position,
        min_score: r.min_score,
        energy_level: r.energy_level as RequirementEnergy,
        required_gender: ((r as { required_gender?: string }).required_gender as RequirementGender | undefined) ?? 'any',
        compensation_type: (r.compensation_type as RequirementCompensationType | null) ?? null,
        compensation_amount: r.compensation_amount,
        compensation_percent: r.compensation_percent,
      })
    }
  }

  if (newReqs.length > 0) {
    await db.from('show_requirements').insert(newReqs)
  } else {
    // Malen har ingen lineup å kopiere — da starter kopien på standardoppsettet,
    // som et hvilket som helst nytt show.
    await seedDefaultLineup(show.id)
  }

  await cloneMarketingDesigns(db, templateId, show.id)

  redirect(`/admin-app/shows/${show.id}?tab=lineup`)
}

export async function addRequirementAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  await assertShowAccess(showId)
  const db = createAdminClient()
  const input = await getRequirementWriteInput(formData, showId)

  await ensurePercentAllocationWithinLimit(showId, input.compensation_percent)

  const { error } = await db.from('show_requirements').insert({
    show_id: showId,
    ...input,
  })

  if (error) throw new Error(error.message)
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function startBookingAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  await assertShowAccess(showId)
  const db = createAdminClient()

  const { data: reqs, error: reqError } = await db
    .from('show_requirements')
    .select('role_name, compensation_type, compensation_amount, compensation_percent')
    .eq('show_id', showId)

  if (reqError) throw new Error(reqError.message)
  if (!reqs || reqs.length === 0) throw new Error('Add at least one lineup spot before starting booking.')

  for (const req of reqs) {
    if (!req.role_name?.trim()) throw new Error('Every lineup spot must have a role name.')
    if (!req.compensation_type) throw new Error('Every lineup spot must have a fee model set.')
  }

  const percentTotal = reqs
    .filter((r) => r.compensation_type === 'percent')
    .reduce((sum, r) => sum + (r.compensation_percent ?? 0), 0)
  const percentLimit = await artistSharePercent(showId)
  if (percentTotal > percentLimit) {
    throw new Error(`Percentage allocation exceeds ${percentLimit}% of ticket sales (${percentTotal}%).`)
  }

  await db.from('shows').update({ status: 'booking' }).eq('id', showId).eq('status', 'draft')
  scheduleShowAutomation(showId, 'manual-start')
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function sendFallbackOffersAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  await assertShowAccess(showId)
  runAfterResponse(`fallback-offers-${showId}`, async () => {
    await sendFallbackOffersForShow(showId)
    revalidatePath(`/admin-app/shows/${showId}`)
    revalidatePath('/admin-app/bookings')
  })
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function updateShowDetailsAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  const show = await assertShowAccess(showId)
  const db = createAdminClient()
  const date = String(formData.get('date') ?? '').trim()

  // The currency is not picked per show — it is registered on the club under
  // My club, and the show follows it.
  const [{ data: club }, { data: current, error: currentError }] = await Promise.all([
    show.club_id
      ? db.from('clubs').select('currency').eq('id', show.club_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from('shows')
      .select('title, date, currency, status, deleted_at, ticket_sales_closed_at')
      .eq('id', showId)
      .maybeSingle(),
  ])

  if (currentError) throw new Error(currentError.message)
  if (!current) return { error: 'This show no longer exists.' }

  // Without a club currency we leave the show's own — it must not fall back to NOK.
  const clubCurrency = club?.currency ? normalizeCurrency(club.currency) : null

  // Salget leses bare når dato eller valuta faktisk endres. Skjemaet lagrer
  // automatisk for hvert felt, og en tittelendring skal ikke koste to
  // databasekall ekstra.
  const needsSales = date !== current.date.slice(0, 10) || (clubCurrency !== null && clubCurrency !== current.currency)
  const [summary, earliestSaleAt] = needsSales
    ? await Promise.all([getShowSalesSummary(showId), earliestOutstandingSaleAt(showId)])
    : [null, null]

  const check = checkShowDetailsChange({
    show: current,
    date,
    clubCurrency,
    hasSales: summary ? hasOutstandingSales(summary) : false,
    earliestSaleAt,
  })
  if (!check.ok) return { error: check.error }

  const title = String(formData.get('title') ?? '').trim()
  const { error } = await db.from('shows').update({
    title,
    // Stripe-produktet bærer tittelen kjøperen ser på betalingssiden. Et nytt
    // navn gir et nytt produkt ved neste checkout; prisen settes uansett per
    // kjøp og påvirkes ikke.
    ...(title !== current.title ? { stripe_product_id: null } : {}),
    slug: String(formData.get('slug') ?? '').trim(),
    description: optionalText(formData.get('description')),
    date,
    start_time: optionalText(formData.get('start_time')),
    end_time: optionalText(formData.get('end_time')),
    venue_name: null,
    venue_address: optionalText(formData.get('venue_address')),
    capacity: optionalInteger(formData.get('capacity')),
    ticket_price: optionalMoneyToMinor(formData.get('ticket_price')),
    currency: check.currency,
  }).eq('id', showId)

  // Next redacts the message on a thrown error in production, and a taken slug
  // is the one failure the booker can actually fix, so it comes back as a value.
  if (error?.code === '23505') return { error: 'That slug is already used by another show.' }
  if (error) throw new Error(error.message)

  // Et kjøp som ble startet mens salget var åpent, kan fortsatt betales i en
  // halvtime. Er salgsvinduet for den nye datoen ikke åpnet, ville den
  // betalingen blitt et salg mer enn 90 dager før showet. Databasen sjekker
  // ikke vinduet, så sesjonene avbrytes — etter svaret, så lagringen ikke
  // venter på Stripe.
  if (
    check.dateChanged &&
    ticketSalesState(current).kind === 'open' &&
    ticketSalesState({ ...current, date }).kind === 'not_yet_open'
  ) {
    runAfterResponse(`Expire checkout sessions after moving show ${showId}`, async () => {
      const { failed } = await expireOpenCheckoutSessions(showId)
      if (failed > 0) {
        console.error(`[Shows] Show ${showId} was moved, but ${failed} open checkout sessions could not be expired`)
      }
    })
  }

  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function updateRequirementAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  const reqId = formData.get('req_id') as string
  await assertRequirementAccess(showId, reqId)
  const db = createAdminClient()
  const input = await getRequirementWriteInput(formData, showId)

  await ensurePercentAllocationWithinLimit(showId, input.compensation_percent, reqId)

  const { error } = await db.from('show_requirements').update(input).eq('id', reqId)

  if (error) throw new Error(error.message)
  revalidatePath(`/admin-app/shows/${showId}`)
}

/**
 * The role for a single lineup spot, set straight from the booking card.
 *
 * Only the role is written — score, energy, gender and fee keep whatever the
 * booker set on the requirement.
 */
export async function updateSpotRoleAction(formData: FormData) {
  const showId = String(formData.get('show_id') ?? '')
  const reqId = String(formData.get('req_id') ?? '')
  await assertRequirementAccess(showId, reqId)

  const roleName = canonicalRoleLabel(String(formData.get('role_name') ?? '').trim())
  if (!roleName) throw new Error('Pick a role for this spot.')

  const db = createAdminClient()
  const { error } = await db
    .from('show_requirements')
    .update({ role_name: roleName })
    .eq('id', reqId)
    .eq('show_id', showId)

  if (error) throw new Error(error.message)

  // Another role matches other comedians, so an open spot is offered again.
  scheduleShowAutomation(showId, `spot-role-${reqId}`)
  revalidatePath(`/admin-app/shows/${showId}`)
}

/**
 * The fee for a single lineup spot, set straight from the booking card.
 *
 * The fee lives on the requirement, but the artist reads it off their own spot
 * or offer — so those follow along, the same way they are set when a spot is
 * created or an offer is moved. A paid-out spot is left alone.
 */
export async function updateSpotFeeAction(formData: FormData) {
  const showId = String(formData.get('show_id') ?? '')
  const reqId = String(formData.get('req_id') ?? '')
  await assertRequirementAccess(showId, reqId)

  const compensationType = optionalCompensationType(formData.get('compensation_type'))
  const compensationAmount = compensationType === 'fixed'
    ? optionalMoneyToMinor(formData.get('compensation_amount'))
    : null
  const compensationPercent = compensationType === 'percent'
    ? optionalDecimal(formData.get('compensation_percent'))
    : null

  if (compensationPercent != null && (Number.isNaN(compensationPercent) || compensationPercent < 0 || compensationPercent > 100)) {
    throw new Error('Percentage must be between 0 and 100.')
  }

  if (compensationAmount != null && (Number.isNaN(compensationAmount) || compensationAmount < 0)) {
    throw new Error('A fixed amount must be 0 or higher.')
  }

  await ensurePercentAllocationWithinLimit(showId, compensationPercent, reqId)

  const db = createAdminClient()
  const { error } = await db
    .from('show_requirements')
    .update({
      compensation_type: compensationType,
      compensation_amount: compensationAmount,
      compensation_percent: compensationPercent,
    })
    .eq('id', reqId)
    .eq('show_id', showId)

  if (error) throw new Error(error.message)

  const feeAmount = compensationType === 'fixed' ? compensationAmount : null
  const [spotResult, offerResult] = await Promise.all([
    db
      .from('confirmed_spots')
      .update({ fee_amount: feeAmount })
      .eq('show_id', showId)
      .eq('show_requirement_id', reqId)
      .in('status', ['confirmed', 'completed']),
    db
      .from('booking_offers')
      .update({ fee_amount: feeAmount })
      .eq('show_id', showId)
      .eq('show_requirement_id', reqId)
      .eq('status', 'sent'),
  ])

  const syncError = spotResult.error ?? offerResult.error
  if (syncError) throw new Error(syncError.message)

  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function openRequirementEnergyLevelsAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  const reqId = formData.get('req_id') as string
  const db = createAdminClient()

  if (!showId || !reqId) throw new Error('Show or spot is missing.')
  await assertRequirementAccess(showId, reqId)

  const { error } = await db
    .from('show_requirements')
    .update({ energy_level: 'any' })
    .eq('id', reqId)
    .eq('show_id', showId)

  if (error) throw new Error(error.message)

  scheduleShowAutomation(showId, `open-energy-${reqId}`)
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function reorderRequirementsAction(formData: FormData) {
  const showId = String(formData.get('show_id') ?? '')
  const orderedIds = JSON.parse(String(formData.get('ordered_ids') ?? '[]')) as string[]

  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    throw new Error('Lineup order is missing.')
  }

  await assertShowAccess(showId)

  const db = createAdminClient()
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      db
        .from('show_requirements')
        .update({ lineup_position: index + 1 })
        .eq('show_id', showId)
        .eq('id', id)
    )
  )

  const firstError = results.find((result) => result.error)?.error
  if (firstError) throw new Error(firstError.message)

  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function deleteRequirementAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  const reqId = formData.get('req_id') as string
  await assertRequirementAccess(showId, reqId)
  const db = createAdminClient()
  const { error } = await db.from('show_requirements').delete().eq('id', reqId)
  if (error) throw new Error(error.message)
  await normalizeRequirementPositions(showId)
  scheduleFullbookedAutomation(showId, 'delete-requirement')
  revalidatePath(`/admin-app/shows/${showId}`)
}

/**
 * Sletter én plass i lineupen — raden, ikke hele kravet.
 *
 * Et krav med `quantity: 3` er tre rader i kortet. Å slette kravet ville tatt
 * alle tre, så flere enn én plass igjen betyr at antallet telles ned. Er dette
 * den siste plassen, forsvinner kravet.
 *
 * Står det noen på plassen, avlyses bookingen først: den bekreftede spoten
 * settes til `cancelled`, et tilbud som er ute trekkes. Til forskjell fra
 * `removeSpotAndReopenAction` sendes det ikke nye tilbud etterpå — plassen
 * skal bort, ikke fylles på nytt.
 */
export async function deleteSpotAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  const reqId = formData.get('req_id') as string
  const spotId = (formData.get('spot_id') as string) || null
  const offerId = (formData.get('offer_id') as string) || null

  await assertRequirementAccess(showId, reqId)
  const db = createAdminClient()

  if (spotId) {
    await assertSpotAccess(showId, spotId)
    await db
      .from('confirmed_spots')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', spotId)
      .eq('show_id', showId)
  }

  if (offerId) {
    await assertOfferAccess(showId, offerId)
    await db
      .from('booking_offers')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .eq('id', offerId)
      .eq('show_id', showId)
  }

  const { data: requirement, error: requirementError } = await db
    .from('show_requirements')
    .select('quantity')
    .eq('id', reqId)
    .eq('show_id', showId)
    .single()

  if (requirementError) throw new Error(requirementError.message)

  if ((requirement?.quantity ?? 1) > 1) {
    const { error } = await db
      .from('show_requirements')
      .update({ quantity: requirement.quantity - 1 })
      .eq('id', reqId)
      .eq('show_id', showId)

    if (error) throw new Error(error.message)
  } else {
    const { error } = await db.from('show_requirements').delete().eq('id', reqId)
    if (error) throw new Error(error.message)
    await normalizeRequirementPositions(showId)
  }

  scheduleFullbookedAutomation(showId, 'delete-spot')
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function bookShowAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  await assertShowAccess(showId)
  const result = await bookShow(showId)
  if (result.offersCreated === 0) {
    throw new Error(result.candidatesMatched === 0
      ? 'Found no approved artists matching the score and energy requirements.'
      : 'No new booking offers were sent. Matching artists have already been offered a spot or are in the lineup.')
  }
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function publishShowAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  await assertShowAccess(showId)
  // Publishing is what opens ticket sales. Without a finished Connect account
  // there is no seller to receive the money on behalf of.
  await assertClubCanSell(showId)
  const db = createAdminClient()
  await db.from('shows').update({
    status: 'published',
    published_at: new Date().toISOString(),
  }).eq('id', showId)
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function updateShowStatusAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  const status = formData.get('status') as ShowStatus
  await assertShowAccess(showId)
  // Samme guard som publisering: `published` er det som åpner billettsalget,
  // uansett hvilken vei showet kommer dit.
  if (status === 'published') await assertClubCanSell(showId)
  await updateShowStatus(showId, status)
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function updateOfferStatusAction(formData: FormData) {
  const offerId = formData.get('offer_id') as string
  const showId = formData.get('show_id') as string
  const status = formData.get('status') as BookingOfferStatus
  await assertOfferAccess(showId, offerId)
  const db = createAdminClient()

  if (status === 'accepted') {
    await acceptBookingOfferById(offerId)
    revalidatePath(`/admin-app/shows/${showId}`)
    return
  }

  await cancelConfirmedSpotForOffer(offerId)

  const { error } = await db.from('booking_offers').update({
    status,
    responded_at: status === 'sent' ? null : new Date().toISOString(),
  }).eq('id', offerId)

  if (error) throw new Error(error.message)
  if (status !== 'sent') {
    scheduleShowAutomation(showId, `offer-status-${status}`)
  }
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function cancelOfferAction(formData: FormData) {
  const offerId = formData.get('offer_id') as string
  const showId = formData.get('show_id') as string
  await assertOfferAccess(showId, offerId)
  const db = createAdminClient()

  const { data: offer, error: offerError } = await db
    .from('booking_offers')
    .select('artist_id')
    .eq('id', offerId)
    .eq('show_id', showId)
    .maybeSingle()

  if (offerError) throw new Error(offerError.message)

  await db.from('booking_offers').update({ status: 'cancelled', responded_at: new Date().toISOString() }).eq('id', offerId)
  if (offer) {
    await excludeArtistFromAutomaticBooking(db, showId, offer.artist_id, 'admin_cancelled_offer')
  }
  scheduleShowAutomation(showId, 'cancel-offer')
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function removeSpotAction(formData: FormData) {
  const spotId = formData.get('spot_id') as string
  const showId = formData.get('show_id') as string
  await assertSpotAccess(showId, spotId)
  const db = createAdminClient()
  await db.from('confirmed_spots').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', spotId).eq('show_id', showId)
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function removeSpotAndReopenAction(formData: FormData) {
  const spotId = formData.get('spot_id') as string
  const showId = formData.get('show_id') as string
  const db = createAdminClient()

  await assertSpotAccess(showId, spotId)

  const { data: spot } = await db
    .from('confirmed_spots')
    .select('id, artist_id, show_requirement_id')
    .eq('id', spotId)
    .eq('show_id', showId)
    .single()

  if (!spot) throw new Error('Spot not found.')

  // Cancel active offers for this requirement so the slot re-opens cleanly
  await db
    .from('booking_offers')
    .update({ status: 'cancelled' })
    .eq('show_id', showId)
    .eq('show_requirement_id', spot.show_requirement_id)
    .eq('status', 'sent')

  // Cancel the spot
  await db
    .from('confirmed_spots')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', spotId)

  // Tilbudet som ga plassen står fortsatt som `accepted`. Blir det stående,
  // teller artisten som opptatt på showet og forsvinner ut av den manuelle
  // lista. Eksklusjonsraden under holder automatikken unna — dette handler
  // bare om hva admin selv kan plukke fra igjen.
  await db
    .from('booking_offers')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('show_id', showId)
    .eq('artist_id', spot.artist_id)
    .in('status', ['sent', 'accepted'])

  await excludeArtistFromAutomaticBooking(db, showId, spot.artist_id, 'admin_removed_spot')

  // Send new offers with "Ledig spot" email in background
  runAfterResponse(`reopen-spot-${spotId}`, async () => {
    await sendOffersForReopenedRequirement(showId, spot.show_requirement_id)
    revalidatePath(`/admin-app/shows/${showId}`)
    revalidatePath('/admin-app/bookings')
  })

  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function moveSpotAction(formData: FormData) {
  const spotId = formData.get('spot_id') as string
  const newReqId = formData.get('show_requirement_id') as string
  const showId = formData.get('show_id') as string
  await assertSpotAccess(showId, spotId)
  await assertRequirementAccess(showId, newReqId)
  const db = createAdminClient()

  const [{ data: req }, { count: filled }] = await Promise.all([
    db.from('show_requirements').select('quantity').eq('id', newReqId).single(),
    db.from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', newReqId)
      .in('status', ['confirmed', 'completed', 'paid']),
  ])

  if (req && (filled ?? 0) >= req.quantity) {
    throw new Error('This role is already filled.')
  }

  const { error } = await db
    .from('confirmed_spots')
    .update({ show_requirement_id: newReqId })
    .eq('id', spotId)
    .eq('show_id', showId)

  if (error) throw new Error(error.message)
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function movePendingOfferAction(formData: FormData) {
  const offerId = formData.get('offer_id') as string
  const newReqId = formData.get('show_requirement_id') as string
  const showId = formData.get('show_id') as string
  const db = createAdminClient()

  if (!offerId || !newReqId || !showId) throw new Error('Offer, spot or show is missing.')
  await assertOfferAccess(showId, offerId)
  await assertRequirementAccess(showId, newReqId)

  const [{ data: offer }, { data: requirement }, { count: filled }] = await Promise.all([
    db
      .from('booking_offers')
      .select('id, show_id, show_requirement_id, status')
      .eq('id', offerId)
      .eq('show_id', showId)
      .single(),
    db
      .from('show_requirements')
      .select('id, show_id, quantity, compensation_type, compensation_amount')
      .eq('id', newReqId)
      .eq('show_id', showId)
      .single(),
    db.from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', newReqId)
      .in('status', ['confirmed', 'completed', 'paid']),
  ])

  if (!offer) throw new Error('That offer does not exist on this show.')
  if (!requirement) throw new Error('That spot does not exist on this show.')
  if (offer.status !== 'sent') throw new Error('Only offers awaiting a reply can be moved.')
  if (offer.show_requirement_id === newReqId) return
  if ((filled ?? 0) >= requirement.quantity) throw new Error('This spot is already filled.')

  const { error } = await db
    .from('booking_offers')
    .update({
      show_requirement_id: newReqId,
      fee_amount: requirement.compensation_type === 'fixed' ? requirement.compensation_amount : null,
      // Bookeren har plassert komikeren selv. Passer hen ikke kravene på den
      // nye plassen, skal motoren ikke trekke tilbudet — se lib/booking-rules.ts.
      source: 'manual',
    })
    .eq('id', offerId)
    .eq('show_id', showId)
    .eq('status', 'sent')

  if (error) throw new Error(error.message)
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function swapArtistAction(formData: FormData) {
  const spotId = formData.get('spot_id') as string
  const newArtistId = formData.get('new_artist_id') as string
  const showId = formData.get('show_id') as string
  await assertSpotAccess(showId, spotId)
  const db = createAdminClient()
  await assertArtistBookableForShow(db, showId, newArtistId)

  const { data: oldSpot } = await db
    .from('confirmed_spots')
    .select('show_requirement_id, fee_amount, currency')
    .eq('id', spotId)
    .single()

  if (!oldSpot) throw new Error('Spot not found.')

  const { data: existingSpot } = await db
    .from('confirmed_spots')
    .select('id')
    .eq('show_id', showId)
    .eq('artist_id', newArtistId)
    .in('status', ['confirmed', 'completed', 'paid'])
    .maybeSingle()

  if (existingSpot) throw new Error('This artist is already in the lineup.')

  await db
    .from('confirmed_spots')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', spotId)
    .eq('show_id', showId)

  const { error } = await db
    .from('confirmed_spots')
    .insert({
      show_id: showId,
      artist_id: newArtistId,
      show_requirement_id: oldSpot.show_requirement_id,
      fee_amount: oldSpot.fee_amount,
      currency: oldSpot.currency ?? 'NOK',
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    })

  if (error) throw new Error(error.message)

  await clearArtistBookingExclusion(db, showId, newArtistId)
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function addArtistToRequirementAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  const artistId = formData.get('artist_id') as string
  const requirementId = formData.get('show_requirement_id') as string
  const currency = (formData.get('currency') as string | null) ?? 'NOK'
  const requirement = await assertRequirementAccess(showId, requirementId)
  const db = createAdminClient()
  await assertArtistBookableForShow(db, showId, artistId)

  const { data: existingSpot } = await db
    .from('confirmed_spots')
    .select('id')
    .eq('show_id', showId)
    .eq('artist_id', artistId)
    .in('status', ['confirmed', 'completed', 'paid'])
    .maybeSingle()

  if (existingSpot) throw new Error('This artist is already in the lineup.')

  const { count: filled } = await db.from('confirmed_spots')
    .select('*', { count: 'exact', head: true })
    .eq('show_requirement_id', requirementId)
    .in('status', ['confirmed', 'completed', 'paid'])

  if (requirement && (filled ?? 0) >= requirement.quantity) {
    throw new Error('This role is already filled.')
  }

  const feeAmount = requirement?.compensation_type === 'fixed' ? requirement.compensation_amount : null

  const { error } = await db.from('confirmed_spots').insert({
    show_id: showId,
    artist_id: artistId,
    show_requirement_id: requirementId,
    fee_amount: feeAmount,
    currency,
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
  })

  if (error) throw new Error(error.message)

  // Mark pending offers for this requirement as filled
  await db
    .from('booking_offers')
    .update({ status: 'filled_by_other' })
    .eq('show_id', showId)
    .eq('show_requirement_id', requirementId)
    .eq('status', 'sent')

  await clearArtistBookingExclusion(db, showId, artistId)

  await db.from('shows').update({ status: 'booking' }).eq('id', showId).in('status', ['draft'])
  scheduleFullbookedAutomation(showId, 'add-artist-spot')
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function sendOfferToArtistAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  const artistId = formData.get('artist_id') as string
  const requirementId = formData.get('show_requirement_id') as string
  await assertRequirementAccess(showId, requirementId)

  if (!artistId) throw new Error('Pick a comedian to send the offer to.')

  // `sendManualBookingOffer` sjekker det samme, men da er tilbudet halvveis
  // laget. Her stopper vi før noe skrives.
  await assertArtistBookableForShow(createAdminClient(), showId, artistId)
  await clearArtistBookingExclusion(createAdminClient(), showId, artistId)
  await sendManualBookingOffer(showId, artistId, requirementId)
  revalidatePath(`/admin-app/shows/${showId}`)
  revalidatePath('/admin-app/bookings')
}

export async function addManualSpotAction(_prevState: ManualSpotActionState, formData: FormData): Promise<ManualSpotActionState> {
  const showId = formData.get('show_id') as string
  const artistId = formData.get('artist_id') as string
  const requirementId = formData.get('show_requirement_id') as string
  const feeAmount = optionalMoneyToMinor(formData.get('fee_amount'))
  const currency = optionalText(formData.get('currency')) ?? 'NOK'
  const db = createAdminClient()

  if (!showId || !artistId || !requirementId) {
    return manualSpotState('error', 'Pick an artist and a role before adding to the lineup.')
  }

  const requirement = await assertRequirementAccess(showId, requirementId)
  await assertArtistBookableForShow(db, showId, artistId)

  const { data: existingSpot } = await db
    .from('confirmed_spots')
    .select('id')
    .eq('show_id', showId)
    .eq('artist_id', artistId)
    .in('status', ['confirmed', 'completed', 'paid'])
    .maybeSingle()

  if (existingSpot) return manualSpotState('error', 'This artist is already in the lineup.')

  const { count: filled } = await db.from('confirmed_spots')
    .select('*', { count: 'exact', head: true })
    .eq('show_requirement_id', requirementId)
    .in('status', ['confirmed', 'completed', 'paid'])

  if (requirement && (filled ?? 0) >= requirement.quantity) {
    return manualSpotState('error', 'This role is already filled. Add more spots or remove an artist first.')
  }

  const { error } = await db.from('confirmed_spots').insert({
    show_id: showId,
    artist_id: artistId,
    show_requirement_id: requirementId,
    fee_amount: feeAmount,
    currency,
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
  })

  if (error) return manualSpotState('error', error.message)

  await clearArtistBookingExclusion(db, showId, artistId)

  await db.from('shows').update({ status: 'booking' }).eq('id', showId).in('status', ['draft'])
  scheduleFullbookedAutomation(showId, 'manual-spot')
  revalidatePath(`/admin-app/shows/${showId}`)
  return manualSpotState('success', 'The artist was added to the lineup.')
}

export async function updateSpotAction(formData: FormData) {
  const spotId = formData.get('spot_id') as string
  const showId = formData.get('show_id') as string
  const status = formData.get('status') as ConfirmedSpotStatus
  const feeAmount = optionalMoneyToMinor(formData.get('fee_amount'))
  await assertSpotAccess(showId, spotId)
  await assertRequirementAccess(showId, formData.get('show_requirement_id') as string)
  const db = createAdminClient()

  const { error } = await db.from('confirmed_spots').update({
    show_requirement_id: formData.get('show_requirement_id') as string,
    fee_amount: feeAmount,
    currency: optionalText(formData.get('currency')) ?? 'NOK',
    status,
    cancelled_at: status === 'cancelled' ? new Date().toISOString() : null,
    confirmed_at: status === 'confirmed' ? new Date().toISOString() : undefined,
  }).eq('id', spotId).eq('show_id', showId)

  if (error) throw new Error(error.message)
  scheduleFullbookedAutomation(showId, 'update-spot')
  revalidatePath(`/admin-app/shows/${showId}`)
}

/**
 * Confirm the show lineup:
 * 1. Verify all requirement slots are filled
 * 2. Create marketing tasks and publish
 * 3. Redirect to marketing tab
 *
 * Plakaten lages ikke her. Den er markedsføringsfanens jobb, og den lages bare
 * automatisk når showet har `auto_poster_enabled`.
 */
export async function confirmLineupAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  await assertShowAccess(showId)

  const result = await automateFullbookedShow(showId)
  if (!result.fullbooked) {
    throw new Error(result.message ?? 'The lineup is not fully booked yet.')
  }

  revalidatePath(`/admin-app/shows/${showId}`)
  redirect(`/admin-app/shows/${showId}?tab=marketing`)
}

/**
 * Publiserer lineupen selv om ikke alle plasser er fylt.
 *
 * The club's booker decides when the lineup is good enough — pending offers
 * are not withdrawn, so spots can still be filled afterwards.
 */
export async function publishLineupAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  await assertShowAccess(showId)

  const result = await automateFullbookedShow(showId, { force: true })
  if (!result.published) {
    throw new Error(result.message ?? 'Could not publish the lineup.')
  }

  revalidatePath(`/admin-app/shows/${showId}`)
  revalidatePath('/admin-app/shows')
}

// ─────────────────────────────────────────────────────────────
// Billettsalg og sletting
//
// Handlingene under returnerer `{ error }` i stedet for å kaste. Next
// skjuler meldingen i en kastet feil i produksjon, og her er meldingen det
// bookeren trenger for å vite hva som må gjøres før hen kan gå videre.
// ─────────────────────────────────────────────────────────────

export type StopTicketSalesResult =
  | { ok: true; expiredCheckoutSessions: number; warning?: string }
  | { error: string }

export type ResumeTicketSalesResult = { ok: true } | { error: string }

export type RefundAllShowTicketsResult =
  | {
      ok: true
      total: number
      refunded: number
      failed: number
      errors: string[]
      /** Ordrer som ikke ble forsøkt før tidsbudsjettet gikk ut. Dialogen kaller igjen. */
      remaining: number
    }
  | { error: string }

/**
 * Hvor lenge én «Refund all» holder på før den gir fra seg svaret. Kort med
 * vilje: siden setter ingen `maxDuration` (en lav verdi ville kuttet andre
 * handlinger på siden, som plakatgenerering), og korte runder holder seg
 * innenfor enhver plattformgrense. Dialogen kaller igjen til alt er refundert.
 */
const REFUND_ALL_TIME_BUDGET_MS = 8_000

function actionErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.'
}

/** Profilen som gjør endringen, til `*_by`-kolonnene. Null tåles — raden sier da bare når. */
async function currentProfileId() {
  const user = await getAuthUser()
  if (!user) return null
  const profile = await getSessionProfile(user.id)
  return profile?.id ?? null
}

/** Sluggen hentes før endringen, så arrangementssiden kan revalideres også når showet er borte. */
async function showSlug(showId: string) {
  const { data } = await createAdminClient().from('shows').select('slug').eq('id', showId).maybeSingle()
  return data?.slug ?? null
}

/** Salgsstatus vises i admin, på ordrelisten og på de offentlige sidene. */
function revalidateShowSales(showId: string, slug: string | null) {
  revalidatePath(`/admin-app/shows/${showId}`)
  revalidatePath('/admin-app/shows')
  revalidatePath('/admin-app/orders')
  revalidatePath('/events')
  if (slug) revalidatePath(`/events/${slug}`)
}

/**
 * Det bookeren må se før sletting: salgsstatus, tall og hva som kommer til å
 * skje. Dialogen henter dette når den åpnes, så tallene er ferske.
 */
export async function getShowSalesOverviewAction(showId: string): Promise<ShowSalesOverviewDto | { error: string }> {
  try {
    await assertShowAccess(showId)
    return toShowSalesOverviewDto(await getShowSalesOverview(showId))
  } catch (error) {
    return { error: actionErrorMessage(error) }
  }
}

/**
 * Sletter et show — eller arkiverer det, når det har salgshistorikk.
 *
 * Avgjørelsen tas av `delete_show()` under lås på showraden, ikke her: et
 * kjøp som fullføres mens bookeren står i dialogen skal stoppe slettingen.
 * Et show med betalinger som ikke er refundert kan aldri slettes.
 *
 * Før slettingen stenges salget og påbegynte kjøp avbrytes — se
 * `stopSalesBeforeDeletion`. Et show som alt er blokkert får ikke den
 * bivirkningen: da svarer vi før noe endres.
 */
export async function deleteShowAction(formData: FormData): Promise<{ error: string } | undefined> {
  const showId = String(formData.get('show_id') ?? '')
  let slug: string | null = null
  let salesStopped = false

  // Stengte vi salget og slettingen likevel stoppet, skal bookeren vite det,
  // og sidene skal vise det.
  const failure = (message: string) => {
    if (!salesStopped) return { error: message }
    revalidateShowSales(showId, slug)
    return { error: `${message} Ticket sales for the show have been stopped.` }
  }

  try {
    await assertShowAccess(showId)
    const [actorId, loadedSlug, summary] = await Promise.all([
      currentProfileId(),
      showSlug(showId),
      getShowSalesSummary(showId),
    ])
    slug = loadedSlug

    if (hasOutstandingSales(summary)) return { error: deleteShowBlockedMessage(summary) }

    salesStopped = (await stopSalesBeforeDeletion(showId, actorId)).salesStopped

    const { data, error } = await createAdminClient()
      .rpc('delete_show', { p_show_id: showId, p_actor_id: actorId })
      .single()

    if (error || !data) {
      console.error(`[Shows] delete_show failed for ${showId}: ${error?.message ?? 'no result'}`)
      return failure(`The show could not be deleted: ${error?.message ?? 'the database returned no result'}.`)
    }

    if (data.result === 'blocked') {
      // `delete_show()` teller ikke disputter i svaret sitt. Tallene hentes på
      // nytt, så meldingen ikke ber bookeren refundere noe Stripe avviser.
      const latest = await getShowSalesSummary(showId).catch(() => null)
      return failure(
        deleteShowBlockedMessage({
          ...data,
          open_dispute_orders: latest?.open_dispute_orders ?? 0,
          pending_refund_orders: latest?.pending_refund_orders ?? 0,
        }),
      )
    }
    if (data.result === 'not_found') return { error: 'This show no longer exists. It may already have been deleted.' }

    revalidateShowSales(showId, slug)
  } catch (error) {
    return failure(actionErrorMessage(error))
  }

  // Utenfor try/catch: `redirect` kaster, og catch-grenen ville gjort
  // navigeringen om til en feilmelding.
  redirect('/admin-app/shows')
}

/**
 * Stenger billettsalget uten å avpublisere showet. Arrangementssiden står,
 * solgte billetter gjelder fortsatt, og påbegynte kjøp avbrytes hos Stripe.
 */
export async function stopTicketSalesAction(formData: FormData): Promise<StopTicketSalesResult> {
  const showId = String(formData.get('show_id') ?? '')
  let slug: string | null = null

  try {
    await assertShowAccess(showId)
    const [actorId, loadedSlug] = await Promise.all([currentProfileId(), showSlug(showId)])
    slug = loadedSlug

    const { expiredCheckoutSessions, failedCheckoutSessions } = await stopTicketSales(showId, actorId)
    revalidateShowSales(showId, slug)

    // Et kjøp Stripe ikke lot oss avbryte kan fortsatt betales. Databasen gir
    // ingen billett for det og pengene refunderes, men bookeren skal ikke få
    // høre at alt ble avbrutt når det ikke ble det.
    if (failedCheckoutSessions > 0) {
      const n = failedCheckoutSessions
      return {
        ok: true,
        expiredCheckoutSessions,
        warning:
          `${n} ${n === 1 ? 'purchase' : 'purchases'} in progress couldn't be cancelled at Stripe. ` +
          `If ${n === 1 ? 'that buyer' : 'those buyers'} still ${n === 1 ? 'pays' : 'pay'}, the payment is refunded ` +
          'automatically and no ticket is issued.',
      }
    }

    return { ok: true, expiredCheckoutSessions }
  } catch (error) {
    // Salget er stengt i databasen — bare oppryddingen hos Stripe feilet.
    // Det er en advarsel, ikke en feil, ellers ville bookeren trodd salget
    // fortsatt var åpent.
    if (error instanceof CheckoutSessionExpiryError) {
      revalidateShowSales(showId, slug)
      return { ok: true, expiredCheckoutSessions: error.expiredCheckoutSessions, warning: error.message }
    }

    console.error(`[Shows] Stop ticket sales for ${showId} failed: ${actionErrorMessage(error)}`)
    return { error: actionErrorMessage(error) }
  }
}

export async function resumeTicketSalesAction(formData: FormData): Promise<ResumeTicketSalesResult> {
  const showId = String(formData.get('show_id') ?? '')

  try {
    await assertShowAccess(showId)
    const slug = await showSlug(showId)
    await resumeTicketSales(showId)
    revalidateShowSales(showId, slug)
    return { ok: true }
  } catch (error) {
    return { error: actionErrorMessage(error) }
  }
}

/**
 * Refunderer alle betalte ordrer på showet — steget før et show med salg
 * kan slettes.
 *
 * Krever at salget er stengt, så ingen ny billett selges mens refusjonene
 * går, og at bookeren har skrevet inn showets tittel. Refusjonen kan ikke
 * angres og går rett på klubbens Stripe-saldo.
 *
 * Refunderer så mange som rekkes innenfor tidsbudsjettet og sier hvor mange
 * som gjenstår. Hver ordre er idempotent mot Stripe, så neste kall tar bare
 * de som ikke er refundert.
 */
export async function refundAllShowTicketsAction(formData: FormData): Promise<RefundAllShowTicketsResult> {
  const showId = String(formData.get('show_id') ?? '')
  const confirmTitle = String(formData.get('confirm_title') ?? '').trim()
  let slug: string | null = null
  let started = false

  try {
    await assertShowAccess(showId)
    const [overview, loadedSlug] = await Promise.all([getShowSalesOverview(showId), showSlug(showId)])
    slug = loadedSlug

    if (!isTicketSalesStopped(overview.sales)) {
      return { error: 'Stop ticket sales before refunding all tickets.' }
    }
    if (!confirmTitle || confirmTitle !== overview.title.trim()) {
      return { error: 'Type the exact show title to confirm the refund.' }
    }
    // Ikke en feil: dialogen kaller igjen så lenge noe gjensto, og en
    // webhook kan ha refundert de siste i mellomtiden.
    if (!hasRefundableSales(overview.summary)) {
      return { ok: true, total: 0, refunded: 0, failed: 0, errors: [], remaining: 0 }
    }

    started = true
    // Én stor refusjon i ett kall ville nådd tidsgrensen på et stort show,
    // og da blir svaret en generell feil uten tall. Med en frist stopper
    // `refundShow` før, og dialogen fortsetter med resten.
    const result = await refundShow(showId, { deadline: Date.now() + REFUND_ALL_TIME_BUDGET_MS })
    return {
      ok: true,
      total: result.total,
      refunded: result.refunded,
      failed: result.failed,
      errors: result.errors,
      remaining: result.remaining,
    }
  } catch (error) {
    const message = actionErrorMessage(error)
    console.error(`[Shows] Refund all tickets for ${showId} failed: ${message}`)

    // Noen ordrer kan være refundert før det smalt. Hver ordre er idempotent
    // mot Stripe, så et nytt forsøk er trygt — men bookeren må vite det.
    return {
      error: started
        ? `${message} Some orders may already be refunded. Check the orders list, then try again.`
        : message,
    }
  } finally {
    if (started) revalidateShowSales(showId, slug)
  }
}
