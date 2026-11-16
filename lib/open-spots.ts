import { createAdminClient } from '@/lib/supabase/admin'
import { requirementFeeLabel } from '@/lib/booking-spots'
import type { ArtistStatus, ConfirmedSpotStatus, SubmissionStatus, SubmissionsAudience } from '@/types/database'
import { showVenue } from '@/lib/show-venue'
import { normalizeGigTypes, type GigType } from '@/lib/gig-types'

/**
 * Showene én komiker kan søke på.
 *
 * Komikeren søker på showet, ikke på en enkelt plass, og klubben velger
 * plassen når den godkjenner (prosjektleder, 2026-11-15 — åtte plasser
 * ga åtte knapper, og komikerne trykket på alle). Plassene vises bare så
 * komikeren ser hva kvelden har å by på.
 *
 * Inngangene til open calls er komikerportalen («Open spots») og
 * «Apply for a spot» nederst på den offentlige klubbsiden. Begge leser
 * reglene herfra, så synlighetsregelen står ett sted i stedet for som filtre
 * spredd i sidene.
 *
 * Et show er synlig når *alle* disse holder:
 *   1. showet er i gang med booking eller lagt ut (`APPLY_SHOW_STATUSES`) og
 *      ikke har vært
 *   2. minst én plass er åpnet av klubben (`submissions_open`)
 *   3. fristen har ikke gått (`submissions_close_at`)
 *   4. publikummet slipper komikeren inn (`submissions_audience`)
 *   5. klubben har ikke flagget komikeren
 *   6. komikeren har ikke plass på showet fra før
 *   7. komikeren har ikke markert dagen som opptatt
 *
 * Et show der alle de åpne plassene er fulle, er fortsatt synlig, og
 * søknaden blir en plass på ventelisten. Eieren vil ha det slik
 * (2026-10-20): faller noen fra, skal klubben ha folk å ta av. Ventelisten
 * er ikke lagret noe sted — den er ubesvarte søknader på et show der hver
 * åpne plass er full (`showAvailability`). Et lagret flagg ville drevet fra
 * sannheten: den som søkte mens det var ledig og så ble fullt, står like
 * mye på venteliste, og blir et sete ledig igjen, er alle søknadene
 * godkjennbare uten at noe må skrives om.
 *
 * Punkt 6 er ikke en høflighet: migrasjon 007 har en unik indeks på
 * (show_id, artist_id) blant aktive plasser. En komiker kan ikke ha to
 * plasser på samme show, så det ville vært en søknad som aldri kunne bli
 * noe.
 */

type Db = ReturnType<typeof createAdminClient>

// ─── Reglene ─────────────────────────────────────────────────────────────

/**
 * Showene som tar imot søknader. Samme liste som `ENGINE_STATUSES` i
 * lib/booking-engine.ts, og av samme grunn: et show som er fullbooket eller
 * lagt ut kan miste en komiker, og da skal plassen kunne fylles igjen — her
 * fra ventelisten. Kopiert i stedet for importert, så den offentlige
 * klubbsiden ikke drar motoren og e-postoppsettet med seg.
 */
export const APPLY_SHOW_STATUSES = ['booking', 'fullbooked', 'published'] as const

/** Statusene til en søknad bookeren fortsatt kan ta stilling til. */
export const OPEN_SUBMISSION_STATUSES: SubmissionStatus[] = ['pending', 'shortlisted']

const ACTIVE_SPOT_STATUSES: ConfirmedSpotStatus[] = ['confirmed', 'completed', 'paid']

type ApplyShowFields = {
  status: string
  date: string
  submissions_close_at: string | null
}

/** Punkt 1 og 3. Null = showet tar imot søknader. */
export function showClosedReason(show: ApplyShowFields, now: Date = new Date()): string | null {
  if (!(APPLY_SHOW_STATUSES as readonly string[]).includes(show.status)) {
    return 'This show is not taking submissions.'
  }
  if (show.date < now.toISOString().slice(0, 10)) return 'This show has already been.'
  if (show.submissions_close_at && new Date(show.submissions_close_at) < now) {
    return 'The deadline for this show has passed.'
  }
  return null
}

