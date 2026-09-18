import { artistMatchesRole } from '@/lib/artist-roles'
import type { BookingSettings } from '@/lib/booking-settings'
import type { ArtistGender, ArtistType, BookingOfferSource, EnergyLevel } from '@/types/database'

/**
 * Reglene bookingmotoren følger, uten databasen.
 *
 * `bookShow` i lib/actions/booking.ts henter radene og skriver tilbudene.
 * Hvem som kan få et tilbud, hvem som står først i køen, hvilke ubesvarte
 * tilbud som trekkes og hvor mange nye en plass kan få, avgjøres her — i en
 * fil som ikke er en server action, og som derfor kan testes for seg.
 *
 * Varslene i «Trenger oppmerksomhet» leser de samme funksjonene, slik at
 * listen ikke kan si noe annet enn det motoren gjør.
 */

/** Det motoren vet om en komiker. Rolle og energi er klubbens vurdering. */
export type MatchableArtist = {
  admin_energy_level: EnergyLevel | null
  gender: ArtistGender | null
  category: ArtistType[] | null
}

/** Kravene på en plass. De lempes aldri av motoren — bare av bookeren. */
export type HardRequirement = {
  role_name: string
  energy_level: string
  required_gender: string
}

/** Kravet som stenger komikeren ute. Null = hen passer plassen. */
export type RequirementBlocker = 'role' | 'energy' | 'gender'

/**
 * Hvilket krav som stopper komikeren, i den rekkefølgen bookeren kan gjøre
 * noe med dem. Brukes av varslene: «ingen kandidater» er til liten hjelp
 * uten å si hva som stenger, og hvor mange som kommer inn om det lempes.
 */
export function requirementBlocker(artist: MatchableArtist, req: HardRequirement): RequirementBlocker | null {
  if (!artistMatchesRole(req.role_name, artist)) return 'role'
  if (req.energy_level !== 'any' && artist.admin_energy_level !== req.energy_level) return 'energy'
  if (req.required_gender && req.required_gender !== 'any' && artist.gender !== req.required_gender) return 'gender'
  return null
}

export function matchesHardRequirements(artist: MatchableArtist, req: HardRequirement): boolean {
  return requirementBlocker(artist, req) === null
}

// ─── Kollisjon: to show samme kveld ───────────────────────────────────────

/** En bekreftet plass komikeren har fra før, slik kollisjonssjekken ser den. */
export type ArtistBooking = {
  show_id: string
  date: string
  /** `HH:MM` eller `HH:MM:SS`. Null = ukjent starttid, og da gjelder hele dagen. */
  start_time: string | null
}

