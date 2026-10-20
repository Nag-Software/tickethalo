import { createAdminClient } from '@/lib/supabase/admin'
import { sendBookingOfferEmail, sendSpotAvailableEmail } from '@/lib/email/mailer'
import { requirementFeeLabel } from '@/lib/booking-spots'
import {
  hasScheduleConflict,
  isEligibleForSpot,
  pendingOffersToWithdraw,
  planOfferWave,
  spotOrder,
  waveEntries,
  type ArtistBooking,
  type SpotQueue,
  type WaveEntry,
} from '@/lib/booking-rules'
import { isRushMode, lineupDeadlineAt, offerExpiresAt, offerTarget } from '@/lib/booking-schedule'
import { lineupDeadlineDaysFor, type BookingSettings } from '@/lib/booking-settings'
import { loadBookingSettings } from '@/lib/booking-settings-store'
import { skillLevelFromScore, type SkillLevel } from '@/lib/artist-score'
import type { ArtistGender, ArtistType, EnergyLevel, RequirementCompensationType } from '@/types/database'
import { clubArtistReviews, withClubReview } from '@/lib/club-artist-profile'
import { appUrl } from '@/lib/app-url'
import { showVenue } from '@/lib/show-venue'

/**
 * Bookingmotoren: hvem som får tilbud på et show, og utsendingen av dem.
 *
 * Bor utenfor lib/actions/booking.ts med vilje. Alt som eksporteres fra en
 * `'use server'`-fil kan kalles fra nettleseren, og forslaget før Start
 * booking og de godkjente valgene skal bare nås gjennom handlinger som
 * sjekker at brukeren har tilgang til showet — se `suggestLineupAction` og
 * `startBookingAction` i app/admin-app/(protected)/shows/actions.ts.
 *
 * Reglene står i lib/booking-rules.ts og lib/booking-schedule.ts; her hentes
 * radene og skrives tilbudene.
 */

type Db = ReturnType<typeof createAdminClient>

/**
 * Showene motoren jobber på.
 *
 * `published` er med med vilje: faller en komiker fra etter at billettene er
 * lagt ut, blir showet stående publisert, og plassen skal fylles igjen. Et
 * `fullbooked` show har ingen ledige seter, så kvoten gir det ingenting —
 * men blir en plass ledig igjen, skal motoren ta den.
 */
export const ENGINE_STATUSES = ['booking', 'fullbooked', 'published'] as const

/**
 * Honoraret, rollen og stedet slik komikeren skal lese tilbudet.
 *
 * Et fast honorar kopieres til `booking_offers.fee_amount` når tilbudet
 * opprettes — uten det står tilbudssiden igjen med «ikke satt» selv om
 * bookeren har satt honoraret på lineup-plassen. Prosentavtaler har ikke
 * noe beløp, og leses fra lineup-plassen både i mailen og på siden.
 */
type OfferShow = {
  start_time: string | null
  venue_name: string | null
  venue_address: string | null
  currency: string | null
}

type OfferRequirement = {
  role_name: string
  compensation_type: RequirementCompensationType | null
  compensation_amount: number | null
  compensation_percent: number | null
}

export function offerDetails(show: OfferShow, requirement: OfferRequirement) {
  const currency = show.currency || 'NOK'
  return {
    currency,
    feeAmount: requirement.compensation_type === 'fixed' ? requirement.compensation_amount : null,
    fee_label: requirementFeeLabel(requirement, currency),
    role_name: requirement.role_name,
    show_time: show.start_time?.slice(0, 5) ?? null,
    venue: showVenue(show).line,
  }
}

/**
 * Merker tilbud som har gått ut.
 *
 * Utløpet ble før bare vurdert når komikeren selv åpnet lenken, så et tilbud
 * ingen svarte på ble stående `sent` for alltid. Automatikken teller de
 * åpne tilbudene når den avgjør hvor mange nye den kan sende — to ubesvarte
 * e-poster kunne dermed stoppe bookingen av en plass permanent.
 */
export async function expireStaleOffers(showId?: string) {
  const admin = createAdminClient()
  let query = admin
    .from('booking_offers')
    .update({ status: 'expired', responded_at: new Date().toISOString() })
    .eq('status', 'sent')
    .lt('expires_at', new Date().toISOString())

  if (showId) query = query.eq('show_id', showId)

  const { data, error } = await query.select('id')
  if (error) {
    console.error(`[Booking] Could not expire stale offers: ${error.message}`)
    return 0
  }

  return data?.length ?? 0
}

// ─── Kandidatene ─────────────────────────────────────────────────────────

