'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import {
  sendBookingOfferEmail,
  sendBookingConfirmedEmail,
  sendOfferDeclinedEmail,
  sendOfferReminderEmail,
  sendOfferWithdrawnConflictEmail,
  sendSpotFilledEmail,
  sendSpotAvailableEmail,
} from '@/lib/email/mailer'
import { generateShowPoster } from '@/lib/actions/ai'
import { resolvePalette } from '@/lib/marketing/palette'
import { requirementFeeLabel } from '@/lib/booking-spots'
import {
  hasScheduleConflict,
  matchesHardRequirements,
  offerQuota,
  orderByScarcity,
  pendingOffersToWithdraw,
  rankCandidates,
  type ArtistBooking,
} from '@/lib/booking-rules'
import {
  isRushMode,
  lineupDeadlineAt,
  offerExpiresAt,
  offerTarget,
  osloDateString,
  shouldRemind,
} from '@/lib/booking-schedule'
import { lineupDeadlineDaysFor, type BookingSettings } from '@/lib/booking-settings'
import { loadBookingSettings } from '@/lib/booking-settings-store'
import type { ArtistGender, ArtistType, EnergyLevel, RequirementCompensationType } from '@/types/database'
import { assertArtistBookableForShow } from '@/lib/club-artists'
import { rollBackIfSeatWasTaken } from '@/lib/booking-seats'
import { clubArtistReviews, withClubReview } from '@/lib/club-artist-profile'
import { getClubForShow, isClubPayoutReady, missingReadinessLabels } from '@/lib/stripe-connect'
import { appUrl } from '@/lib/app-url'
import { showVenue } from '@/lib/show-venue'

/**
 * Showene motoren jobber på.
 *
 * `published` er med med vilje: faller en komiker fra etter at billettene er
 * lagt ut, blir showet stående publisert, og plassen skal fylles igjen. Et
 * `fullbooked` show har ingen ledige seter, så kvoten gir det ingenting —
 * men blir en plass ledig igjen, skal motoren ta den.
 */
const ENGINE_STATUSES = ['booking', 'fullbooked', 'published'] as const

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

