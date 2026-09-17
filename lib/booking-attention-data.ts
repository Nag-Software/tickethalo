import { createAdminClient } from '@/lib/supabase/admin'
import { clubArtistReviewsByClub, withClubReview, type ClubArtistReview } from '@/lib/club-artist-profile'
import {
  hasScheduleConflict,
  matchesHardRequirements,
  type ArtistBooking,
  type RequirementBlocker,
} from '@/lib/booking-rules'
import { osloDateString } from '@/lib/booking-schedule'
import { lineupDeadlineDaysFor } from '@/lib/booking-settings'
import { loadBookingSettings } from '@/lib/booking-settings-store'
import { isClubPayoutReady } from '@/lib/stripe-connect'
import {
  bookingAttention,
  type AttentionAlert,
  type AttentionRequirement,
  type AttentionShow,
} from '@/lib/booking-attention'
import type { ArtistGender, ShowStatus } from '@/types/database'

type Db = ReturnType<typeof createAdminClient>

/**
 * Radene bak «Trenger oppmerksomhet».
 *
 * Tellingen av kandidater bruker de samme funksjonene som motoren
 * (`matchesHardRequirements`, `hasScheduleConflict`), ikke en egen kopi av
 * reglene. Sier listen at det er tre kandidater igjen, er det tre motoren
 * kan sende til — ellers ville bookeren jaktet på et problem som ikke finnes,
 * eller latt være å gripe inn i et som gjør.
 *
 * Alt hentes i faste, samlede spørringer for hele listen. Klubbene har opptil
 * et par titalls kommende show, og siden skal ikke gjøre ett oppslag per show.
 */

/** Hvor langt tilbake spilte show blir stående med «ikke vurdert». */
const REVIEW_LOOKBACK_DAYS = 30

/** Taket på hvor mange show listen regner på. Nok til et par måneder fram. */
const SHOW_LIMIT = 60