/**
 * Kandidaten motoren regner på.
 *
 * `category` og `admin_energy_level` kommer fra `club_artists` og ikke fra
 * `artists` — det er klubbens vurdering som avgjør om noen passer et krav.
 * Se `withClubReview`.
 */
export type Candidate = {
  id: string
  email: string
  full_name: string
  stage_name: string | null
  profile_image_url: string | null
  admin_energy_level: EnergyLevel | null
  gender: ArtistGender | null
  category: ArtistType[] | null
  /** Snittet av klubbens egne vurderinger, 0–10. Se lib/artist-reviews.ts. */
  score: number
  /** Bekreftede plasser i samme klubb innenfor rotasjonsvinduet. */
  clubBookingsInWindow: number
  lastClubBookingDate: string | null
  /** Komikeren har markert showdatoen som opptatt. */
  unavailable: boolean
  /** Komikeren står allerede på en annen scene den kvelden. */
  conflicted: boolean
}

type EngineShow = {
  id: string
  date: string
  start_time: string | null
  club_id: string | null
}

function addDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(base)) return date
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Alt motoren trenger å vite om klubbens komikere for akkurat denne kvelden.
 *
 * Fire oppslag for hele listen, ikke ett per komiker: klubbene har opptil et
 * par hundre på lista, og motoren kjører etter hvert svar.
 */
async function loadCandidates(
  admin: ReturnType<typeof createAdminClient>,
  show: EngineShow,
  settings: BookingSettings,
): Promise<Candidate[]> {
  const reviews = await clubArtistReviews(admin, show.club_id)
  const bookableIds = [...reviews.keys()]
  if (bookableIds.length === 0) return []

  const windowStart = addDays(show.date, -settings.rotation_window_days)
  const windowEnd = addDays(show.date, settings.rotation_window_days)
  // Tie-breaket spør «når spilte hen her sist». Ett år tilbake holder: den
  // som ikke har spilt på et år, stiller likt med den som aldri har gjort
  // det. Uten en nedre grense hentet spørringen hele klubbens historikk,
  // og id-listen den bygde videre på vokste til den sprengte URL-en.
  const historyStart = addDays(show.date, -Math.max(settings.rotation_window_days, 365))

  const [
    { data: artistRows, error: artistError },
    { data: unavailableRows, error: unavailableError },
    { data: sameDayShows, error: sameDayError },
    { data: clubShows, error: clubShowError },
  ] = await Promise.all([
    admin.from('artists')
      .select('id, email, full_name, stage_name, profile_image_url, gender')
      .eq('status', 'approved')
      .in('id', bookableIds),
    admin.from('artist_unavailable_dates')
      .select('artist_id')
      .eq('unavailable_date', show.date)
      .in('artist_id', bookableIds),
    // Kollisjon: alt som spilles den kvelden, uansett klubb.
    admin.from('shows')
      .select('id, date, start_time')
      .eq('date', show.date)
      .is('deleted_at', null),
    // Rotasjon: klubbens egne show fram til vinduets slutt. Dekker både
    // tellingen i vinduet og «når spilte hen her sist».
    show.club_id
      ? admin.from('shows')
        .select('id, date')
        .eq('club_id', show.club_id)
        .is('deleted_at', null)
        .gte('date', historyStart)
        .lte('date', windowEnd)
      : Promise.resolve({ data: [] as Array<{ id: string; date: string }>, error: null }),
  ])

  // Uten disse radene er svarene feil på den farlige måten: en tapt
  // kollisjonsspørring betyr «ingen er opptatt», og en tapt
  // utilgjengelighetsspørring betyr «alle kan». Da er det bedre å stå over
  // runden enn å sende tilbud på feil grunnlag.
  const loadError = artistError ?? unavailableError ?? sameDayError ?? clubShowError
  if (loadError) {
    console.error(`[Booking] Could not load candidates for show ${show.id}: ${loadError.message}`)
    return []
  }

  const artists = withClubReview(artistRows ?? [], reviews)
  if (artists.length === 0) return []

  const artistIds = artists.map((artist) => artist.id)
  const sameDayById = new Map((sameDayShows ?? []).map((row) => [row.id, row]))
  const clubShowById = new Map((clubShows ?? []).map((row) => [row.id, row]))
  const lookupShowIds = [...new Set([...sameDayById.keys(), ...clubShowById.keys()])]

  const { data: spots, error: spotError } = lookupShowIds.length > 0
    ? await admin.from('confirmed_spots')
      .select('artist_id, show_id')
      .in('show_id', lookupShowIds)
      .in('artist_id', artistIds)
      .in('status', ['confirmed', 'completed', 'paid'])
    : { data: [] as Array<{ artist_id: string; show_id: string }>, error: null }

  if (spotError) {
    console.error(`[Booking] Could not load bookings for show ${show.id}: ${spotError.message}`)
    return []
  }

  const bookingsByArtist = new Map<string, ArtistBooking[]>()
  const rotationCount = new Map<string, number>()
  const lastClubBooking = new Map<string, string>()

  for (const spot of spots ?? []) {
    const sameDay = sameDayById.get(spot.show_id)
    if (sameDay) {
      const list = bookingsByArtist.get(spot.artist_id) ?? []
      list.push({ show_id: sameDay.id, date: sameDay.date, start_time: sameDay.start_time })
      bookingsByArtist.set(spot.artist_id, list)
    }

    const clubShow = clubShowById.get(spot.show_id)
    if (clubShow && clubShow.id !== show.id) {
      if (clubShow.date >= windowStart && clubShow.date <= windowEnd) {
        rotationCount.set(spot.artist_id, (rotationCount.get(spot.artist_id) ?? 0) + 1)
      }
      if (clubShow.date <= show.date) {
        const previous = lastClubBooking.get(spot.artist_id)
        if (!previous || clubShow.date > previous) lastClubBooking.set(spot.artist_id, clubShow.date)
      }
    }
  }

  const unavailableIds = new Set((unavailableRows ?? []).map((row) => row.artist_id))

  return artists.map((artist) => ({
    id: artist.id,
    email: artist.email,
    full_name: artist.full_name,
    stage_name: artist.stage_name ?? null,
    profile_image_url: artist.profile_image_url ?? null,
    admin_energy_level: artist.admin_energy_level,
    gender: (artist.gender ?? null) as ArtistGender | null,
    category: artist.category,
    score: artist.score,
    clubBookingsInWindow: rotationCount.get(artist.id) ?? 0,
    lastClubBookingDate: lastClubBooking.get(artist.id) ?? null,
    unavailable: unavailableIds.has(artist.id),
    conflicted: hasScheduleConflict({
      showId: show.id,
      date: show.date,
      startTime: show.start_time,
      bookings: bookingsByArtist.get(artist.id) ?? [],
      conflictWindowHours: settings.conflict_window_hours,
    }),
  }))
}

