import { artistMatchesRole } from '@/lib/artist-roles'
import { meetsSkillLevel, type SkillLevel } from '@/lib/artist-score'
import { offerTarget } from '@/lib/booking-schedule'
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

/** Det motoren vet om en komiker. Rolle, energi og score er klubbens vurdering. */
export type MatchableArtist = {
  admin_energy_level: EnergyLevel | null
  gender: ArtistGender | null
  category: ArtistType[] | null
  /** `club_artists.score`, 0–10. Gir skill level — se `skillLevelFromScore`. */
  score: number
}

/** Kravene på en plass. De lempes aldri av motoren — bare av bookeren. */
export type HardRequirement = {
  role_name: string
  energy_level: string
  required_gender: string
  /** Minste skill level. Null eller `low` = alle. */
  min_skill_level?: SkillLevel | null
}

/** Kravet som stenger komikeren ute. Null = hen passer plassen. */
export type RequirementBlocker = 'role' | 'energy' | 'gender' | 'skill'

/**
 * Hvilket krav som stopper komikeren, i den rekkefølgen bookeren kan gjøre
 * noe med dem. Brukes av varslene: «ingen kandidater» er til liten hjelp
 * uten å si hva som stenger, og hvor mange som kommer inn om det lempes.
 */
export function requirementBlocker(artist: MatchableArtist, req: HardRequirement): RequirementBlocker | null {
  if (!artistMatchesRole(req.role_name, artist)) return 'role'
  if (req.energy_level !== 'any' && artist.admin_energy_level !== req.energy_level) return 'energy'
  if (req.required_gender && req.required_gender !== 'any' && artist.gender !== req.required_gender) return 'gender'
  // Sist: nivået er det bookeren oftest kan gi slipp på, og det eneste kravet
  // som flytter seg av seg selv — én vurdering kan løfte en komiker over.
  if (!meetsSkillLevel(artist.score, req.min_skill_level)) return 'skill'
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

// ─── Bølgen: hvem som får tilbud nå ──────────────────────────────────────

/** Kandidaten slik planen ser hen: krav, kø og kvelden. */
export type PlanCandidate = MatchableArtist & RankedCandidate & {
  /** Komikeren har markert showdatoen som opptatt. */
  unavailable: boolean
  /** Komikeren står allerede på en annen scene den kvelden. */
  conflicted: boolean
}

/**
 * Om komikeren kan få tilbud på nettopp denne plassen.
 *
 * Kravene om kvelden — opptatt, kollisjon — sitter på kandidaten og gjelder
 * hele showet. Kravene om plassen sjekkes av `matchesHardRequirements`.
 */
export function isEligibleForSpot(
  candidate: PlanCandidate,
  req: HardRequirement,
  involved: ReadonlySet<string>,
): boolean {
  if (involved.has(candidate.id)) return false
  if (candidate.unavailable || candidate.conflicted) return false
  return matchesHardRequirements(candidate, req)
}

/** Plassen slik bølgen ser den. */
export type WaveRequirement = HardRequirement & {
  id: string
  quantity: number
  lineup_position: number
  submissions_open: boolean | null
  auto_started_at: string | null
}

export type WaveEntry<R extends WaveRequirement> = ScarcityEntry & {
  req: R
  slotsNeeded: number
  currentPendingOffers: number
  maxNewOffers: number
}

/**
 * Plassene som skal ha nye tilbud nå, og hvor mange.
 *
 * En plass klubben har åpnet for søknader, holder motoren fingrene fra —
 * ellers rekker den å fylle plassen før noen har rukket å søke. Og en plass
 * automatikken ikke er startet på (`auto_started_at`), rører den ikke.
 */
export function waveEntries<R extends WaveRequirement>({
  requirements,
  pool,
  involved,
  filled,
  pendingAuto,
  pendingManual,
  now,
  settings,
  rush,
  queues,
}: {
  requirements: R[]
  pool: PlanCandidate[]
  involved: ReadonlySet<string>
  filled: ReadonlyMap<string, number>
  pendingAuto: ReadonlyMap<string, number>
  pendingManual: ReadonlyMap<string, number>
  now: Date
  settings: BookingSettings
  rush: boolean
  /** Bookerens kø per plass. De som er fjernet derfra, er ikke kandidater. */
  queues?: ReadonlyMap<string, SpotQueue>
}): WaveEntry<R>[] {
  return requirements.flatMap((req) => {
    if (req.submissions_open) return []
    if (!req.auto_started_at) return []

    const target = offerTarget({ autoStartedAt: req.auto_started_at, now, settings, rush })
    const { slotsNeeded, currentPendingOffers, maxNewOffers } = offerQuota({
      quantity: req.quantity,
      filled: filled.get(req.id) ?? 0,
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
      candidateCount: pool.filter((candidate) =>
        isEligibleForSpot(candidate, req, involved) && !queues?.get(req.id)?.removed.has(candidate.id),
      ).length,
    }]
  })
}

// ─── Bookerens kø ────────────────────────────────────────────────────────

/**
 * Rekkefølgen bookeren har satt på en plass i «Review your line-up».
 *
 * `order` er komiker-id-ene slik bookeren la dem, øverst først. `removed` er
 * dem bookeren har tatt ut av køen: de får aldri tilbud på plassen.
 */
export type SpotQueue = {
  order: readonly string[]
  removed: ReadonlySet<string>
}

/**
 * Hvem som spørres først på én plass.
 *
 * Har bookeren satt en kø, følges den — i hver bølge, ikke bare den første.
 * Bookerne ville ha kontroll over hvem som spørres, og en kø som bare gjaldt
 * de to første, ga dem det bare halvveis. Kvalifiserte bookeren ikke har
 * plassert (nye på listen, eller langt nede i køen), kommer etter, i
 * motorens egen rekkefølge. Uten kø er dette bare `rankCandidates`.
 *
 * Kallet får de som er kvalifisert *nå*. Kø eller ikke: den som er blitt
 * opptatt eller ikke lenger passer, er allerede ute av listen.
 */
export function spotOrder<C extends RankedCandidate>(
  eligible: C[],
  queue: SpotQueue | undefined,
  settings: BookingSettings,
): C[] {
  if (!queue) return rankCandidates(eligible, settings)

  const allowed = eligible.filter((candidate) => !queue.removed.has(candidate.id))
  const position = new Map(queue.order.map((id, index) => [id, index]))
  const placed = allowed
    .filter((candidate) => position.has(candidate.id))
    .sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0))
  const rest = rankCandidates(allowed.filter((candidate) => !position.has(candidate.id)), settings)
  return [...placed, ...rest]
}