export async function loadBookingAttention(
  db: Db,
  clubIds: string[],
): Promise<AttentionAlert[]> {
  if (clubIds.length === 0) return []

  const now = new Date()
  const today = osloDateString(now)
  const lookback = new Date(now.getTime() - REVIEW_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  const { data: showRows, error: showError } = await db
    .from('shows')
    .select('id, title, date, start_time, status, club_id')
    .in('club_id', clubIds)
    .is('deleted_at', null)
    .gte('date', lookback)
    .neq('status', 'cancelled')
    .order('date', { ascending: true })
    .limit(SHOW_LIMIT)

  // Varsellisten er det eneste som sier fra når automatikken står fast. Blir
  // den borte fordi en spørring feilet, ser siden helt normal ut — derfor
  // skal feilen i det minste stå i loggen.
  if (showError) {
    console.error(`[Attention] Could not load shows: ${showError.message}`)
    return []
  }

  const shows = showRows ?? []
  if (shows.length === 0) return []

  const showIds = shows.map((show) => show.id)
  const showDates = [...new Set(shows.map((show) => show.date))]

  const [
    settings,
    { data: clubs, error: clubError },
    { data: requirements, error: requirementError },
    { data: spots, error: spotError },
    { data: offers, error: offerError },
    { data: submissions },
    { data: reviews },
    { data: exclusions },
  ] = await Promise.all([
    loadBookingSettings(db),
    db.from('clubs')
      .select('id, lineup_deadline_days, stripe_account_id, charges_enabled, payouts_enabled, payout_schedule_interval, legal_name, org_number, support_email')
      .in('id', clubIds),
    db.from('show_requirements')
      .select('id, show_id, role_name, quantity, lineup_position, energy_level, required_gender, submissions_open, auto_started_at')
      .in('show_id', showIds),
    db.from('confirmed_spots')
      .select('id, show_id, artist_id, show_requirement_id, status')
      .in('show_id', showIds),
    db.from('booking_offers')
      .select('id, show_id, artist_id, show_requirement_id, status, source, sent_at')
      .in('show_id', showIds),
    db.from('show_submissions').select('show_id').in('show_id', showIds).eq('status', 'pending'),
    db.from('artist_performance_reviews').select('confirmed_spot_id').in('show_id', showIds),
    db.from('show_artist_booking_exclusions').select('show_id, artist_id').in('show_id', showIds),
  ])

  // Halve data er verre enn ingen: en tapt spørring etter bekreftede plasser
  // ville fått listen til å melde at hver eneste plass på hvert eneste show
  // står tom. Motoren står over runden i samme situasjon — se `bookShow`.
  const loadError = clubError ?? requirementError ?? spotError ?? offerError
  if (loadError) {
    console.error(`[Attention] Could not load show data: ${loadError.message}`)
    return []
  }

  // ── Klubbenes lister, vurdert av klubbene selv ───────────────────────────
  const rosterByClub: Map<string, Map<string, ClubArtistReview>> = await clubArtistReviewsByClub(db, clubIds)

  const allRosterIds = [...new Set([...rosterByClub.values()].flatMap((reviews) => [...reviews.keys()]))]
  const { data: artistRows } = allRosterIds.length > 0
    ? await db.from('artists').select('id, admin_score, gender').eq('status', 'approved').in('id', allRosterIds)
    : { data: [] as Array<{ id: string; admin_score: number | null; gender: ArtistGender | null }> }

  // ── Kveldene: hvem er opptatt, og hvem står på en annen scene ────────────
  const [{ data: unavailableRows }, { data: sameDateShows }] = await Promise.all([
    showDates.length > 0 && allRosterIds.length > 0
      ? db.from('artist_unavailable_dates')
        .select('artist_id, unavailable_date')
        .in('unavailable_date', showDates)
        .in('artist_id', allRosterIds)
      : Promise.resolve({ data: [] as Array<{ artist_id: string; unavailable_date: string }> }),
    showDates.length > 0
      ? db.from('shows').select('id, date, start_time').in('date', showDates).is('deleted_at', null)
      : Promise.resolve({ data: [] as Array<{ id: string; date: string; start_time: string | null }> }),
  ])

  const sameDateShowById = new Map((sameDateShows ?? []).map((row) => [row.id, row]))
  const { data: otherSpots } = sameDateShowById.size > 0 && allRosterIds.length > 0
    ? await db.from('confirmed_spots')
      .select('artist_id, show_id')
      .in('show_id', [...sameDateShowById.keys()])
      .in('artist_id', allRosterIds)
      .in('status', ['confirmed', 'completed', 'paid'])
    : { data: [] as Array<{ artist_id: string; show_id: string }> }

  const bookingsByArtist = new Map<string, ArtistBooking[]>()
  for (const spot of otherSpots ?? []) {
    const show = sameDateShowById.get(spot.show_id)
    if (!show) continue
    const list = bookingsByArtist.get(spot.artist_id) ?? []
    list.push({ show_id: show.id, date: show.date, start_time: show.start_time })
    bookingsByArtist.set(spot.artist_id, list)
  }

  const unavailableByDate = new Map<string, Set<string>>()
  for (const row of unavailableRows ?? []) {
    const set = unavailableByDate.get(row.unavailable_date) ?? new Set<string>()
    set.add(row.artist_id)
    unavailableByDate.set(row.unavailable_date, set)
  }

  // ── Oppslag ──────────────────────────────────────────────────────────────
  const clubById = new Map((clubs ?? []).map((club) => [club.id, club]))
  const artistById = new Map((artistRows ?? []).map((artist) => [artist.id, artist]))
  const reviewedSpotIds = new Set((reviews ?? []).map((row) => row.confirmed_spot_id))

  const submissionsByShow = new Map<string, number>()
  for (const row of submissions ?? []) {
    submissionsByShow.set(row.show_id, (submissionsByShow.get(row.show_id) ?? 0) + 1)
  }

  const exclusionsByShow = new Map<string, Set<string>>()
  for (const row of exclusions ?? []) {
    const set = exclusionsByShow.get(row.show_id) ?? new Set<string>()
    set.add(row.artist_id)
    exclusionsByShow.set(row.show_id, set)
  }

  const attentionShows: AttentionShow[] = shows.map((show) => {
    const club = show.club_id ? clubById.get(show.club_id) : null
    const showRequirements = (requirements ?? []).filter((req) => req.show_id === show.id)
    const showSpots = (spots ?? []).filter((spot) => spot.show_id === show.id)
    const showOffers = (offers ?? []).filter((offer) => offer.show_id === show.id)
    const activeSpots = showSpots.filter((spot) => ['confirmed', 'completed', 'paid'].includes(spot.status))

    const reviewsRoster = show.club_id ? rosterByClub.get(show.club_id) : undefined
    const pool = reviewsRoster
      ? withClubReview(
        [...reviewsRoster.keys()].flatMap((id) => {
          const artist = artistById.get(id)
          return artist ? [artist] : []
        }),
        reviewsRoster,
      )
      : []

    const unavailable = unavailableByDate.get(show.date) ?? new Set<string>()
    const excluded = exclusionsByShow.get(show.id) ?? new Set<string>()

    // Kveldens krav, som gjelder hele showet og ikke den enkelte plassen.
    const availableThatEvening = pool.filter((artist) => {
      if (unavailable.has(artist.id)) return false
      return !hasScheduleConflict({
        showId: show.id,
        date: show.date,
        startTime: show.start_time,
        bookings: bookingsByArtist.get(artist.id) ?? [],
        conflictWindowHours: settings.conflict_window_hours,
      })
    })

    const involved = new Set([
      ...showOffers.filter((offer) => ['sent', 'accepted', 'declined', 'expired'].includes(offer.status))
        .map((offer) => offer.artist_id),
      ...activeSpots.map((spot) => spot.artist_id),
      ...excluded,
    ])

    const attentionRequirements: AttentionRequirement[] = showRequirements.map((req) => {
      const filled = activeSpots.filter((spot) => spot.show_requirement_id === req.id).length
      const pending = showOffers.filter((offer) => offer.show_requirement_id === req.id && offer.status === 'sent')
      const manual = pending.filter((offer) => offer.source === 'manual')

      const criteria = {
        role_name: req.role_name,
        energy_level: req.energy_level,
        required_gender: req.required_gender,
      }

      const matching = availableThatEvening.filter((artist) => matchesHardRequirements(artist, criteria))
      const available = matching.filter((artist) => !involved.has(artist.id))

      return {
        id: req.id,
        roleName: req.role_name,
        quantity: req.quantity,
        filled,
        pendingAuto: pending.length - manual.length,
        pendingManual: manual.length,
        oldestManualOfferAt: manual
          .map((offer) => offer.sent_at)
          .filter((sent): sent is string => Boolean(sent))
          .sort()[0] ?? null,
        declined: showOffers.filter((offer) => offer.show_requirement_id === req.id && offer.status === 'declined').length,
        submissionsOpen: Boolean(req.submissions_open),
        autoStarted: Boolean(req.auto_started_at),
        matching: matching.length,
        available: available.length,
        // Bare når varselet faktisk skal si «så mange kommer inn om kravet
        // lempes». Ellers er dette en full gjennomgang av hele listen per
        // plass per show, til ingen nytte.
        relaxable: matching.length === 0 ? bestRelaxation(criteria, availableThatEvening, involved) : null,
      }
    })

    return {
      id: show.id,
      title: show.title,
      date: show.date,
      status: show.status as ShowStatus,
      lineupDeadlineDays: lineupDeadlineDaysFor(club, settings),
      requirements: attentionRequirements,
      pendingSubmissions: submissionsByShow.get(show.id) ?? 0,
      unreviewedSpots: show.date < today
        ? activeSpots.filter((spot) => !reviewedSpotIds.has(spot.id)).length
        : 0,
      clubPayoutReady: isClubPayoutReady(club),
    }
  })

  return bookingAttention({ shows: attentionShows, settings, now })
}

/**
 * Kravet som slipper inn flest om det lempes.
 *
 * Rollen er ikke med: den er selve plassen, og å «lempe» den er å bestille
 * noe annet. Energi og kjønn er derimot ønsker bookeren ofte kan gi slipp på
 * når alternativet er en tom plass.
 */
function bestRelaxation(
  criteria: { role_name: string; energy_level: string; required_gender: string },
  pool: Array<{ id: string; admin_energy_level: unknown; gender: unknown; category: unknown }>,
  involved: ReadonlySet<string>,
): { blocker: RequirementBlocker; count: number } | null {
  const countWith = (relaxed: typeof criteria) =>
    pool.filter((artist) =>
      !involved.has(artist.id)
      && matchesHardRequirements(artist as Parameters<typeof matchesHardRequirements>[0], relaxed),
    ).length

  const options: Array<{ blocker: RequirementBlocker; count: number }> = []
  if (criteria.energy_level !== 'any') {
    options.push({ blocker: 'energy', count: countWith({ ...criteria, energy_level: 'any' }) })
  }
  if (criteria.required_gender !== 'any') {
    options.push({ blocker: 'gender', count: countWith({ ...criteria, required_gender: 'any' }) })
  }

  const best = options.sort((a, b) => b.count - a.count)[0]
  return best && best.count > 0 ? best : null
}