export type EngineRequirement = {
  id: string
  role_name: string
  quantity: number
  lineup_position: number
  energy_level: string
  required_gender: string
  min_skill_level: SkillLevel | null
  submissions_open: boolean | null
  auto_started_at: string | null
  compensation_type: RequirementCompensationType | null
  compensation_amount: number | null
  compensation_percent: number | null
}

// ─── Planen ──────────────────────────────────────────────────────────────

/**
 * `run` er motoren: utløpte tilbud merkes i basen før de telles.
 *
 * `preview` er forslaget før Start booking. Det skriver ingenting, og regner
 * showet som om bookingen startet nå: hver plass som ikke er åpen for
 * søknader, står på dag 1 i bølgen, og et tilbud med passert frist teller
 * som utløpt.
 */
type PlanMode = 'run' | 'preview'

/** Hvorfor det ikke blir noen bølge. */
export type PlanSkipReason = 'not_running' | 'no_spots' | 'show_day' | 'no_candidates' | 'load_failed'

type ShowPlan = {
  show: OfferShow & { id: string; title: string; date: string; status: string }
  requirements: EngineRequirement[]
  pool: Candidate[]
  entries: WaveEntry<EngineRequirement>[]
  /** Komikere som allerede har tilbud, plass eller er tatt av showet. */
  involved: ReadonlySet<string>
  /** Ubesvarte tilbud som ikke lenger holder mål, og skal trekkes. */
  invalidPendingOfferIds: string[]
  /** Plasser som nettopp mistet en komiker — de får «Ledig spot»-e-posten. */
  reopenedRequirementIds: ReadonlySet<string | null>
  expiresAt: string
  settings: BookingSettings
  /** Bookerens kø per plass (`show_requirement_queue`). Tom = motoren rangerer selv. */
  queues: ReadonlyMap<string, SpotQueue>
  /** Tilbudene på showet, med statusen slik planen ser den. */
  offers: Array<{ artist_id: string; show_requirement_id: string | null; status: string }>
  /** Ventende tilbud fra motoren per plass. */
  pendingAuto: ReadonlyMap<string, number>
  /** Hvem som står bekreftet på hver plass. */
  bookedByRequirement: ReadonlyMap<string, string[]>
  rush: boolean
  now: Date
  lineupDeadline: Date
}