/** Én plass slik fordelingen ser den: hvor mange, og hvem i hvilken rekkefølge. */
export type AllocationSpot = ScarcityEntry & {
  slotsNeeded: number
  maxNewOffers: number
  /** Komiker-id-er, den som skal spørres først øverst. */
  order: readonly string[]
}

/**
 * Fordeler bølgen mellom plassene.
 *
 * Plassen med færrest kandidater velger først (`orderByScarcity`), og
 * tilbudene deles ut i runder — ett sete om gangen per plass — så én plass
 * ikke tømmer listen før de andre har fått sitt. En komiker får aldri to
 * tilbud på samme show: står hen først i to køer, går hen til plassen som
 * velger først, og den andre går videre i sin kø.
 *
 * Regner bare på id-er, uten score og kriterier. Derfor kan dialogen der
 * bookeren setter køen, kjøre akkurat denne funksjonen i nettleseren og vise
 * hvem som får tilbud — uten at scoren sendes dit.
 */
export function allocateWave(
  spots: readonly AllocationSpot[],
  involved: ReadonlySet<string> = new Set(),
): Array<{ requirementId: string; artistId: string }> {
  if (spots.length === 0) return []

  const ordered = orderByScarcity([...spots])
  const taken = new Set(involved)
  const result: Array<{ requirementId: string; artistId: string }> = []
  const assigned = new Map<string, number>()

  const maxRounds = Math.max(...ordered.map((spot) => Math.ceil(spot.maxNewOffers / Math.max(1, spot.slotsNeeded))))

  for (let round = 0; round < maxRounds; round++) {
    for (const spot of ordered) {
      const remaining = spot.maxNewOffers - (assigned.get(spot.requirementId) ?? 0)
      if (remaining <= 0) continue

      const waveSize = Math.min(spot.slotsNeeded, remaining)
      const chosen = spot.order.filter((id) => !taken.has(id)).slice(0, waveSize)

      for (const artistId of chosen) {
        taken.add(artistId)
        result.push({ requirementId: spot.requirementId, artistId })
        assigned.set(spot.requirementId, (assigned.get(spot.requirementId) ?? 0) + 1)
      }
    }
  }

  return result
}

/**
 * Hvem som får tilbud i denne bølgen, plass for plass.
 *
 * Den samme funksjonen gir dialogen bookeren ser før Start booking og
 * tilbudene motoren faktisk sender. Var de to regnet hver for seg, kunne
 * dialogen vist én lineup og motoren sendt en annen.
 *
 * Kvalifiseringen skjer her, ved hver kjøring; rekkefølgen per plass er
 * `spotOrder` (bookerens kø, ellers poengene), og fordelingen mellom
 * plassene er `allocateWave`.
 */
export function planOfferWave<C extends PlanCandidate, R extends WaveRequirement>({
  entries,
  pool,
  involved,
  settings,
  queues,
}: {
  entries: WaveEntry<R>[]
  pool: C[]
  involved: ReadonlySet<string>
  settings: BookingSettings
  queues?: ReadonlyMap<string, SpotQueue>
}): Array<{ candidate: C; req: R }> {
  if (entries.length === 0) return []

  const byId = new Map(pool.map((candidate) => [candidate.id, candidate]))
  const reqById = new Map(entries.map((entry) => [entry.requirementId, entry.req]))

  const spots = entries.map((entry): AllocationSpot => ({
    requirementId: entry.requirementId,
    lineupPosition: entry.lineupPosition,
    candidateCount: entry.candidateCount,
    slotsNeeded: entry.slotsNeeded,
    maxNewOffers: entry.maxNewOffers,
    order: spotOrder(
      pool.filter((candidate) => isEligibleForSpot(candidate, entry.req, involved)),
      queues?.get(entry.requirementId),
      settings,
    ).map((candidate) => candidate.id),
  }))

  return allocateWave(spots, involved).flatMap(({ requirementId, artistId }) => {
    const candidate = byId.get(artistId)
    const req = reqById.get(requirementId)
    return candidate && req ? [{ candidate, req }] : []
  })
}
