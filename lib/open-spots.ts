import { createAdminClient } from '@/lib/supabase/admin'
import { requirementFeeLabel } from '@/lib/booking-spots'
import type { ArtistStatus, SubmissionStatus, SubmissionsAudience } from '@/types/database'

/**
 * Plassene én komiker kan søke på.
 *
 * Dette er den eneste offentlige inngangen til open calls — klubbsiden selger
 * billetter og har bare en grå linje som peker hit. Derfor ligger hele
 * synlighetsregelen her, ett sted, i stedet for som filtre spredd i sidene.
 *
 * En plass er synlig når *alle* disse holder:
 *   1. showet er i `booking` og ikke har vært
 *   2. plassen er åpnet av klubben (`submissions_open`)
 *   3. fristen har ikke gått (`submissions_close_at`)
 *   4. publikummet slipper komikeren inn (`submissions_audience`)
 *   5. klubben har ikke flagget komikeren
 *   6. plassen er ikke allerede fylt
 *   7. komikeren har ikke plass på showet fra før
 *
 * Punkt 7 er ikke en høflighet: migrasjon 007 har en unik indeks på
 * (show_id, artist_id) blant aktive plasser. En komiker kan ikke ha to
 * plasser på samme show, så det ville vært en søknad som aldri kunne bli
 * noe.
 */

type Db = ReturnType<typeof createAdminClient>