/**
 * Alt motoren vet om showet akkurat nå, og plassene som skal ha tilbud.
 *
 * Forslaget og den ekte kjøringen går gjennom denne ene funksjonen, så de
 * kan ikke regne ulikt. Bortsett fra `expireStaleOffers` i `run` skriver den
 * ingenting: trekk og utsending gjør kalleren.
 */
async function loadShowPlan(
  admin: Db,
  showId: string,
  mode: PlanMode,
): Promise<{ ok: true; plan: ShowPlan } | { ok: false; reason: PlanSkipReason }> {
  const { data: show, error: showError } = await admin
    .from('shows')
    .select('id, title, date, start_time, venue_name, venue_address, currency, status, club_id')
    .eq('id', showId)
    .single()

  if (showError || !show) throw new Error('Show not found')
  const running = ENGINE_STATUSES.includes(show.status as (typeof ENGINE_STATUSES)[number])
  if (!running && !(mode === 'preview' && show.status === 'draft')) return { ok: false, reason: 'not_running' }

  const { data: requirementRows, error: reqError } = await admin
    .from('show_requirements')
    .select('*')
    .eq('show_id', showId)
    .order('lineup_position')
    .order('created_at')

  if (reqError) throw new Error(reqError.message)
  if (!requirementRows?.length) return { ok: false, reason: 'no_spots' }

  // Må skje før tilbudene telles: et utløpt tilbud som fortsatt står `sent`
  // spiser en plass i kvoten under, og da sendes det aldri et nytt.
  if (mode === 'run') await expireStaleOffers(showId)

  const settings = await loadBookingSettings(admin)
  const now = new Date()

  const requirements = (requirementRows as unknown as EngineRequirement[]).map((req) => ({
    ...req,
    min_skill_level: req.min_skill_level ?? null,
    // Start booking er dag 1 for hver plass som ikke tar imot søknader —
    // samme regel som `startAutoBooking`.
    auto_started_at: mode === 'preview' && !req.submissions_open
      ? req.auto_started_at ?? now.toISOString()
      : req.auto_started_at,
  }))

  const { data: club } = show.club_id
    ? await admin.from('clubs').select('lineup_deadline_days').eq('id', show.club_id).maybeSingle()
    : { data: null }

  const deadlineDays = lineupDeadlineDaysFor(club, settings)
  const lineupDeadline = lineupDeadlineAt(show.date, deadlineDays)
  const rush = isRushMode({ now, showDate: show.date, deadlineDays, settings })

  // På showdagen sender motoren ingenting. Da er det bookeren som må ringe.
  const expiresAt = offerExpiresAt({ now, showDate: show.date, lineupDeadline, settings })
  if (!expiresAt) return { ok: false, reason: 'show_day' }

  const pool = await loadCandidates(admin, show, settings)
  if (pool.length === 0) return { ok: false, reason: 'no_candidates' }

  const [
    { data: offerRows, error: offersError },
    { data: existingSpots, error: spotsError },
    { data: excludedArtists, error: exclusionsError },
    { data: queueRows, error: queueError },
  ] = await Promise.all([
    // 'declined' må være med. Uten den faller en artist som nettopp takket
    // nei rett tilbake i kandidatlisten, og siden declineBookingOffer kjører
    // motoren med én gang, fikk de det samme showet tilbudt på nytt umiddelbart.
    //
    // 'expired' av nøyaktig samme grunn: expireStaleOffers() over her flipper
    // utløpte `sent` til `expired` i samme pass, og uten statusen her ble
    // artisten kandidat igjen sekunder senere og fikk showet tilbudt på nytt.
    admin.from('booking_offers')
      .select('id, artist_id, show_requirement_id, status, source, expires_at')
      .eq('show_id', showId)
      .in('status', ['sent', 'accepted', 'declined', 'expired']),
    admin.from('confirmed_spots')
      .select('artist_id, show_requirement_id, status, cancelled_at')
      .eq('show_id', showId),
    admin.from('show_artist_booking_exclusions').select('artist_id').eq('show_id', showId),
    admin.from('show_requirement_queue')
      .select('show_requirement_id, artist_id, position, removed')
      .in('show_requirement_id', requirements.map((req) => req.id))
      .order('position'),
  ])

  // Uten disse radene vet motoren ikke hvem som allerede har tilbud, plass
  // eller er tatt av showet — og ville sendt det til dem på nytt. Da er det
  // bedre å stå over denne runden. Køen også: uten den ville motoren sendt
  // tilbud til komikere bookeren har tatt ut.
  const lookupError = offersError ?? spotsError ?? exclusionsError ?? queueError
  if (lookupError) {
    console.error(`[Booking] Could not load offers, spots or exclusions for show ${showId}: ${lookupError.message}`)
    return { ok: false, reason: 'load_failed' }
  }

  // Forslaget skriver ikke, så det gjør i minnet det `expireStaleOffers` gjør i basen.
  const nowIso = now.toISOString()
  const existingOffers = (offerRows ?? []).map((offer) =>
    mode === 'preview' && offer.status === 'sent' && offer.expires_at && offer.expires_at < nowIso
      ? { ...offer, status: 'expired' }
      : offer,
  )

  const excludedArtistIds = new Set((excludedArtists ?? []).map((row) => row.artist_id))
  const candidateById = new Map(pool.map((candidate) => [candidate.id, candidate]))
  const requirementById = new Map(requirements.map((req) => [req.id, req]))

  // Kveldens krav gjelder også tilbud som alt er ute. Klubben kan ha flyttet
  // showdatoen til en dag komikeren har markert, eller hen kan ha takket ja
  // til noe annet i mellomtiden. `pendingOffersToWithdraw` ser bare på
  // kravene til plassen, så disse legges til her — også de manuelle: at
  // komikeren ikke kan, er ikke noe bookeren kan overstyre.
  const blockedForTheEvening = new Set(
    pool.filter((candidate) => candidate.unavailable || candidate.conflicted).map((candidate) => candidate.id),
  )

  const invalidPendingOfferIds = [...new Set([
    ...pendingOffersToWithdraw({
      offers: existingOffers,
      bookableArtists: candidateById,
      requirements: requirementById,
      excludedArtistIds,
    }),
    ...existingOffers
      .filter((offer) => offer.status === 'sent' && blockedForTheEvening.has(offer.artist_id))
      .map((offer) => offer.id),
  ])]

  const activeOffers = existingOffers.filter((offer) => !invalidPendingOfferIds.includes(offer.id))
  const activeSpots = (existingSpots ?? []).filter((spot) => ['confirmed', 'completed', 'paid'].includes(spot.status))

  const involved = new Set([
    ...activeOffers.map((offer) => offer.artist_id),
    ...activeSpots.map((spot) => spot.artist_id),
    ...excludedArtistIds,
  ])

  // Plasser som har hatt en komiker som falt fra, får «Ledig spot»-e-posten
  // i stedet for det vanlige tilbudet. Beskjeden er en annen: dette er en
  // kveld som allerede er planlagt, og som nå mangler noen.
  // Bare en plass som nettopp mistet noen. Uten tidsgrensen ville en
  // plass som hadde et frafall i januar sendt «Ledig spot» til alle
  // kandidater for alltid etterpå.
  const reopenedSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const reopenedRequirementIds = new Set(
    (existingSpots ?? [])
      .filter((spot) => spot.status === 'cancelled' && (spot.cancelled_at ?? '') >= reopenedSince)
      .map((spot) => spot.show_requirement_id),
  )

  const filled = new Map<string, number>()
  const bookedByRequirement = new Map<string, string[]>()
  for (const spot of activeSpots) {
    filled.set(spot.show_requirement_id, (filled.get(spot.show_requirement_id) ?? 0) + 1)
    bookedByRequirement.set(spot.show_requirement_id, [...(bookedByRequirement.get(spot.show_requirement_id) ?? []), spot.artist_id])
  }

  // Motorens egne tilbud og bookerens telles hver for seg — se `offerQuota`.
  const pendingAuto = new Map<string, number>()
  const pendingManual = new Map<string, number>()
  for (const offer of activeOffers) {
    if (offer.status !== 'sent' || !offer.show_requirement_id) continue
    const counts = offer.source === 'manual' ? pendingManual : pendingAuto
    counts.set(offer.show_requirement_id, (counts.get(offer.show_requirement_id) ?? 0) + 1)
  }

  const queues = new Map<string, { order: string[]; removed: Set<string> }>()
  for (const row of queueRows ?? []) {
    const queue = queues.get(row.show_requirement_id) ?? { order: [], removed: new Set<string>() }
    if (row.removed) queue.removed.add(row.artist_id)
    else queue.order.push(row.artist_id)
    queues.set(row.show_requirement_id, queue)
  }

  const entries = waveEntries({ requirements, pool, involved, filled, pendingAuto, pendingManual, now, settings, rush, queues })

  return {
    ok: true,
    plan: {
      show,
      requirements,
      pool,
      entries,
      involved,
      invalidPendingOfferIds,
      reopenedRequirementIds,
      expiresAt,
      settings,
      queues,
      offers: existingOffers,
      pendingAuto,
      bookedByRequirement,
      rush,
      now,
      lineupDeadline,
    },
  }
}

