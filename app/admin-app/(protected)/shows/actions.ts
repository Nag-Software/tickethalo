'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createShow, updateShowStatus } from '@/lib/actions/shows'
import { acceptBookingOfferById, automateFullbookedShow, bookShow, cancelConfirmedSpotForOffer, runAutomaticBookingForShow, sendFallbackOffersForShow, sendManualBookingOffer, sendOffersForReopenedRequirement } from '@/lib/actions/booking'
import { runAfterResponse } from '@/lib/background'
import { assertOfferAccess, assertRequirementAccess, assertShowAccess, assertSpotAccess, getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { canonicalRoleLabel } from '@/lib/artist-roles'
import { normalizeCurrency } from '@/lib/currencies'
import { assertClubCanSell } from '@/lib/stripe-connect'
import { MARKETING_DESIGN_BUCKET, sanitizeStorageFileName } from '@/lib/marketing/storage'
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
  redirect(`/admin-app/shows/${show.id}`)
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

  // The currency is not picked per show — it is registered on the club under
  // My club, and the show follows it.
  const { data: club } = show.club_id
    ? await db.from('clubs').select('currency').eq('id', show.club_id).maybeSingle()
    : { data: null }

  const { error } = await db.from('shows').update({
    title: String(formData.get('title') ?? '').trim(),
    slug: String(formData.get('slug') ?? '').trim(),
    description: optionalText(formData.get('description')),
    date: String(formData.get('date') ?? '').trim(),
    start_time: optionalText(formData.get('start_time')),
    end_time: optionalText(formData.get('end_time')),
    venue_name: null,
    venue_address: optionalText(formData.get('venue_address')),
    capacity: optionalInteger(formData.get('capacity')),
    ticket_price: optionalMoneyToMinor(formData.get('ticket_price')),
    // Without a club currency we leave the show's own — it must not fall back to NOK.
    ...(club?.currency ? { currency: normalizeCurrency(club.currency) } : {}),
  }).eq('id', showId)

  // Next redacts the message on a thrown error in production, and a taken slug
  // is the one failure the booker can actually fix, so it comes back as a value.
  if (error?.code === '23505') return { error: 'That slug is already used by another show.' }
  if (error) throw new Error(error.message)

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
  revalidatePath(`/admin-app/shows/${showId}`)
}

export async function addArtistToRequirementAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  const artistId = formData.get('artist_id') as string
  const requirementId = formData.get('show_requirement_id') as string
  const currency = (formData.get('currency') as string | null) ?? 'NOK'
  const requirement = await assertRequirementAccess(showId, requirementId)
  const db = createAdminClient()

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

export async function deleteShowAction(formData: FormData) {
  const showId = formData.get('show_id') as string
  await assertShowAccess(showId)
  const db = createAdminClient()
  await db.from('shows').delete().eq('id', showId)
  revalidatePath('/admin-app/shows')
  redirect('/admin-app/shows')
}