function offerDetails(show: OfferShow, requirement: OfferRequirement) {
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
type Candidate = {
  id: string
  email: string
  full_name: string
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
      .select('id, email, full_name, gender')
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

type EngineRequirement = {
  id: string
  role_name: string
  quantity: number
  lineup_position: number
  energy_level: string
  required_gender: string
  submissions_open: boolean | null
  auto_started_at: string | null
  compensation_type: RequirementCompensationType | null
  compensation_amount: number | null
  compensation_percent: number | null
}

/**
 * Om komikeren kan få tilbud på nettopp denne plassen.
 *
 * Kravene om kvelden — opptatt, kollisjon — sitter på kandidaten og gjelder
 * hele showet. Kravene om plassen sjekkes her.
 */
function isEligible(candidate: Candidate, req: EngineRequirement, involved: ReadonlySet<string>): boolean {
  if (involved.has(candidate.id)) return false
  if (candidate.unavailable || candidate.conflicted) return false
  return matchesHardRequirements(candidate, req)
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
 *  4. Kandidatene står i poengrekkefølge (`rankCandidates`).
 *
 * Funksjonen kan kalles så ofte den vil — etter hvert svar, hver morgen,
 * når bookeren endrer noe. Målet gjør at ingen får flere tilbud enn bølgen
 * tilsier.
 *
 * Tilbud bookeren sendte selv (`source: 'manual'`) holder setet: motoren
 * trekker dem ikke fordi komikeren ikke matcher plassen, og sender ikke
 * setet til andre mens de venter på svar.
 */
export async function bookShow(showId: string) {
  const admin = createAdminClient()
  let offersCreated = 0
  let candidatesMatched = 0

  const { data: show, error: showError } = await admin
    .from('shows')
    .select('id, title, date, start_time, venue_name, venue_address, currency, status, club_id')
    .eq('id', showId)
    .single()

  if (showError || !show) throw new Error('Show not found')
  if (!ENGINE_STATUSES.includes(show.status as (typeof ENGINE_STATUSES)[number])) {
    return { offersCreated, candidatesMatched }
  }

  const { data: requirementRows, error: reqError } = await admin
    .from('show_requirements')
    .select('*')
    .eq('show_id', showId)
    .order('lineup_position')
    .order('created_at')

  if (reqError) throw new Error(reqError.message)
  if (!requirementRows?.length) return { offersCreated, candidatesMatched }
  const requirements = requirementRows as unknown as EngineRequirement[]

  // Må skje før tilbudene telles: et utløpt tilbud som fortsatt står `sent`
  // spiser en plass i kvoten under, og da sendes det aldri et nytt.
  await expireStaleOffers(showId)

  const settings = await loadBookingSettings(admin)
  const now = new Date()

  const { data: club } = show.club_id
    ? await admin.from('clubs').select('lineup_deadline_days').eq('id', show.club_id).maybeSingle()
    : { data: null }

  const deadlineDays = lineupDeadlineDaysFor(club, settings)
  const lineupDeadline = lineupDeadlineAt(show.date, deadlineDays)
  const rush = isRushMode({ now, showDate: show.date, deadlineDays, settings })

  // På showdagen sender motoren ingenting. Da er det bookeren som må ringe.
  const expiresAt = offerExpiresAt({ now, showDate: show.date, lineupDeadline, settings })
  if (!expiresAt) return { offersCreated, candidatesMatched }

  const pool = await loadCandidates(admin, show, settings)
  if (pool.length === 0) return { offersCreated, candidatesMatched }

  const [
    { data: existingOffers, error: offersError },
    { data: existingSpots, error: spotsError },
    { data: excludedArtists, error: exclusionsError },
  ] = await Promise.all([
    // 'declined' må være med. Uten den faller en artist som nettopp takket
    // nei rett tilbake i kandidatlisten, og siden declineBookingOffer kjører
    // motoren med én gang, fikk de det samme showet tilbudt på nytt umiddelbart.
    //
    // 'expired' av nøyaktig samme grunn: expireStaleOffers() over her flipper
    // utløpte `sent` til `expired` i samme pass, og uten statusen her ble
    // artisten kandidat igjen sekunder senere og fikk showet tilbudt på nytt.
    admin.from('booking_offers')
      .select('id, artist_id, show_requirement_id, status, source')
      .eq('show_id', showId)
      .in('status', ['sent', 'accepted', 'declined', 'expired']),
    admin.from('confirmed_spots')
      .select('artist_id, show_requirement_id, status, cancelled_at')
      .eq('show_id', showId),
    admin.from('show_artist_booking_exclusions').select('artist_id').eq('show_id', showId),
  ])

  // Uten disse radene vet motoren ikke hvem som allerede har tilbud, plass
  // eller er tatt av showet — og ville sendt det til dem på nytt. Da er det
  // bedre å stå over denne runden.
  const lookupError = offersError ?? spotsError ?? exclusionsError
  if (lookupError) {
    console.error(`[Booking] Could not load offers, spots or exclusions for show ${showId}: ${lookupError.message}`)
    return { offersCreated, candidatesMatched }
  }

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
      offers: existingOffers ?? [],
      bookableArtists: candidateById,
      requirements: requirementById,
      excludedArtistIds,
    }),
    ...(existingOffers ?? [])
      .filter((offer) => offer.status === 'sent' && blockedForTheEvening.has(offer.artist_id))
      .map((offer) => offer.id),
  ])]

  if (invalidPendingOfferIds.length > 0) {
    await admin
      .from('booking_offers')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .in('id', invalidPendingOfferIds)
  }

  const activeOffers = (existingOffers ?? []).filter((offer) => !invalidPendingOfferIds.includes(offer.id))
  const activeSpots = (existingSpots ?? []).filter((spot) => ['confirmed', 'completed', 'paid'].includes(spot.status))

  const alreadyInvolved = new Set([
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

  const filledByRequirement = new Map<string, number>()
  for (const spot of activeSpots) {
    filledByRequirement.set(spot.show_requirement_id, (filledByRequirement.get(spot.show_requirement_id) ?? 0) + 1)
  }

  // Motorens egne tilbud og bookerens telles hver for seg — se `offerQuota`.
  const pendingAuto = new Map<string, number>()
  const pendingManual = new Map<string, number>()
  for (const offer of activeOffers) {
    if (offer.status !== 'sent' || !offer.show_requirement_id) continue
    const counts = offer.source === 'manual' ? pendingManual : pendingAuto
    counts.set(offer.show_requirement_id, (counts.get(offer.show_requirement_id) ?? 0) + 1)
  }

  const entries = requirements.flatMap((req) => {
    // En plass klubben har åpnet for søknader skal motoren holde fingrene
    // fra. Uten dette rekker den å fylle plassen med egne tilbud før noen
    // har rukket å søke — og ingenting feiler, funksjonen ser bare død ut.
    if (req.submissions_open) return []
    // Og en plass automatikken ikke er startet på, rører den ikke. Det er
    // `auto_started_at` som sier når bølgen begynte å telle.
    if (!req.auto_started_at) return []

    const target = offerTarget({ autoStartedAt: req.auto_started_at, now, settings, rush })
    const { slotsNeeded, currentPendingOffers, maxNewOffers } = offerQuota({
      quantity: req.quantity,
      filled: filledByRequirement.get(req.id) ?? 0,
      pendingAuto: pendingAuto.get(req.id) ?? 0,
      pendingManual: pendingManual.get(req.id) ?? 0,
      target,
    })

    if (slotsNeeded <= 0 || maxNewOffers <= 0) return []

    return [{
      req,
      requirementId: req.id,
      lineupPosition: req.lineup_position,
      slotsNeeded,
      currentPendingOffers,
      maxNewOffers,
      candidateCount: pool.filter((candidate) => isEligible(candidate, req, alreadyInvolved)).length,
    }]
  })

  if (entries.length === 0) return { offersCreated, candidatesMatched }

  const ordered = orderByScarcity(entries)
  const involved = new Set(alreadyInvolved)
  const assignments: Array<{ candidate: Candidate; req: EngineRequirement }> = []
  const assignedByRequirement = new Map<string, number>()

  const maxRounds = Math.max(...ordered.map((entry) => Math.ceil(entry.maxNewOffers / entry.slotsNeeded)))

  for (let round = 0; round < maxRounds; round++) {
    for (const entry of ordered) {
      const assigned = assignedByRequirement.get(entry.requirementId) ?? 0
      const remaining = entry.maxNewOffers - assigned
      if (remaining <= 0) continue

      const waveSize = Math.min(entry.slotsNeeded, remaining)
      const eligible = pool.filter((candidate) => isEligible(candidate, entry.req, involved))
      const chosen = rankCandidates(eligible, settings).slice(0, waveSize)

      for (const candidate of chosen) {
        involved.add(candidate.id)
        assignments.push({ candidate, req: entry.req })
        assignedByRequirement.set(entry.requirementId, (assignedByRequirement.get(entry.requirementId) ?? 0) + 1)
      }
    }
  }

  candidatesMatched = assignments.length
  if (assignments.length === 0) return { offersCreated, candidatesMatched }

  const baseUrl = appUrl()
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

    const delivery = reopenedRequirementIds.has(req.id)
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

/**
 * Setter i gang automatikken på plassene i et show.
 *
 * `auto_started_at` er dag 1 i bølgen. Den settes av Start booking, når en
 * plass legges til på et show som allerede er i gang, og når en plass
 * lukkes for søknader. Uten den rører motoren ikke plassen — det er slik en
 * plass som står i utkast ikke sender ut ti tilbud den dagen den startes.
 *
 * Settes den på nytt, begynner bølgen forfra. Det er poenget når en komiker
 * faller fra: da skal de beste få sjansen først også andre gangen.
 */
export async function startAutoBooking(showId: string, requirementId?: string, options: { restart?: boolean } = {}) {
  const admin = createAdminClient()

  // Bare på et show som faktisk er i gang.
  //
  // Vakten står her og ikke hos kallstedene, fordi feilen den hindrer er
  // usynlig: et utkast som blir stemplet, beholder stempelet når bookingen
  // omsider starter — og et utkast som har ligget i ti dager sender da hele
  // taket med tilbud på det som skulle vært dag én. Hele poenget med bølgene
  // er borte, og ingenting feiler.
  const { data: show } = await admin.from('shows').select('status').eq('id', showId).maybeSingle()
  if (!show || !ENGINE_STATUSES.includes(show.status as (typeof ENGINE_STATUSES)[number])) return

  let query = admin
    .from('show_requirements')
    .update({ auto_started_at: new Date().toISOString() })
    .eq('show_id', showId)
    .neq('submissions_open', true)

  if (requirementId) query = query.eq('id', requirementId)
  if (!options.restart) query = query.is('auto_started_at', null)

  const { error } = await query
  if (error) console.error(`[Booking] Could not start automation for show ${showId}: ${error.message}`)
}

export async function runAutomaticBookingForShow(showId: string) {
  const booking = await bookShow(showId)
  const fullbooked = await automateFullbookedShow(showId)
  return { booking, fullbooked }
}

export async function runAutomaticBookingForOpenShows() {
  const admin = createAdminClient()
  const today = osloDateString()
  const { data: shows } = await admin
    .from('shows')
    .select('id')
    .in('status', [...ENGINE_STATUSES])
    .is('deleted_at', null)
    .gte('date', today)
    .order('date', { ascending: true })

  const results = []
  for (const show of shows ?? []) {
    results.push(await runAutomaticBookingForShow(show.id))
  }
  return results
}

/**
 * Motoren for klubbens kommende show.
 *
 * Kalles når klubben legger en komiker på listen eller endrer rolle eller
 * energi på hen. Før kjørte registreringen av en ny komiker motoren for
 * *alle* show på plattformen — også show i klubber som aldri har hørt om
 * komikeren.
 */
export async function runAutomaticBookingForClub(clubId: string | null) {
  if (!clubId) return
  const admin = createAdminClient()
  const today = osloDateString()

  const { data: shows } = await admin
    .from('shows')
    .select('id')
    .eq('club_id', clubId)
    .in('status', [...ENGINE_STATUSES])
    .is('deleted_at', null)
    .gte('date', today)

  for (const show of shows ?? []) {
    await runAutomaticBookingForShow(show.id)
  }
}

/**
 * Påminnelsene om at svarfristen løper ut.
 *
 * Kjøres fra den daglige jobben. Ett tilbud får høyst én påminnelse, og
 * bare tilbud som hadde mer enn tre døgns frist da de gikk ut — se
 * `shouldRemind`.
 */
export async function sendBookingReminders() {
  const admin = createAdminClient()
  const settings = await loadBookingSettings(admin)
  const now = new Date()

  const { data: offers, error } = await admin
    .from('booking_offers')
    .select('id, token, artist_id, show_id, show_requirement_id, status, sent_at, expires_at, reminded_at')
    .eq('status', 'sent')
    .is('reminded_at', null)
    .not('expires_at', 'is', null)
    .lte('expires_at', new Date(now.getTime() + settings.reminder_hours * 60 * 60 * 1000).toISOString())
    .gt('expires_at', now.toISOString())

  if (error) {
    console.error(`[Booking] Could not load offers for reminders: ${error.message}`)
    return 0
  }

  const due = (offers ?? []).filter((offer) => shouldRemind({ offer, now, settings }))
  if (due.length === 0) return 0

  const [{ data: artists }, { data: shows }, { data: requirements }] = await Promise.all([
    admin.from('artists').select('id, email, full_name').in('id', [...new Set(due.map((o) => o.artist_id))]),
    admin.from('shows')
      .select('id, title, date, start_time, venue_name, venue_address, currency')
      .in('id', [...new Set(due.map((o) => o.show_id))]),
    admin.from('show_requirements')
      .select('id, role_name, compensation_type, compensation_amount, compensation_percent')
      .in('id', [...new Set(due.flatMap((o) => o.show_requirement_id ?? []))]),
  ])

  const artistById = new Map((artists ?? []).map((row) => [row.id, row]))
  const showById = new Map((shows ?? []).map((row) => [row.id, row]))
  const requirementById = new Map((requirements ?? []).map((row) => [row.id, row]))
  const baseUrl = appUrl()

  let sent = 0
  for (const offer of due) {
    const artist = artistById.get(offer.artist_id)
    const show = showById.get(offer.show_id)
    const requirement = offer.show_requirement_id ? requirementById.get(offer.show_requirement_id) : null
    if (!artist || !show || !requirement) continue

    const details = offerDetails(show, requirement)
    const delivery = await sendOfferReminderEmail({
      email: artist.email,
      full_name: artist.full_name,
      show_title: show.title,
      show_date: show.date,
      show_time: details.show_time,
      venue: details.venue,
      role_name: details.role_name,
      fee_label: details.fee_label,
      expires_at: offer.expires_at,
      response_url: `${baseUrl}/booking-offer/${offer.token}`,
    })

    // `reminded_at` settes bare når e-posten faktisk gikk. Ellers ville en
    // utsendingsfeil brukt opp komikerens ene påminnelse.
    if (!delivery.success) {
      console.error(`[Booking] Reminder for offer ${offer.id} failed: ${delivery.error}`)
      continue
    }

    await admin.from('booking_offers').update({ reminded_at: new Date().toISOString() }).eq('id', offer.id)
    sent++
  }

  return sent
}

/**
 * Publiserer showet når hele lineupen er bekreftet.
 *
 * Det finnes ingen vei til `published` med ledige plasser lenger. Publikum
 * kjøper billett til en kveld med navn på, og navn som dukker opp etterpå
 * rekker verken plakat eller markedsføring. Vil klubben kjøre med færre
 * komikere, sletter bookeren plassen — da er lineupen full.
 *
 * Databasen holder den samme grensen (migrasjon 053), så sjekken under er
 * den som gir en lesbar beskjed, ikke den som er load-bearing.
 */
export async function automateFullbookedShow(showId: string) {
  const admin = createAdminClient()

  const { data: requirements } = await admin
    .from('show_requirements')
    .select('id, role_name, quantity')
    .eq('show_id', showId)

  if (!requirements?.length) return { fullbooked: false, reason: 'no_requirements' as const }

  for (const req of requirements) {
    const { count } = await admin
      .from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', req.id)
      .in('status', ['confirmed', 'completed', 'paid'])

    if ((count ?? 0) < req.quantity) {
      return {
        fullbooked: false,
        reason: 'requirements_not_filled' as const,
        message: `Krav "${req.role_name}" er ikke fylt (${count ?? 0}/${req.quantity})`,
      }
    }
  }

  const { data: show } = await admin
    .from('shows')
    .select('title, slug, date, start_time, venue_name, venue_address, poster_url, published_at, selected_marketing_design_id, auto_poster_enabled, marketing_palette, club_id, status')
    .eq('id', showId)
    .single()

  if (!show) return { fullbooked: false, reason: 'show_not_found' as const }

  // Denne funksjonen publiserer showet, også fra cron. Er klubbens
  // Connect-konto ikke ferdig, ville billettsalget åpnet uten en selger å ta
  // imot pengene på vegne av.
  const club = await getClubForShow(showId)
  if (!isClubPayoutReady(club)) {
    return {
      fullbooked: false,
      reason: 'club_not_payable' as const,
      message: `Klubben mangler: ${missingReadinessLabels(club).join(', ')}`,
    }
  }

  const { data: spots } = await admin
    .from('confirmed_spots')
    .select('artist_id, show_requirement_id')
    .eq('show_id', showId)
    .in('status', ['confirmed', 'completed', 'paid'])

  const artistIds = [...new Set((spots ?? []).map((spot) => spot.artist_id))]
  const { data: artistRows } = artistIds.length > 0
    ? await admin.from('artists').select('id, full_name, stage_name, profile_image_url').in('id', artistIds)
    : { data: [] as Array<{ id: string; full_name: string; stage_name: string | null; profile_image_url: string | null }> }
  const artistById = new Map((artistRows ?? []).map((artist) => [artist.id, artist]))
  const requirementById = new Map((requirements ?? []).map((requirement) => [requirement.id, requirement.role_name]))

  let posterUrl = show.poster_url ?? null

  // AI-plakaten lages ikke av seg selv. De fleste klubber har sin egen
  // plakat, og en generert plakat som overrasker dem på publiseringstidspunktet
  // er verre enn ingen plakat. `auto_poster_enabled` er av som standard, og
  // klubben skrur den på per show i markedsføringsfanen om den vil ha den.
  if (!posterUrl && show.auto_poster_enabled) {
    const { data: clubBrand } = show.club_id
      ? await admin.from('clubs').select('brand_color').eq('id', show.club_id).maybeSingle()
      : { data: null }
    const clubBrandColor = clubBrand?.brand_color ?? null

    // Malen kan ligge i klubbens bibliotek og ikke på showet, så oppslaget går
    // på id alene — tilhørigheten ble sjekket da malen ble valgt.
    const { data: posterDesign } = show.selected_marketing_design_id
      ? await admin
        .from('show_marketing_designs')
        .select('label, file_url, file_path, file_name, mime_type, file_type')
        .eq('id', show.selected_marketing_design_id)
        .maybeSingle()
      : { data: null }

    posterUrl = await generateShowPoster(showId, {
      title: show.title,
      date: show.date,
      startTime: show.start_time,
      venue: showVenue(show).line ?? '',
      artists: (spots ?? []).flatMap((spot) => {
        const artist = artistById.get(spot.artist_id)
        if (!artist) return []
        return [{
          name: artist.stage_name ?? artist.full_name,
          profile_image_url: artist.profile_image_url,
          role_name: requirementById.get(spot.show_requirement_id) ?? null,
        }]
      }),
      designTemplate: posterDesign
        ? {
          label: posterDesign.label,
          fileUrl: posterDesign.file_url,
          filePath: posterDesign.file_path,
          fileName: posterDesign.file_name,
          mimeType: posterDesign.mime_type,
        }
        : null,
      palette: resolvePalette(show.marketing_palette, clubBrandColor),
    })
  }

  const alreadyPublished = Boolean(show.published_at)
  const publishedAt = show.published_at ?? new Date().toISOString()
  const posterWasGenerated = Boolean(posterUrl) && posterUrl !== show.poster_url

  const { error: publishError } = await admin.from('shows').update({
    status: 'published',
    published_at: publishedAt,
    ...(posterUrl ? { poster_url: posterUrl } : {}),
    ...(posterWasGenerated ? { poster_source: 'ai' as const } : {}),
  }).eq('id', showId).in('status', ['draft', 'booking', 'fullbooked'])

  if (publishError) {
    // Vakten i databasen (053) svarer her hvis noe har endret seg mellom
    // tellingen over og oppdateringen.
    return { fullbooked: false, reason: 'publish_rejected' as const, message: publishError.message }
  }

  // Er showet allerede publisert, holdes plakaten i sync uten å røre status.
  if (posterUrl && alreadyPublished) {
    await admin.from('shows').update({ poster_url: posterUrl })
      .eq('id', showId).eq('status', 'published')
  }

  // Markedsføringsoppgavene hører til publiseringen, ikke til hvilken vei
  // siste plass ble fylt. Et show bookeren fylte ved å legge komikere rett
  // inn i lineupen fikk før ingen oppgaver i det hele tatt.
  if (!alreadyPublished) {
    await admin.from('marketing_tasks').upsert([
      { show_id: showId, task_key: 'publish_event_page', label: 'Publiser event-side', is_completed: true },
      { show_id: showId, task_key: 'activate_ticket_sales', label: 'Aktiver billettsalg', is_completed: false },
      { show_id: showId, task_key: 'upload_poster', label: 'Plakat på plass', is_completed: Boolean(posterUrl) },
      { show_id: showId, task_key: 'create_facebook_event', label: 'Opprett Facebook-event', is_completed: false },
      { show_id: showId, task_key: 'share_facebook_groups', label: 'Del i Facebook-grupper', is_completed: false },
      { show_id: showId, task_key: 'send_calendar_partners', label: 'Send til kalenderpartnere', is_completed: false },
      { show_id: showId, task_key: 'schedule_email', label: 'Planlegg e-postkampanje', is_completed: false },
    ], { onConflict: 'show_id,task_key', ignoreDuplicates: true })

    // Fylles siste plass av et ja, har `accept_booking_offer` allerede
    // seedet de samme radene — med event-siden *ikke* publisert. Upserten
    // over hopper over eksisterende rader, så uten dette sto oppgaven
    // «Publiser event-side» igjen som ugjort på et show som nettopp ble
    // publisert.
    await admin.from('marketing_tasks')
      .update({ is_completed: true })
      .eq('show_id', showId)
      .eq('task_key', 'publish_event_page')

    if (posterUrl) {
      await admin.from('marketing_tasks')
        .update({ is_completed: true })
        .eq('show_id', showId)
        .eq('task_key', 'upload_poster')
    }
  }

  // `publishedNow` skiller «ble publisert nå» fra «var publisert fra før».
  // Den daglige jobben teller publiseringer, og uten skillet talte den hvert
  // ferdige show på nytt hver eneste dag.
  return { fullbooked: true, posterUrl, published: true, publishedNow: !alreadyPublished, publishedAt }
}

/**
 * Trekker komikerens ubesvarte tilbud på show som kolliderer med den kvelden
 * hen nettopp takket ja til.
 *
 * Ubesvarte tilbud på to show samme kveld er lov — det er ja-et som avgjør.
 * Men når ja-et er gitt, er de andre tilbudene umulige, og da skal de bort
 * med en gang: plassene skal ut til noen andre, og komikeren skal slippe å
 * få et tilbud hen ikke kan ta.
 *
 * Gjøres her og ikke i databasefunksjonen, fordi komikeren skal ha en e-post
 * som sier hvorfor tilbudet forsvant, og fordi motoren må kjøre for de
 * showene etterpå.
 */
async function withdrawConflictingOffers(artistId: string, acceptedShowId: string) {
  const admin = createAdminClient()

  const { data: acceptedShow } = await admin
    .from('shows')
    .select('id, title, date, start_time')
    .eq('id', acceptedShowId)
    .maybeSingle()

  if (!acceptedShow) return

  const { data: offers } = await admin
    .from('booking_offers')
    .select('id, show_id')
    .eq('artist_id', artistId)
    .eq('status', 'sent')
    .neq('show_id', acceptedShowId)

  if (!offers?.length) return

  const [{ data: shows }, settings, { data: artist }] = await Promise.all([
    admin.from('shows').select('id, title, date, start_time').in('id', [...new Set(offers.map((o) => o.show_id))]),
    loadBookingSettings(admin),
    admin.from('artists').select('email, full_name').eq('id', artistId).maybeSingle(),
  ])

  const showById = new Map((shows ?? []).map((row) => [row.id, row]))

  for (const offer of offers) {
    const show = showById.get(offer.show_id)
    if (!show) continue

    const conflict = hasScheduleConflict({
      showId: show.id,
      date: show.date,
      startTime: show.start_time,
      bookings: [{ show_id: acceptedShow.id, date: acceptedShow.date, start_time: acceptedShow.start_time }],
      conflictWindowHours: settings.conflict_window_hours,
    })
    if (!conflict) continue

    // `declined` og ikke `cancelled`: for showet er dette et nei, og motoren
    // skal ikke tilby den samme kvelden på nytt. `cancelled` betyr at
    // bookeren trakk tilbudet.
    await admin
      .from('booking_offers')
      .update({ status: 'declined', responded_at: new Date().toISOString() })
      .eq('id', offer.id)
      .eq('status', 'sent')

    if (artist) {
      await sendOfferWithdrawnConflictEmail({
        email: artist.email,
        full_name: artist.full_name,
        show_title: show.title,
        show_date: show.date,
        booked_show_title: acceptedShow.title,
      })
    }

    await runAutomaticBookingForShow(show.id)
  }
}

/**
 * Komikeren takker ja.
 *
 * Selve tildelingen skjer i databasefunksjonen `accept_booking_offer`
 * (migrasjon 051), som låser på komikeren, avviser et ja som ville
 * dobbeltbooket hen, og fyller plassen i én transaksjon.
 */
export async function acceptBookingOffer(token: string) {
  const admin = createAdminClient()

  const { data: accepted, error } = await admin
    .rpc('accept_booking_offer', { p_token: token })
    .single()

  if (error || !accepted) throw new Error(error?.message ?? 'Offer not found or already responded')

  if (accepted.should_notify && accepted.result === 'filled_by_other') {
    const { data: artist } = await admin
      .from('artists')
      .select('email, full_name')
      .eq('id', accepted.artist_id)
      .single()

    if (artist) await sendSpotFilledEmail({ email: artist.email, full_name: artist.full_name })
  }

  if (accepted.should_notify && accepted.result === 'accepted') {
    const [{ data: artist }, { data: show }, { data: requirement }] = await Promise.all([
      admin.from('artists').select('email, full_name').eq('id', accepted.artist_id).single(),
      admin
        .from('shows')
        .select('title, date, start_time, venue_name, venue_address, currency')
        .eq('id', accepted.show_id)
        .single(),
      admin
        .from('show_requirements')
        .select('role_name, compensation_type, compensation_amount, compensation_percent')
        .eq('id', accepted.show_requirement_id)
        .single(),
    ])

    if (artist) {
      const details = show && requirement ? offerDetails(show, requirement) : null
      await sendBookingConfirmedEmail({
        email: artist.email,
        full_name: artist.full_name,
        show_title: show?.title ?? '',
        show_date: show?.date ?? '',
        show_time: details?.show_time,
        venue: details?.venue,
        fee_label: details?.fee_label,
        portal_url: `${appUrl()}/artist-app/bookings`,
      })
    }

    await withdrawConflictingOffers(accepted.artist_id, accepted.show_id)
  }

  if (['accepted', 'already_booked', 'filled_by_other', 'conflict'].includes(accepted.result)) {
    await runAutomaticBookingForShow(accepted.show_id)
  }

  return {
    result: accepted.result as
      | 'accepted' | 'filled_by_other' | 'already_booked' | 'conflict'
      | 'declined' | 'expired' | 'cancelled',
  }
}

export async function acceptBookingOfferById(offerId: string) {
  const admin = createAdminClient()

  const { data: offer, error: offerError } = await admin
    .from('booking_offers')
    .select('id, show_id, artist_id, show_requirement_id, token, status, fee_amount, currency')
    .eq('id', offerId)
    .single()

  if (offerError || !offer) throw new Error(offerError?.message ?? 'Bookingtilbudet finnes ikke.')

  // Statusen ble lest, men aldri sjekket. Bookeren kunne dermed sette et
  // avslått, utløpt eller trukket tilbud til «godtatt» fra nedtrekkslisten,
  // og komikeren havnet i lineupen på et show hen hadde sagt nei til — og
  // fikk i tillegg sine *andre* bookinger trukket som kolliderende.
  if (!['sent', 'accepted'].includes(offer.status)) {
    throw new Error('Dette tilbudet er allerede besvart, og kan ikke godtas på nytt.')
  }

  const { data: existingOfferSpot } = await admin
    .from('confirmed_spots')
    .select('id')
    .eq('booking_offer_id', offer.id)
    .in('status', ['confirmed', 'completed', 'paid'])
    .maybeSingle()

  if (existingOfferSpot) {
    await admin
      .from('booking_offers')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', offer.id)
    await runAutomaticBookingForShow(offer.show_id)
    return { result: 'accepted' as const, confirmedSpotId: existingOfferSpot.id, repaired: false }
  }

  const { data: existingArtistSpot } = await admin
    .from('confirmed_spots')
    .select('id')
    .eq('show_id', offer.show_id)
    .eq('artist_id', offer.artist_id)
    .in('status', ['confirmed', 'completed', 'paid'])
    .maybeSingle()

  if (existingArtistSpot) {
    await admin
      .from('booking_offers')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .eq('id', offer.id)
    throw new Error('Denne artisten er allerede i lineupen for dette showet.')
  }

  // Samme grense som når komikeren svarer selv: ingen kan stå på to scener
  // samme kveld, heller ikke når det er bookeren som trykker.
  await assertArtistBookableForShow(admin, offer.show_id, offer.artist_id)

  const [{ data: requirement }, { count: filled }] = await Promise.all([
    admin
      .from('show_requirements')
      .select('quantity, role_name')
      .eq('id', offer.show_requirement_id)
      .single(),
    admin
      .from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', offer.show_requirement_id)
      .in('status', ['confirmed', 'completed', 'paid']),
  ])

  if (requirement && (filled ?? 0) >= requirement.quantity) {
    await admin
      .from('booking_offers')
      .update({ status: 'filled_by_other', responded_at: new Date().toISOString() })
      .eq('id', offer.id)
    throw new Error(`Rollen "${requirement.role_name}" er allerede fylt.`)
  }

  const { data: spot, error: spotError } = await admin
    .from('confirmed_spots')
    .insert({
      show_id: offer.show_id,
      artist_id: offer.artist_id,
      show_requirement_id: offer.show_requirement_id,
      booking_offer_id: offer.id,
      fee_amount: offer.fee_amount,
      currency: offer.currency,
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (spotError || !spot) throw new Error(spotError?.message ?? 'Kunne ikke opprette lineup-spot.')

  // Tellingen over og innsettingen her er to omganger. Kom noen annen inn
  // imellom, angrer vi vår egen rad i stedet for å la plassen stå overfylt.
  await rollBackIfSeatWasTaken(admin, { requirementId: offer.show_requirement_id, spotId: spot.id })

  await admin
    .from('booking_offers')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', offer.id)

  const { count: nowFilled } = await admin
    .from('confirmed_spots')
    .select('*', { count: 'exact', head: true })
    .eq('show_requirement_id', offer.show_requirement_id)
    .in('status', ['confirmed', 'completed', 'paid'])

  if (requirement && (nowFilled ?? 0) >= requirement.quantity) {
    await admin
      .from('booking_offers')
      .update({ status: 'filled_by_other' })
      .eq('show_requirement_id', offer.show_requirement_id)
      .eq('status', 'sent')
      .neq('id', offer.id)
  }

  await admin
    .from('booking_offers')
    .update({ status: 'cancelled' })
    .eq('show_id', offer.show_id)
    .eq('artist_id', offer.artist_id)
    .eq('status', 'sent')
    .neq('id', offer.id)

  await withdrawConflictingOffers(offer.artist_id, offer.show_id)
  await runAutomaticBookingForShow(offer.show_id)
  return { result: 'accepted' as const, confirmedSpotId: spot.id, repaired: true }
}

export async function cancelConfirmedSpotForOffer(offerId: string) {
  const admin = createAdminClient()
  const { data: cancelled } = await admin
    .from('confirmed_spots')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('booking_offer_id', offerId)
    .in('status', ['confirmed', 'completed', 'paid'])
    .select('show_id, show_requirement_id, artist_id')

  // Setet er ledig igjen, og da skal bølgen begynne forfra — ellers arver
  // den dagen den gamle bølgen var kommet til, og kan sende hele taket med
  // en gang. Samme grep som når bookeren fjerner en komiker.
  for (const spot of cancelled ?? []) {
    await startAutoBooking(spot.show_id, spot.show_requirement_id, { restart: true })
  }

  // Hvem som mistet plassen — kallstedet sier fra til dem.
  return { removedArtistIds: [...new Set((cancelled ?? []).map((spot) => spot.artist_id))] }
}

/** Komikeren takker nei. */
export async function declineBookingOffer(token: string) {
  const admin = createAdminClient()

  const { data: offer, error } = await admin
    .from('booking_offers')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('token', token)
    .eq('status', 'sent')
    .select('show_id, artist_id')
    .maybeSingle()

  if (error) throw new Error(error.message)

  // Et nei skal kvitteres like tydelig som et ja — ellers sitter komikeren
  // igjen uten spor av at svaret kom fram.
  if (offer) {
    const [{ data: artist }, { data: show }] = await Promise.all([
      admin.from('artists').select('email, full_name').eq('id', offer.artist_id).single(),
      admin.from('shows').select('title, date').eq('id', offer.show_id).single(),
    ])

    if (artist) {
      await sendOfferDeclinedEmail({
        email: artist.email,
        full_name: artist.full_name,
        show_title: show?.title ?? '',
        show_date: show?.date ?? '',
        portal_url: `${appUrl()}/artist-app/availability`,
      })
    }
  }

  // Motoren kjøres for å fylle plassen som nettopp ble ledig. Den ser
  // avslaget via booking_offers-statusen og tilbyr ikke showet til den
  // samme artisten igjen — se kommentaren i bookShow().
  //
  // Vi skriver bevisst ingen rad i show_artist_booking_exclusions her:
  // den tabellen filtrerer også bort artisten fra manuell tildeling i
  // admin, og det finnes ingen måte å angre på. Et avslag skal stoppe
  // automatikken, ikke låse artisten ute fra showet for godt.
  if (offer?.show_id) await runAutomaticBookingForShow(offer.show_id)

  return { result: 'declined' as const }
}

/**
 * Sender et bookingtilbud til én valgt komiker på en gitt lineup-plass.
 *
 * Brukes av «+ Send tilbud» i admin-appen: bookeren velger komiker selv i
 * stedet for å la motoren plukke. Komikeren må fortsatt takke ja.
 *
 * Tilbudet merkes `manual`. Da trekker motoren det ikke fordi komikeren
 * ikke matcher plassens krav, og sender ikke setet til andre mens det
 * venter på svar — se lib/booking-rules.ts.
 */
export async function sendManualBookingOffer(
  showId: string,
  artistId: string,
  requirementId: string,
) {
  const admin = createAdminClient()

  const [{ data: show }, { data: requirement }, { data: artist }] = await Promise.all([
    admin.from('shows').select('id, title, date, start_time, venue_name, venue_address, currency, status, club_id').eq('id', showId).single(),
    admin
      .from('show_requirements')
      .select('id, role_name, quantity, compensation_type, compensation_amount, compensation_percent')
      .eq('id', requirementId)
      .eq('show_id', showId)
      .single(),
    admin.from('artists').select('id, email, full_name').eq('id', artistId).single(),
  ])

  if (!show) throw new Error('Showet finnes ikke.')
  if (!requirement) throw new Error('Denne lineup-plassen tilhører ikke showet.')
  if (!artist) throw new Error('Komikeren finnes ikke.')

  await assertArtistBookableForShow(admin, showId, artistId)

  const [{ count: filled }, { data: existingSpot }, { data: existingOffer }] = await Promise.all([
    admin.from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', requirementId)
      .in('status', ['confirmed', 'completed', 'paid']),
    admin.from('confirmed_spots')
      .select('id')
      .eq('show_id', showId)
      .eq('artist_id', artistId)
      .in('status', ['confirmed', 'completed', 'paid'])
      .maybeSingle(),
    admin.from('booking_offers')
      .select('id')
      .eq('show_id', showId)
      .eq('artist_id', artistId)
      .eq('status', 'sent')
      .maybeSingle(),
  ])

  if ((filled ?? 0) >= requirement.quantity) throw new Error('Denne lineup-plassen er allerede fylt.')
  if (existingSpot) throw new Error('Denne komikeren er allerede i lineupen.')
  if (existingOffer) throw new Error('Denne komikeren har allerede et tilbud som venter på svar.')

  const settings = await loadBookingSettings(admin)
  const { data: club } = show.club_id
    ? await admin.from('clubs').select('lineup_deadline_days').eq('id', show.club_id).maybeSingle()
    : { data: null }

  // Bookerens eget tilbud følger de samme fristene som motorens, men stoppes
  // ikke av showdagen: ringer bookeren noen samme dag, skal tilbudet kunne
  // sendes. Da står det ut dagen.
  const expiresAt = offerExpiresAt({
    now: new Date(),
    showDate: show.date,
    lineupDeadline: lineupDeadlineAt(show.date, lineupDeadlineDaysFor(club, settings)),
    settings,
  }) ?? new Date(Date.parse(`${show.date}T23:59:59Z`)).toISOString()

  const details = offerDetails(show, requirement)
  const { data: offer, error } = await admin
    .from('booking_offers')
    .insert({
      show_id: showId,
      artist_id: artistId,
      show_requirement_id: requirementId,
      status: 'sent',
      source: 'manual',
      sent_at: new Date().toISOString(),
      expires_at: expiresAt,
      fee_amount: details.feeAmount,
      currency: details.currency,
    })
    .select('token')
    .single()

  if (error || !offer) throw new Error(error?.message ?? 'Kunne ikke opprette tilbudet.')

  // Dekker de manuelle tilbudene nå alle de ledige setene på plassen, skal
  // motorens egne trekkes. `offerQuota` stopper bare *nye* tilbud; sto det
  // allerede fire ute, kappløp bookerens valg mot dem, og den som svarte
  // først vant. Det er det motsatte av at bookerens valg skal veie tyngst.
  const openSeats = requirement.quantity - (filled ?? 0)
  const { count: manualPending } = await admin
    .from('booking_offers')
    .select('*', { count: 'exact', head: true })
    .eq('show_requirement_id', requirementId)
    .eq('status', 'sent')
    .eq('source', 'manual')

  if ((manualPending ?? 0) >= openSeats) {
    await admin
      .from('booking_offers')
      .update({ status: 'cancelled', responded_at: new Date().toISOString() })
      .eq('show_requirement_id', requirementId)
      .eq('status', 'sent')
      .eq('source', 'auto')
  }

  // Manuelt tilbud betyr at bookeren aktivt jobber med showet — la det gå ut
  // av draft slik at svar fra komikeren behandles av bookingflyten. Men
  // automatikken starter ikke av seg selv: et manuelt tilbud i et utkast
  // skal ikke sette i gang bølgene på resten av lineupen.
  await admin.from('shows').update({ status: 'booking' }).eq('id', showId).eq('status', 'draft')

  const baseUrl = appUrl()
  await sendBookingOfferEmail({
    email: artist.email,
    full_name: artist.full_name,
    show_title: show.title,
    show_date: show.date,
    show_time: details.show_time,
    venue: details.venue,
    role_name: details.role_name,
    fee_label: details.fee_label,
    expires_at: expiresAt,
    token: offer.token,
    response_url: `${baseUrl}/booking-offer/${offer.token}`,
  })

  return { offerId: offer.token, artistName: artist.full_name }
}