// ─── Motoren ─────────────────────────────────────────────────────────────

/**
 * Sender de tilbudene showet skal ha akkurat nå.
 *
 * Reglene står i lib/booking-rules.ts og lib/booking-schedule.ts; her hentes
 * radene og skrives tilbudene. Kort fortalt:
 *
 *  1. Utløpte tilbud merkes, og ubesvarte tilbud som ikke lenger holder mål
 *     trekkes (`pendingOffersToWithdraw`).
 *  2. Hver plass får et mål for hvor mange tilbud som skal stå ute i dag —
 *     to per ledig sete dag 1, fire dag 2, opp til ti (`offerTarget`).
 *     I hastemodus, nær lineup-fristen, gjelder taket med en gang.
 *  3. Plassen med færrest kandidater velger først (`orderByScarcity`), og
 *     tilbudene deles ut i runder, så én plass ikke tømmer listen.
 *  4. Innenfor plassen følges bookerens kø fra «Review your line-up», og
 *     resten står i poengrekkefølge (`spotOrder`).
 *
 * Funksjonen kan kalles så ofte den vil — etter hvert svar, hver morgen,
 * når bookeren endrer noe. Målet gjør at ingen får flere tilbud enn bølgen
 * tilsier.
 *
 * Tilbud bookeren sendte selv (`source: 'manual'`) holder setet: motoren
 * trekker dem ikke fordi komikeren ikke matcher plassen, og sender ikke
 * setet til andre mens de venter på svar.
 */