/**
 * Punkt 4 og 5. `review` er komikerens rad i `club_artists` hos klubben —
 * eller ingenting, når klubben ikke har knyttet hen til seg.
 */
export function audienceBlockReason({
  audience,
  review,
}: {
  audience: SubmissionsAudience | null
  review: { is_flagged: boolean } | null | undefined
}): string | null {
  if (review?.is_flagged) return 'You cannot apply for spots at this club.'
  if ((audience ?? 'roster') === 'roster' && !review) {
    return 'This show is only open to comedians the club already works with.'
  }
  return null
}

/** Hvor mange seter som står ledige, og om en søknad nå havner på ventelisten. */
export function spotAvailability({ quantity, filled }: { quantity: number; filled: number }) {
  return {
    spotsLeft: Math.max(0, quantity - filled),
    waitlist: filled >= quantity,
  }
}

/**
 * Om en åpen søknad står på ventelisten: plassen er full, showet går
 * fortsatt, og komikeren er ikke alt i lineupen.
 *
 * Søknadsfanen, tallet på «Submissions» og «Trenger oppmerksomhet» bruker
 * alle denne. Talte tallet ventelisten med, sto det 2 på fanen mens bare 1
 * ventet på svar.
 */
export function isWaitlisted({
  status,
  isFull,
  showClosed,
  alreadyBooked,
}: {
  status: SubmissionStatus
  isFull: boolean
  showClosed: boolean
  alreadyBooked: boolean
}) {
  return OPEN_SUBMISSION_STATUSES.includes(status) && isFull && !showClosed && !alreadyBooked
}

function countBy<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const id = key(row)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

// ─── Komikerportalen ─────────────────────────────────────────────────────

/**
 * Én åpen plass på et show. Komikeren søker ikke på plassen — hen søker på
 * showet, og klubben velger plassen (prosjektleder, 2026-11-15). Plassene
 * står der så komikeren ser hva kvelden har å by på.
 */
export type OpenSpot = {
  requirementId: string
  roleName: string
  /** Seter igjen på rollen. 0 = full. */
  spotsLeft: number
  quantity: number
  /** Plassen er full. Se `spotAvailability`. */
  waitlist: boolean
  feeLabel: string
}

/**
 * Showet sett under ett: hvor mange seter som står ledige på de åpne
 * plassene, og om en søknad nå havner på ventelisten — det gjør den først
 * når hver eneste åpne plass er full.
 */
export function showAvailability(spots: Array<{ spotsLeft: number; waitlist: boolean }>) {
  return {
    spotsLeft: spots.reduce((sum, spot) => sum + spot.spotsLeft, 0),
    waitlist: spots.length > 0 && spots.every((spot) => spot.waitlist),
  }
}

/**
 * Plassene slått sammen per rolle, i lineup-rekkefølge: «Stand-up ×4», ikke
 * fire rader. Komikeren skal se hva kvelden har, ikke velge blant plassene.
 *
 * Honorarene kan være ulike innen samme rolle. Da står de alle, i
 * lineup-rekkefølge — men «Not set» bare når ingen av plassene har et
 * honorar, for den sier ingenting ved siden av et tall.
 */
export function lineupSummary<T extends { roleName: string; quantity: number; spotsLeft: number; feeLabel: string | null }>(spots: T[]) {
  const groups = new Map<string, { roleName: string; fees: string[]; quantity: number; spotsLeft: number }>()
  for (const spot of spots) {
    const key = spot.roleName.trim().toLowerCase()
    const group = groups.get(key) ?? { roleName: spot.roleName.trim(), fees: [], quantity: 0, spotsLeft: 0 }
    group.quantity += spot.quantity
    group.spotsLeft += spot.spotsLeft
    if (spot.feeLabel && !group.fees.includes(spot.feeLabel)) group.fees.push(spot.feeLabel)
    groups.set(key, group)
  }
  return [...groups.values()].map(({ fees, ...group }) => {
    const known = fees.filter((fee) => fee !== 'Not set')
    const shown = known.length > 0 ? known : fees
    return { ...group, feeLabel: shown.length > 0 ? shown.join(' / ') : null }
  })
}