function minutesOfDay(time: string | null): number | null {
  if (!time) return null
  const [hours, minutes] = time.split(':')
  const h = Number(hours)
  const m = Number(minutes ?? 0)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

/**
 * Om komikeren allerede er bundet opp den kvelden.
 *
 * To spots på én kveld er helt vanlig og skal fortsatt gå. Det som ikke går,
 * er å stå på to scener samtidig. Grensen er `conflict_window_hours`: er
 * starttidene nærmere enn det, kolliderer showene.
 *
 * Mangler ett av showene starttid, kan vi ikke regne på det, og da teller
 * hele dagen som opptatt. Det er den trygge retningen: en komiker som ikke
 * dukker opp, koster klubben en kveld.
 */
export function hasScheduleConflict({
  showId,
  date,
  startTime,
  bookings,
  conflictWindowHours,
}: {
  showId: string
  date: string
  startTime: string | null
  bookings: ArtistBooking[]
  conflictWindowHours: number
}): boolean {
  const start = minutesOfDay(startTime)
  const windowMinutes = conflictWindowHours * 60

  return bookings.some((booking) => {
    if (booking.show_id === showId) return false
    if (booking.date !== date) return false

    const other = minutesOfDay(booking.start_time)
    if (start === null || other === null) return true

    return Math.abs(other - start) < windowMinutes
  })
}

// ─── Køen ────────────────────────────────────────────────────────────────

/** Komikeren slik rangeringen ser hen. */
export type RankedCandidate = {
  id: string
  /** `club_artists.score`, 0–10. Snittet av klubbens egne vurderinger. */
  score: number
  /** Bekreftede plasser i *denne* klubben innenfor rotasjonsvinduet. */
  clubBookingsInWindow: number
  /** Siste kveld i klubben, `YYYY-MM-DD`. Null = har aldri spilt der. */
  lastClubBookingDate: string | null
}

/**
 * Poengene som avgjør rekkefølgen.
 *
 *     poeng = score × vekt / 10 − trekk × plasser i samme klubb
 *
 * Med standardverdiene: ti poeng per scorepoeng, minus ett scorepoeng for
 * hver kveld komikeren allerede har hos klubben innen 30 dager. Show i
 * andre klubber teller ikke — ingen skal straffes for å jobbe.
 */
export function candidatePoints(candidate: RankedCandidate, settings: BookingSettings): number {
  const quality = (candidate.score / 10) * settings.quality_weight
  const rotation = candidate.clubBookingsInWindow * settings.rotation_penalty
  return quality - rotation
}

/**
 * Rekkefølgen mellom to kandidater: flest poeng først.
 *
 * Ved lik sum går den som har ventet lengst siden forrige kveld i klubben
 * først, og den som aldri har spilt der, aller først. Til slutt id-en, slik
 * at to helt like kandidater alltid kommer i samme rekkefølge. Før avgjorde
 * databasens tilfeldige rekkefølge, og den samme kjøringen kunne gi to
 * forskjellige lineups.
 */
export function compareCandidates(
  a: RankedCandidate,
  b: RankedCandidate,
  settings: BookingSettings,
): number {
  const points = candidatePoints(b, settings) - candidatePoints(a, settings)
  // Poengene er flyttall, og scoren er nå et snitt — desimaler som ikke går
  // opp er regelen, ikke unntaket. Score 2,9 uten bookinger gir
  // 28.999999999999996, score 3,9 med én gir 29. Uten en terskel vant den
  // travleste med 3,5e-15, og rotasjonen — hele poenget med utregningen —
  // ble aldri tatt hensyn til.
  if (Math.abs(points) > 1e-9) return points

  const aLast = a.lastClubBookingDate ?? ''
  const bLast = b.lastClubBookingDate ?? ''
  if (aLast !== bLast) return aLast < bLast ? -1 : 1

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Kandidatene i køorden. */
export function rankCandidates<T extends RankedCandidate>(candidates: T[], settings: BookingSettings): T[] {
  return [...candidates].sort((a, b) => compareCandidates(a, b, settings))
}

// ─── Hvilke ubesvarte tilbud motoren trekker ─────────────────────────────

export type ExistingOffer = {
  id: string
  artist_id: string
  show_requirement_id: string | null
  status: string
  source: BookingOfferSource
}

/**
 * De ubesvarte tilbudene motoren trekker før den regner ut nye.
 *
 * Alle tilbud trekkes når komikeren er ekskludert fra showet, når hen ikke
 * lenger kan bookes av klubben (ikke på listen, flagget eller ikke godkjent —
 * altså ikke i `bookableArtists`), eller når plassen er borte.
 *
 * Et tilbud motoren sendte, trekkes også når komikeren ikke lenger matcher
 * plassen: bookeren har endret kravene siden. Et tilbud bookeren sendte selv,
 * trekkes ikke av den grunnen. Bookeren valgte komikeren, ofte nettopp på
 * tvers av kategorien, og før denne regelen forsvant tilbudet uten varsel
 * neste gang motoren kjørte.
 */
export function pendingOffersToWithdraw({
  offers,
  bookableArtists,
  requirements,
  excludedArtistIds,
}: {
  offers: ExistingOffer[]
  bookableArtists: ReadonlyMap<string, MatchableArtist>
  requirements: ReadonlyMap<string, HardRequirement>
  excludedArtistIds: ReadonlySet<string>
}): string[] {
  return offers.flatMap((offer) => {
    if (offer.status !== 'sent' || !offer.show_requirement_id) return []
    if (excludedArtistIds.has(offer.artist_id)) return [offer.id]

    const artist = bookableArtists.get(offer.artist_id)
    const requirement = requirements.get(offer.show_requirement_id)
    if (!artist || !requirement) return [offer.id]
    if (offer.source === 'manual') return []

    return matchesHardRequirements(artist, requirement) ? [] : [offer.id]
  })
}

// ─── Hvor mange nye tilbud en plass kan få ───────────────────────────────

/**
 * Hvor mange nye tilbud motoren kan sende på én plass akkurat nå.
 *
 * `target` er bølgen: hvor mange ubesvarte tilbud fra motoren hvert ledige
 * sete skal ha i dag (se `offerTarget` i lib/booking-schedule.ts). Målet
 * gjør at kjøringen kan skje så ofte den vil — etter hvert nei, hver
 * morgen — uten at noen plass får flere tilbud enn bølgen tilsier.
 *
 * Et sete der bookeren har sendt et tilbud selv, holdes utenfor så lenge
 * tilbudet venter på svar. Ellers sendte motoren den samme plassen til
 * andre, og den som svarte først, fikk den — ikke den bookeren valgte. Sier
 * komikeren nei, eller tilbudet går ut, tar motoren setet igjen.
 */
export function offerQuota({
  quantity,
  filled,
  pendingAuto,
  pendingManual,
  target,
}: {
  quantity: number
  filled: number
  pendingAuto: number
  pendingManual: number
  target: number
}) {
  const openSeats = Math.max(0, quantity - filled)
  const slotsNeeded = Math.max(0, openSeats - pendingManual)
  const maxNewOffers = Math.max(0, slotsNeeded * Math.max(0, target) - pendingAuto)

  return { slotsNeeded, currentPendingOffers: pendingAuto, maxNewOffers }
}

// ─── Rekkefølgen mellom plassene ─────────────────────────────────────────

export type ScarcityEntry = {
  requirementId: string
  lineupPosition: number
  /** Kandidater som oppfyller kravene til plassen akkurat nå. */
  candidateCount: number
}

/**
 * Knappest først.
 *
 * Plassene deler den samme listen med komikere, og en komiker har bare ett
 * aktivt tilbud per show. Er det bare to i klubben som kan være Host, skal
 * ikke Headliner-plassen ta dem først. Den faste rollerekkefølgen gjorde
 * nettopp det: Host valgte før Headliner, uansett hvor mange hver av dem
 * hadde å velge blant.
 *
 * Plasser uten kandidater går sist. De har ingenting å hente uansett, og
 * skal ikke stå foran en plass som faktisk kan fylles.
 */
export function orderByScarcity<T extends ScarcityEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const aEmpty = a.candidateCount === 0
    const bEmpty = b.candidateCount === 0
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1

    return a.candidateCount - b.candidateCount
      || a.lineupPosition - b.lineupPosition
      || (a.requirementId < b.requirementId ? -1 : a.requirementId > b.requirementId ? 1 : 0)
  })
}