export async function runBookingWave(showId: string) {
  const admin = createAdminClient()
  let offersCreated = 0
  let candidatesMatched = 0

  const result = await loadShowPlan(admin, showId, 'run')
  if (!result.ok) return { offersCreated, candidatesMatched }
  const { plan } = result

  if (plan.invalidPendingOfferIds.length > 0) {
    await admin
      .from('booking_offers')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .in('id', plan.invalidPendingOfferIds)
  }

  const assignments = planOfferWave({
    entries: plan.entries,
    pool: plan.pool,
    involved: plan.involved,
    settings: plan.settings,
    queues: plan.queues,
  })

  candidatesMatched = assignments.length
  if (assignments.length === 0) return { offersCreated, candidatesMatched }

  const baseUrl = appUrl()
  const { show, expiresAt } = plan
  for (const { candidate, req } of assignments) {
    const details = offerDetails(show, req)
    const { data: offer, error: offerError } = await admin
      .from('booking_offers')
      .insert({
        show_id: showId,
        artist_id: candidate.id,
        show_requirement_id: req.id,
        status: 'sent',
        sent_at: new Date().toISOString(),
        expires_at: expiresAt,
        fee_amount: details.feeAmount,
        currency: details.currency,
      })
      .select('token')
      .single()

    if (offerError || !offer) continue
    offersCreated++

    const email = {
      email: candidate.email,
      full_name: candidate.full_name,
      show_title: show.title,
      show_date: show.date,
      show_time: details.show_time,
      venue: details.venue,
      role_name: details.role_name,
      fee_label: details.fee_label,
      expires_at: expiresAt,
      token: offer.token,
      response_url: `${baseUrl}/booking-offer/${offer.token}`,
    }

    const delivery = plan.reopenedRequirementIds.has(req.id)
      ? await sendSpotAvailableEmail(email)
      : await sendBookingOfferEmail(email)

    // Tilbudet står i basen og holder setet i sju dager uansett. Gikk ikke
    // e-posten ut, ser det utenfra ut som at komikeren bare ikke svarer.
    if (!delivery.success) {
      console.error(`[Booking] Offer ${offer.token} created but the email failed: ${delivery.error}`)
    }
  }

  return { offersCreated, candidatesMatched }
}

// ─── Køen bookeren ser: «Review your line-up» ────────────────────────────

/** En komiker slik bookeren ser hen i køen: navn og nivå, aldri scoren. */
export type QueueComedian = {
  artistId: string
  name: string
  initials: string
  /** Profilbildet. Bookeren kjenner komikerne på ansiktet, ikke på initialene. */
  imageUrl: string | null
  skillLevel: SkillLevel
  /** Siste kveld i klubben, `YYYY-MM-DD`. Null = har aldri spilt der. */
  lastClubBookingDate: string | null
}

/** Hvor en komiker som alt er spurt på plassen, står. */
export type QueueOfferState = 'sent' | 'accepted' | 'declined' | 'expired' | 'booked'