export type OpenSpotShow = {
  showId: string
  title: string
  date: string
  startTime: string | null
  venue: string | null
  clubName: string | null
  audience: SubmissionsAudience
  closeAt: string | null
  /** Klubben har invitert komikeren til å søke på dette showet. */
  invited: boolean
  /** Type gig klubben har merket kvelden med. Tom = ikke satt. */
  gigTypes: GigType[]
  /**
   * Plassene, for tellingen. Rolle og honorar vises ikke for komikeren før
   * bookingtilbudet (ClickUp «Apply for spot, begrense info», 2026-11-16).
   */
  spots: OpenSpot[]
  /** Ledige seter på de åpne plassene til sammen. */
  spotsLeft: number
  /** Alle de åpne plassene er fulle. En søknad nå blir venteliste. */
  waitlist: boolean
  /** Hvor mange som har en åpen søknad på showet, inkludert komikeren selv. */
  applicantCount: number
  /** Komikerens egen søknad på showet, om hen har en. */
  submission: { id: string; status: SubmissionStatus } | null
}

/** Komikeren må være godkjent på plattformen for å kunne søke. */
export type ArtistGate = { ok: true } | { ok: false; reason: string }

export function artistCanApply(artist: { status: ArtistStatus | string }): ArtistGate {
  if (artist.status === 'approved') return { ok: true }
  // Statusen heter `pending_review`, ikke `pending` — se `ArtistStatus`.
  if (artist.status === 'pending_review') {
    return { ok: false, reason: 'Your profile is still being reviewed. You can apply as soon as it is approved.' }
  }
  return { ok: false, reason: 'Your profile cannot apply for spots right now.' }
}