export type OpenSpot = {
  requirementId: string
  roleName: string
  /** Plasser igjen på rollen. Alltid > 0 — fylte roller vises ikke. */
  spotsLeft: number
  quantity: number
  feeLabel: string
  /** Hvor mange som har søkt på rollen, inkludert komikeren selv. */
  applicantCount: number
  /** Komikerens egen søknad på denne plassen, om hen har en. */
  submission: { id: string; status: SubmissionStatus } | null
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
  spots: OpenSpot[]
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
    .select('id, title, date, start_time, venue_name, venue_address, currency, club_id, submissions_audience, submissions_close_at')
    .in('id', showIds)
    .eq('status', 'booking')
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
      .in('status', ['confirmed', 'completed', 'paid']),
    db.from('confirmed_spots')
      .select('show_id')
      .eq('artist_id', artistId)
      .in('show_id', liveShowIds)
      .in('status', ['confirmed', 'completed', 'paid']),
    db.from('show_submissions')
      .select('id, show_requirement_id, status')
      .eq('artist_id', artistId)
      .in('show_requirement_id', requirementIds),
    db.from('show_submission_invitations')
      .select('show_id')
      .eq('artist_id', artistId)
      .in('show_id', liveShowIds),
  ])

  // Søkertellingen er delt av alle som ser plassen, så den hentes for seg.
  const { data: allSubmissions } = await db
    .from('show_submissions')
    .select('show_requirement_id')
    .in('show_requirement_id', requirementIds)
    .in('status', ['pending', 'shortlisted'])

  const clubName = new Map((clubs ?? []).map((club) => [club.id, club.name]))
  const membership = new Map((memberships ?? []).map((row) => [row.club_id, row]))
  const mySubmission = new Map((submissions ?? []).map((row) => [row.show_requirement_id, row]))
  const invitedShows = new Set((invitations ?? []).map((row) => row.show_id))
  const bookedShows = new Set((myActiveSpots ?? []).map((row) => row.show_id))

  const filledByRequirement = countBy(filledSpots ?? [], (row) => row.show_requirement_id)
  const applicantsByRequirement = countBy(allSubmissions ?? [], (row) => row.show_requirement_id)

  const result: OpenSpotShow[] = []

  for (const show of shows) {
    // Punkt 7 — hen står allerede på plakaten.
    if (bookedShows.has(show.id)) continue

    const review = show.club_id ? membership.get(show.club_id) : undefined
    // Punkt 5 — flagget hos denne klubben, uansett publikum.
    if (review?.is_flagged) continue
    // Punkt 4 — 'roster' krever at klubben har knyttet komikeren til seg.
    const audience = (show.submissions_audience ?? 'roster') as SubmissionsAudience
    if (audience === 'roster' && !review) continue

    const spots = requirements
      .filter((req) => req.show_id === show.id)
      .flatMap<OpenSpot>((req) => {
        const spotsLeft = req.quantity - (filledByRequirement.get(req.id) ?? 0)
        const submission = mySubmission.get(req.id)
        // Punkt 6. En plass komikeren allerede har søkt på blir stående selv
        // om den er full — hen skal se hva som skjedde med søknaden sin.
        if (spotsLeft <= 0 && !submission) return []

        return [{
          requirementId: req.id,
          roleName: req.role_name,
          spotsLeft: Math.max(0, spotsLeft),
          quantity: req.quantity,
          feeLabel: requirementFeeLabel(req, show.currency || 'NOK'),
          applicantCount: applicantsByRequirement.get(req.id) ?? 0,
          submission: submission ? { id: submission.id, status: submission.status as SubmissionStatus } : null,
        }]
      })

    if (spots.length === 0) continue

    result.push({
      showId: show.id,
      title: show.title,
      date: show.date,
      startTime: show.start_time,
      venue: show.venue_name ?? show.venue_address,
      clubName: show.club_id ? clubName.get(show.club_id) ?? null : null,
      audience,
      closeAt: show.submissions_close_at,
      invited: invitedShows.has(show.id),
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

function countBy<T>(rows: T[], key: (row: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const id = key(row)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/**
 * Kaster hvis komikeren ikke har lov til å søke på plassen.
 *
 * Gjentar hele regelen fra `getOpenSpotsForArtist`, og det er med vilje:
 * handlingen er et kallbart endepunkt, så en requirement-id kan sendes inn
 * uten å ha vært innom noen liste. Samme lærdom som `assertArtistBookableForShow`
 * i lib/club-artists.ts.
 *
 * Returnerer showet og plassen, så kalleren slipper å hente dem på nytt.
 */
export async function assertArtistCanApply(db: Db, artistId: string, requirementId: string) {
  const { data: requirement } = await db
    .from('show_requirements')
    .select('id, show_id, role_name, quantity, submissions_open')
    .eq('id', requirementId)
    .maybeSingle()

  if (!requirement) throw new Error('This spot does not exist.')
  if (!requirement.submissions_open) throw new Error('This spot is not open for submissions.')

  const [{ data: artist }, { data: show }] = await Promise.all([
    db.from('artists').select('id, status').eq('id', artistId).maybeSingle(),
    db.from('shows')
      .select('id, title, date, status, club_id, submissions_audience, submissions_close_at')
      .eq('id', requirement.show_id)
      // Et arkivert show finnes ikke lenger for komikerne.
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  if (!artist) throw new Error('This comedian does not exist.')
  const gate = artistCanApply(artist)
  if (!gate.ok) throw new Error(gate.reason)

  if (!show) throw new Error('This show does not exist.')
  if (show.status !== 'booking') throw new Error('This show is not taking submissions.')
  if (show.date < new Date().toISOString().slice(0, 10)) throw new Error('This show has already been.')
  if (show.submissions_close_at && new Date(show.submissions_close_at) < new Date()) {
    throw new Error('The deadline for this show has passed.')
  }

  const audience = (show.submissions_audience ?? 'roster') as SubmissionsAudience
  const { data: review } = show.club_id
    ? await db.from('club_artists').select('is_flagged').eq('club_id', show.club_id).eq('artist_id', artistId).maybeSingle()
    : { data: null }

  if (review?.is_flagged) throw new Error('You cannot apply for spots at this club.')
  if (audience === 'roster' && !review) {
    throw new Error('This show is only open to comedians the club already works with.')
  }

  const [{ count: filled }, { data: ownSpot }] = await Promise.all([
    db.from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', requirementId)
      .in('status', ['confirmed', 'completed', 'paid']),
    db.from('confirmed_spots')
      .select('id')
      .eq('show_id', show.id)
      .eq('artist_id', artistId)
      .in('status', ['confirmed', 'completed', 'paid'])
      .maybeSingle(),
  ])

  if (ownSpot) throw new Error('You already have a spot on this show.')
  if ((filled ?? 0) >= requirement.quantity) throw new Error('This spot has been filled.')

  return { requirement, show }
}