export type LineupQueueSpot = {
  requirementId: string
  /** Plassens nummer i lineupen, 1 først. */
  position: number
  roleName: string
  minSkillLevel: SkillLevel | null
  /** Hvor mange på listen som passer plassen og kan den kvelden. */
  matchCount: number
  /** Hvorfor motoren ikke sender noe på plassen nå. Null = den gjør det. */
  note: 'submissions_open' | 'filled' | null
  slotsNeeded: number
  /** Tilbud som går ut nå (bølge 1, eller neste påfyll om showet er i gang). */
  nowCount: number
  /** Tilbud i tillegg i morgen, om ingen har svart. */
  tomorrowCount: number
  /** Køen: de som kan få tilbud, i den rekkefølgen de spørres. */
  queue: QueueComedian[]
  /** De som alt er spurt eller booket på plassen. Står fast øverst. */
  asked: Array<QueueComedian & { state: QueueOfferState }>
  /** Kan legges til: tatt ut av bookeren, eller langt nede i køen. */
  addable: Array<QueueComedian & { removed: boolean }>
}

export type LineupQueue =
  | {
    ok: true
    show: { date: string; venue: string | null; lineupDeadline: string; started: boolean }
    /** Nær lineup-fristen: alle tilbudene går ut på en gang. */
    rush: boolean
    spots: LineupQueueSpot[]
  }
  | { ok: false; reason: PlanSkipReason }

/** Hvor mange komikere køen viser per plass. Resten ligger under «Add comedian». */
const MAX_QUEUE_PER_SPOT = 40

const DAY_MS = 24 * 60 * 60 * 1000

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  return letters.map((part) => part.charAt(0).toUpperCase()).join('') || '?'
}

/**
 * Køen per plass, slik dialogen «Review your line-up» viser den.
 *
 * Regnet av `loadShowPlan` og `spotOrder`, de samme som motoren bruker — så
 * rekkefølgen bookeren ser, er rekkefølgen tilbudene går ut i. Fordelingen
 * mellom plassene (hvem som går til hvilken når de står først flere steder)
 * gjør dialogen selv med `allocateWave`, så den følger med mens bookeren
 * flytter på folk.
 */
export async function getLineupQueue(showId: string): Promise<LineupQueue> {
  const admin = createAdminClient()
  const result = await loadShowPlan(admin, showId, 'preview')
  if (!result.ok) return result
  const { plan } = result

  const candidateById = new Map(plan.pool.map((candidate) => [candidate.id, candidate]))
  const toComedian = (candidate: Candidate): QueueComedian => {
    const name = candidate.stage_name?.trim() || candidate.full_name
    return {
      artistId: candidate.id,
      name,
      initials: initialsOf(name),
      imageUrl: candidate.profile_image_url,
      skillLevel: skillLevelFromScore(candidate.score),
      lastClubBookingDate: candidate.lastClubBookingDate,
    }
  }

  // De som alt er spurt, men har falt ut av listen (tatt av klubben, flagget),
  // står fortsatt med tilbudet sitt. Navnet hentes for dem.
  const askedIds = [...new Set(plan.offers.map((offer) => offer.artist_id))]
  const missing = askedIds.filter((id) => !candidateById.has(id))
  const { data: missingRows } = missing.length > 0
    ? await admin.from('artists').select('id, full_name, stage_name, profile_image_url').in('id', missing)
    : { data: [] as Array<{ id: string; full_name: string; stage_name: string | null; profile_image_url: string | null }> }
  const missingById = new Map((missingRows ?? []).map((row) => [row.id, row]))

  const askedComedian = (artistId: string): QueueComedian => {
    const candidate = candidateById.get(artistId)
    if (candidate) return toComedian(candidate)
    const row = missingById.get(artistId)
    const name = row ? row.stage_name?.trim() || row.full_name : 'Comedian'
    return { artistId, name, initials: initialsOf(name), imageUrl: row?.profile_image_url ?? null, skillLevel: 'medium', lastClubBookingDate: null }
  }

  const tomorrow = new Date(plan.now.getTime() + DAY_MS)

  const spots = plan.requirements.map((req, index): LineupQueueSpot => {
    const queue = plan.queues.get(req.id)
    const entry = plan.entries.find((row) => row.requirementId === req.id)

    const eligible = plan.pool.filter((candidate) => isEligibleForSpot(candidate, req, plan.involved))
    const ordered = spotOrder(eligible, queue, plan.settings)
    const removed = eligible.filter((candidate) => queue?.removed.has(candidate.id))

    // Tilbudene på plassen, nyeste status per komiker. En bekreftet plass
    // vinner over tilbudet som førte til den.
    const states = new Map<string, QueueOfferState>()
    for (const offer of plan.offers) {
      if (offer.show_requirement_id !== req.id) continue
      const state = offer.status as QueueOfferState
      if (['sent', 'accepted', 'declined', 'expired'].includes(state)) states.set(offer.artist_id, state)
    }
    for (const artistId of plan.bookedByRequirement.get(req.id) ?? []) states.set(artistId, 'booked')

    let nowCount = 0
    let tomorrowCount = 0
    if (entry) {
      nowCount = entry.maxNewOffers
      const today = offerTarget({ autoStartedAt: req.auto_started_at, now: plan.now, settings: plan.settings, rush: plan.rush })
      const next = offerTarget({ autoStartedAt: req.auto_started_at, now: tomorrow, settings: plan.settings, rush: plan.rush })
      tomorrowCount = Math.max(0, (next - today) * entry.slotsNeeded)
    }

    return {
      requirementId: req.id,
      position: index + 1,
      roleName: req.role_name,
      minSkillLevel: req.min_skill_level && req.min_skill_level !== 'low' ? req.min_skill_level : null,
      matchCount: plan.pool.filter((candidate) => isEligibleForSpot(candidate, req, new Set())).length,
      note: req.submissions_open ? 'submissions_open' : entry ? null : 'filled',
      slotsNeeded: entry?.slotsNeeded ?? 0,
      nowCount,
      tomorrowCount,
      queue: ordered.slice(0, MAX_QUEUE_PER_SPOT).map(toComedian),
      asked: [...states].map(([artistId, state]) => ({ ...askedComedian(artistId), state })),
      addable: [
        ...removed.map((candidate) => ({ ...toComedian(candidate), removed: true })),
        ...ordered.slice(MAX_QUEUE_PER_SPOT).map((candidate) => ({ ...toComedian(candidate), removed: false })),
      ],
    }
  })

  return {
    ok: true,
    show: {
      date: plan.show.date,
      venue: showVenue(plan.show).line || null,
      lineupDeadline: plan.lineupDeadline.toISOString(),
      started: ENGINE_STATUSES.includes(plan.show.status as (typeof ENGINE_STATUSES)[number]),
    },
    rush: plan.rush,
    spots,
  }
}