export async function getOpenSpotsForArtist(artistId: string): Promise<OpenSpotShow[]> {
  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()

  // Åpne plasser først. Er det ingen, er vi ferdige — resten av spørringene
  // hadde ikke hatt noe å slå opp mot.
  const { data: requirements, error: reqError } = await db
    .from('show_requirements')
    .select('id, show_id, role_name, quantity, compensation_type, compensation_amount, compensation_percent, lineup_position')
    .eq('submissions_open', true)
    .order('lineup_position')

  if (reqError) throw new Error(reqError.message)
  if (!requirements?.length) return []

  const showIds = [...new Set(requirements.map((req) => req.show_id))]

  const { data: shows, error: showError } = await db
    .from('shows')
    .select('id, title, date, start_time, venue_name, venue_address, currency, club_id, submissions_audience, submissions_close_at, gig_types')
    .in('id', showIds)
    .in('status', [...APPLY_SHOW_STATUSES])
    .is('deleted_at', null)
    .gte('date', today)
    .or(`submissions_close_at.is.null,submissions_close_at.gt.${now}`)

  if (showError) throw new Error(showError.message)
  if (!shows?.length) return []

  const liveShowIds = shows.map((show) => show.id)
  const clubIds = [...new Set(shows.flatMap((show) => show.club_id ?? []))]
  const requirementIds = requirements
    .filter((req) => liveShowIds.includes(req.show_id))
    .map((req) => req.id)

  const [
    { data: clubs },
    { data: memberships },
    { data: filledSpots },
    { data: myActiveSpots },
    { data: submissions },
    { data: invitations },
    { data: unavailableDates },
  ] = await Promise.all([
    clubIds.length
      ? db.from('clubs').select('id, name').in('id', clubIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    // Klubbens vurdering av komikeren: avgjør både 'roster'-tilgang og flagg.
    clubIds.length
      ? db.from('club_artists').select('club_id, is_flagged').eq('artist_id', artistId).in('club_id', clubIds)
      : Promise.resolve({ data: [] as Array<{ club_id: string; is_flagged: boolean }> }),
    db.from('confirmed_spots')
      .select('show_requirement_id')
      .in('show_requirement_id', requirementIds)
      .in('status', ACTIVE_SPOT_STATUSES),
    db.from('confirmed_spots')
      .select('show_id')
      .eq('artist_id', artistId)
      .in('show_id', liveShowIds)
      .in('status', ACTIVE_SPOT_STATUSES),
    db.from('show_submissions')
      .select('id, show_id, status')
      .eq('artist_id', artistId)
      .in('show_id', liveShowIds)
      // En trukket søknad er ingen søknad — knappen skal stå der igjen.
      .neq('status', 'withdrawn'),
    db.from('show_submission_invitations')
      .select('show_id')
      .eq('artist_id', artistId)
      .in('show_id', liveShowIds),
    // Punkt 7 — dagene komikeren selv har sagt at hen ikke kan.
    db.from('artist_unavailable_dates')
      .select('unavailable_date')
      .eq('artist_id', artistId)
      .in('unavailable_date', [...new Set(shows.map((show) => show.date))]),
  ])

  // Søkertellingen er delt av alle som ser showet, så den hentes for seg.
  const { data: allSubmissions } = await db
    .from('show_submissions')
    .select('show_id')
    .in('show_id', liveShowIds)
    .in('status', OPEN_SUBMISSION_STATUSES)

  const clubName = new Map((clubs ?? []).map((club) => [club.id, club.name]))
  const membership = new Map((memberships ?? []).map((row) => [row.club_id, row]))
  const mySubmission = new Map((submissions ?? []).map((row) => [row.show_id, row]))
  const invitedShows = new Set((invitations ?? []).map((row) => row.show_id))
  const bookedShows = new Set((myActiveSpots ?? []).map((row) => row.show_id))
  const unavailable = new Set((unavailableDates ?? []).map((row) => row.unavailable_date))

  const filledByRequirement = countBy(filledSpots ?? [], (row) => row.show_requirement_id ?? '')
  const applicantsByShow = countBy(allSubmissions ?? [], (row) => row.show_id)

  const result: OpenSpotShow[] = []

  for (const show of shows) {
    // Punkt 6 — hen står allerede på plakaten.
    if (bookedShows.has(show.id)) continue
    // Punkt 7 — hen har sagt at dagen ikke går. Da skal plassen ikke stå der
    // og se søkbar ut; søknaden ville blitt avvist av samme grunn.
    if (unavailable.has(show.date)) continue

    // Punkt 4 og 5.
    const audience = (show.submissions_audience ?? 'roster') as SubmissionsAudience
    const review = show.club_id ? membership.get(show.club_id) : undefined
    if (audienceBlockReason({ audience, review })) continue

    const spots = requirements
      .filter((req) => req.show_id === show.id)
      .map<OpenSpot>((req) => ({
        requirementId: req.id,
        roleName: req.role_name,
        quantity: req.quantity,
        ...spotAvailability({ quantity: req.quantity, filled: filledByRequirement.get(req.id) ?? 0 }),
        feeLabel: requirementFeeLabel(req, show.currency || 'NOK'),
      }))

    if (spots.length === 0) continue

    const submission = mySubmission.get(show.id)

    result.push({
      ...showAvailability(spots),
      applicantCount: applicantsByShow.get(show.id) ?? 0,
      submission: submission ? { id: submission.id, status: submission.status as SubmissionStatus } : null,
      showId: show.id,
      title: show.title,
      date: show.date,
      startTime: show.start_time,
      venue: showVenue(show).venue,
      clubName: show.club_id ? clubName.get(show.club_id) ?? null : null,
      audience,
      closeAt: show.submissions_close_at,
      invited: invitedShows.has(show.id),
      gigTypes: normalizeGigTypes(show.gig_types),
      spots,
    })
  }

  // Invitasjonene først — de er stilet til komikeren personlig. Deretter
  // kronologisk, for det er datoen som avgjør om man kan stille.
  return result.sort((left, right) => {
    if (left.invited !== right.invited) return left.invited ? -1 : 1
    return left.date.localeCompare(right.date)
  })
}

// ─── Den offentlige klubbsiden ───────────────────────────────────────────

/** Den som ser på klubbsiden. Null = ikke innlogget som komiker. */
export type OpenCallViewer = {
  artistId: string
  status: ArtistStatus | string
} | null

export type OpenCallSpot = {
  requirementId: string
  roleName: string
  quantity: number
  spotsLeft: number
  waitlist: boolean
  /** Null når klubben ikke har satt noe honorar — da står det ingenting. */
  feeLabel: string | null
}

export type OpenCall = {
  showId: string
  title: string
  description: string | null
  date: string
  startTime: string | null
  endTime: string | null
  venue: string | null
  address: string | null
  closeAt: string | null
  audience: SubmissionsAudience
  /** Type gig klubben har merket kvelden med. Tom = ikke satt. */
  gigTypes: GigType[]
  /** Plassene, for tellingen. Rolle og honorar vises ikke før bookingtilbudet. */
  spots: OpenCallSpot[]
  /** Hver eneste åpne plass er full — hele showet er venteliste. */
  waitlistOnly: boolean
}

/**
 * Showene på klubbsiden under «Apply for a spot».
 *
 * Utlogget ser bare show åpne for alle (`everyone`). En innlogget komiker
 * ser i tillegg klubbens roster-show når klubben har knyttet hen til seg —
 * og ingenting når hen er flagget. Lista viser altså bare det seeren faktisk
 * kan søke på, så et roster-show aldri står og frister noen som blir avvist.
 *
 * Punkt 6 og 7 (allerede booket, opptatt dag) gjelder ikke her: showet er
 * fortsatt åpent, og showvisningen sier hvorfor akkurat denne komikeren ikke
 * kan søke.
 */
export async function getClubOpenCalls(
  clubId: string,
  viewer: OpenCallViewer,
  { showId, db = createAdminClient(), now = new Date() }: { showId?: string; db?: Db; now?: Date } = {},
): Promise<OpenCall[]> {
  let showQuery = db
    .from('shows')
    .select('id, title, description, date, start_time, end_time, venue_name, venue_address, currency, status, submissions_audience, submissions_close_at, gig_types')
    .eq('club_id', clubId)
    .in('status', [...APPLY_SHOW_STATUSES])
    .is('deleted_at', null)
    .gte('date', now.toISOString().slice(0, 10))
    .order('date')
    .order('start_time')

  if (showId) showQuery = showQuery.eq('id', showId)

  const { data: shows, error: showError } = await showQuery
  if (showError) throw new Error(showError.message)

  const liveShows = (shows ?? []).filter((show) => !showClosedReason(show, now))
  if (liveShows.length === 0) return []

  const [{ data: requirements, error: reqError }, { data: review }] = await Promise.all([
    db.from('show_requirements')
      .select('id, show_id, role_name, quantity, compensation_type, compensation_amount, compensation_percent, lineup_position')
      .in('show_id', liveShows.map((show) => show.id))
      .eq('submissions_open', true)
      .order('lineup_position'),
    viewer
      ? db.from('club_artists').select('is_flagged').eq('club_id', clubId).eq('artist_id', viewer.artistId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  if (reqError) throw new Error(reqError.message)
  if (!requirements?.length) return []

  const { data: filledSpots } = await db
    .from('confirmed_spots')
    .select('show_requirement_id')
    .in('show_requirement_id', requirements.map((req) => req.id))
    .in('status', ACTIVE_SPOT_STATUSES)

  const filledByRequirement = countBy(filledSpots ?? [], (row) => row.show_requirement_id)

  return liveShows.flatMap<OpenCall>((show) => {
    const audience = (show.submissions_audience ?? 'roster') as SubmissionsAudience
    const visible = viewer
      ? !audienceBlockReason({ audience, review })
      : audience === 'everyone'
    if (!visible) return []

    const spots = requirements
      .filter((req) => req.show_id === show.id)
      .map<OpenCallSpot>((req) => {
        const fee = requirementFeeLabel(req, show.currency || 'NOK')
        return {
          requirementId: req.id,
          roleName: req.role_name,
          quantity: req.quantity,
          ...spotAvailability({ quantity: req.quantity, filled: filledByRequirement.get(req.id) ?? 0 }),
          feeLabel: fee === 'Not set' ? null : fee,
        }
      })

    if (spots.length === 0) return []

    const { venue, address } = showVenue(show)
    return [{
      showId: show.id,
      title: show.title,
      description: show.description,
      date: show.date,
      startTime: show.start_time,
      endTime: show.end_time,
      venue,
      address,
      closeAt: show.submissions_close_at,
      audience,
      gigTypes: normalizeGigTypes(show.gig_types),
      spots,
      waitlistOnly: spots.every((spot) => spot.waitlist),
    }]
  })
}

/** Hva en innlogget komiker kan gjøre på showet. */
export type OpenCallState =
  | { kind: 'apply' }
  | { kind: 'applied'; submissionId: string; status: SubmissionStatus }
  | { kind: 'blocked'; reason: string }

/**
 * Komikerens forhold til showet: egen søknad, eller hvorfor hen ikke kan
 * søke. Punkt 1–5 er allerede sjekket av `getClubOpenCalls` — her står det
 * som gjelder komikeren selv.
 *
 * En søknad vinner over en sperre: har hen søkt, skal hen se søknaden sin,
 * også om dagen senere ble markert som opptatt. En trukket søknad er ingen
 * søknad — hen kan søke igjen.
 */
export async function getOpenCallStateForArtist(
  call: OpenCall,
  viewer: NonNullable<OpenCallViewer>,
  db: Db = createAdminClient(),
): Promise<OpenCallState> {
  const [{ data: submission }, { data: ownSpot }, { data: unavailable }] = await Promise.all([
    db.from('show_submissions')
      .select('id, status')
      .eq('artist_id', viewer.artistId)
      .eq('show_id', call.showId)
      .neq('status', 'withdrawn')
      .maybeSingle(),
    db.from('confirmed_spots')
      .select('id')
      .eq('show_id', call.showId)
      .eq('artist_id', viewer.artistId)
      .in('status', ACTIVE_SPOT_STATUSES)
      .maybeSingle(),
    db.from('artist_unavailable_dates')
      .select('id')
      .eq('artist_id', viewer.artistId)
      .eq('unavailable_date', call.date)
      .maybeSingle(),
  ])

  const gate = artistCanApply({ status: viewer.status })
  const blocker = !gate.ok
    ? gate.reason
    : ownSpot
      ? 'You already have a spot on this show.'
      : unavailable
        ? 'You have marked this date as unavailable. Clear it in your calendar to apply.'
        : null

  if (submission) {
    return { kind: 'applied', submissionId: submission.id, status: submission.status as SubmissionStatus }
  }
  return blocker ? { kind: 'blocked', reason: blocker } : { kind: 'apply' }
}

// ─── Søknaden ────────────────────────────────────────────────────────────

/**
 * Kaster hvis komikeren ikke har lov til å søke på showet.
 *
 * Gjentar hele regelen fra `getOpenSpotsForArtist`, og det er med vilje:
 * handlingen er et kallbart endepunkt, så en show-id kan sendes inn uten å
 * ha vært innom noen liste. Samme lærdom som `assertArtistBookableForShow`
 * i lib/club-artists.ts.
 *
 * Et show uten åpne plasser tar ikke imot søknader. Et show der alle de
 * åpne plassene er fulle, avvises ikke — søknaden blir venteliste, og
 * `waitlist` sier det til kalleren. Returnerer også showet, så kalleren
 * slipper å hente det på nytt.
 */
export async function assertArtistCanApply(db: Db, artistId: string, showId: string) {
  const [{ data: artist }, { data: show }, { data: requirements }] = await Promise.all([
    db.from('artists').select('id, status').eq('id', artistId).maybeSingle(),
    db.from('shows')
      .select('id, title, date, status, club_id, submissions_audience, submissions_close_at')
      .eq('id', showId)
      // Et arkivert show finnes ikke lenger for komikerne.
      .is('deleted_at', null)
      .maybeSingle(),
    db.from('show_requirements')
      .select('id, quantity')
      .eq('show_id', showId)
      .eq('submissions_open', true),
  ])

  if (!artist) throw new Error('This comedian does not exist.')
  const gate = artistCanApply(artist)
  if (!gate.ok) throw new Error(gate.reason)

  if (!show) throw new Error('This show does not exist.')
  const closed = showClosedReason(show)
  if (closed) throw new Error(closed)
  if (!requirements?.length) throw new Error('This show is not open for submissions.')

  const { data: review } = show.club_id
    ? await db.from('club_artists').select('is_flagged').eq('club_id', show.club_id).eq('artist_id', artistId).maybeSingle()
    : { data: null }

  const blocked = audienceBlockReason({ audience: show.submissions_audience as SubmissionsAudience, review })
  if (blocked) throw new Error(blocked)

  // Komikeren har selv markert dagen. Plassen vises ikke i listen av samme
  // grunn, men handlingen er et kallbart endepunkt og må si det selv.
  const { data: unavailable } = await db
    .from('artist_unavailable_dates')
    .select('id')
    .eq('artist_id', artistId)
    .eq('unavailable_date', show.date)
    .maybeSingle()

  if (unavailable) {
    throw new Error('You have marked that date as unavailable. Clear it in your calendar first.')
  }

  const [{ data: filledSpots }, { data: ownSpot }] = await Promise.all([
    db.from('confirmed_spots')
      .select('show_requirement_id')
      .in('show_requirement_id', requirements.map((req) => req.id))
      .in('status', ACTIVE_SPOT_STATUSES),
    db.from('confirmed_spots')
      .select('id')
      .eq('show_id', show.id)
      .eq('artist_id', artistId)
      .in('status', ACTIVE_SPOT_STATUSES)
      .maybeSingle(),
  ])

  if (ownSpot) throw new Error('You already have a spot on this show.')

  const filledByRequirement = countBy(filledSpots ?? [], (row) => row.show_requirement_id ?? '')
  const { waitlist } = showAvailability(requirements.map((req) =>
    spotAvailability({ quantity: req.quantity, filled: filledByRequirement.get(req.id) ?? 0 })))
  return { show, waitlist }
}

/**
 * Søknadens status slik komikeren leser den — i portalen og på klubbens
 * søkevisning. En ubesvart søknad på en full plass er venteliste, og skal
 * si det: «Waiting for the club» høres ut som at klubben bare er treg.
 */
export function submissionStatusLabel(status: SubmissionStatus, waitlist: boolean): string {
  if (waitlist && OPEN_SUBMISSION_STATUSES.includes(status)) return 'You’re on the waitlist'

  switch (status) {
    case 'pending': return 'Waiting for the club'
    case 'shortlisted': return 'Shortlisted'
    case 'accepted': return 'Offer sent — check your bookings'
    case 'declined': return 'Not this time'
    case 'withdrawn': return 'You withdrew'
    case 'filled_by_other': return 'Filled by someone else'
    default: return status
  }
}