/** Køene fra dialogen: rekkefølgen per plass, og hvem som er tatt ut. */
export type LineupQueueInput = Record<string, { order: string[]; removed: string[] }>

/**
 * Lagrer bookerens kø.
 *
 * Bare plasser på dette showet, og bare komikere på klubbens liste. Rader for
 * komikere dialogen ikke nevner (de som ikke kan den kvelden akkurat nå),
 * står urørt: et «ta ut» skal ikke forsvinne fordi komikeren en stund ikke
 * var med i listen.
 */
export async function saveLineupQueues(showId: string, clubId: string | null, input: LineupQueueInput) {
  const admin = createAdminClient()
  const [{ data: requirementRows, error: reqError }, { data: rosterRows, error: rosterError }] = await Promise.all([
    admin.from('show_requirements').select('id').eq('show_id', showId),
    clubId
      ? admin.from('club_artists').select('artist_id').eq('club_id', clubId)
      : Promise.resolve({ data: [] as Array<{ artist_id: string }>, error: null }),
  ])
  if (reqError ?? rosterError) throw new Error((reqError ?? rosterError)!.message)

  const spotIds = new Set((requirementRows ?? []).map((row) => row.id))
  const roster = new Set((rosterRows ?? []).map((row) => row.artist_id))
  const updatedAt = new Date().toISOString()

  const rows = Object.entries(input).flatMap(([requirementId, { order, removed }]) => {
    if (!spotIds.has(requirementId)) return []
    const seen = new Set<string>()
    const queued = order.filter((id) => roster.has(id) && !seen.has(id) && seen.add(id))
    const out = removed.filter((id) => roster.has(id) && !seen.has(id) && seen.add(id))
    return [
      ...queued.map((artistId, index) => ({ show_requirement_id: requirementId, artist_id: artistId, position: index + 1, removed: false, updated_at: updatedAt })),
      // Etter alle i køen, så en som tas inn igjen, ikke hopper foran.
      ...out.map((artistId, index) => ({ show_requirement_id: requirementId, artist_id: artistId, position: queued.length + index + 1, removed: true, updated_at: updatedAt })),
    ]
  })

  if (rows.length === 0) return
  const { error } = await admin.from('show_requirement_queue').upsert(rows, { onConflict: 'show_requirement_id,artist_id' })
  if (error) throw new Error(error.message)
}
