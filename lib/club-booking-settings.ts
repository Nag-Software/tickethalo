import { createAdminClient } from '@/lib/supabase/admin'
import {
  CONFIRMED_SPOT_STATUSES,
  DEFAULT_CLUB_BOOKING_SETTINGS,
  FAIRNESS_EVENT_STATUSES,
  roleBookingKey,
  type ClubBookingSettings,
  type ClubFairnessContext,
  fairnessCutoffDate,
  parseClubBookingSettingsRow,
} from '@/lib/booking-scoring'

type AdminClient = ReturnType<typeof createAdminClient>

export async function loadClubBookingSettings(
  admin: AdminClient,
  clubId: string | null | undefined,
): Promise<ClubBookingSettings> {
  const { data: globalDefaults } = await admin
    .from('booking_scoring_config')
    .select('*')
    .eq('id', 'default')
    .maybeSingle()

  if (!clubId) {
    return parseClubBookingSettingsRow(globalDefaults ? {
      ...DEFAULT_CLUB_BOOKING_SETTINGS,
      quality_weight: globalDefaults.quality_weight,
      availability_bonus: globalDefaults.availability_bonus,
      role_match_bonus: globalDefaults.role_match_bonus,
      offers_per_slot: globalDefaults.offers_per_slot,
      fallback_limit: globalDefaults.fallback_limit,
    } : null)
  }

  const { data: clubSettings } = await admin
    .from('club_booking_settings')
    .select('*')
    .eq('club_id', clubId)
    .maybeSingle()

  if (clubSettings) {
    return parseClubBookingSettingsRow(clubSettings)
  }

  return parseClubBookingSettingsRow(globalDefaults ? {
    ...DEFAULT_CLUB_BOOKING_SETTINGS,
    quality_weight: globalDefaults.quality_weight,
    availability_bonus: globalDefaults.availability_bonus,
    role_match_bonus: globalDefaults.role_match_bonus,
    offers_per_slot: globalDefaults.offers_per_slot,
    fallback_limit: globalDefaults.fallback_limit,
  } : null)
}

type ShowRow = {
  id: string
  date: string
  start_time: string | null
  created_at: string
}

function compareShowsChronologically(a: ShowRow, b: ShowRow) {
  if (a.date !== b.date) return a.date.localeCompare(b.date)
  const aTime = a.start_time ?? ''
  const bTime = b.start_time ?? ''
  if (aTime !== bTime) return aTime.localeCompare(bTime)
  if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at)
  return a.id.localeCompare(b.id)
}

export async function buildClubFairnessContext(
  admin: AdminClient,
  clubId: string | null | undefined,
  currentShow: ShowRow,
  config: ClubBookingSettings,
): Promise<ClubFairnessContext> {
  const emptyContext: ClubFairnessContext = {
    bookingCountByArtist: new Map(),
    bookingCountByArtistRole: new Map(),
    totalClubEvents: 0,
    artistsOnPreviousEvent: new Set(),
    windowMonths: config.fairness_window_months,
  }

  if (!clubId) return emptyContext

  const cutoff = fairnessCutoffDate(currentShow.date, config.fairness_window_months)

  const { data: windowShows } = await admin
    .from('shows')
    .select('id, date, start_time, created_at')
    .eq('club_id', clubId)
    .gte('date', cutoff)
    .lte('date', currentShow.date)
    .in('status', [...FAIRNESS_EVENT_STATUSES])

  const shows = (windowShows ?? []) as ShowRow[]
  const historicalShows = shows.filter(show => show.id !== currentShow.id)
  const totalClubEvents = shows.length

  const bookingCountByArtist = new Map<string, number>()
  const bookingCountByArtistRole = new Map<string, number>()

  if (historicalShows.length > 0) {
    const historicalShowIds = historicalShows.map(show => show.id)
    const { data: spots } = await admin
      .from('confirmed_spots')
      .select('artist_id, show_id, show_requirement_id')
      .in('show_id', historicalShowIds)
      .in('status', [...CONFIRMED_SPOT_STATUSES])

    const requirementIds = [...new Set((spots ?? []).map(spot => spot.show_requirement_id).filter(Boolean))]
    const roleByRequirementId = new Map<string, string>()

    if (requirementIds.length > 0) {
      const { data: requirements } = await admin
        .from('show_requirements')
        .select('id, role_name')
        .in('id', requirementIds)

      for (const requirement of requirements ?? []) {
        roleByRequirementId.set(requirement.id, requirement.role_name)
      }
    }

    const showsByArtist = new Map<string, Set<string>>()
    for (const spot of spots ?? []) {
      if (!showsByArtist.has(spot.artist_id)) {
        showsByArtist.set(spot.artist_id, new Set())
      }
      showsByArtist.get(spot.artist_id)!.add(spot.show_id)

      const roleName = spot.show_requirement_id
        ? roleByRequirementId.get(spot.show_requirement_id)
        : undefined
      const roleKey = roleName ? roleBookingKey(spot.artist_id, roleName) : null
      if (roleKey) {
        bookingCountByArtistRole.set(roleKey, (bookingCountByArtistRole.get(roleKey) ?? 0) + 1)
      }
    }

    for (const [artistId, showIds] of showsByArtist) {
      bookingCountByArtist.set(artistId, showIds.size)
    }
  }

  const previousShow = historicalShows
    .filter(show => compareShowsChronologically(show, currentShow) < 0)
    .sort((a, b) => compareShowsChronologically(b, a))[0]

  const artistsOnPreviousEvent = new Set<string>()
  if (previousShow) {
    const { data: previousSpots } = await admin
      .from('confirmed_spots')
      .select('artist_id')
      .eq('show_id', previousShow.id)
      .in('status', [...CONFIRMED_SPOT_STATUSES])

    for (const spot of previousSpots ?? []) {
      artistsOnPreviousEvent.add(spot.artist_id)
    }
  }

  return {
    bookingCountByArtist,
    bookingCountByArtistRole,
    totalClubEvents,
    artistsOnPreviousEvent,
    windowMonths: config.fairness_window_months,
  }
}

export async function loadClubBookingStats(
  admin: AdminClient,
  clubId: string,
  config: ClubBookingSettings,
): Promise<{ totalClubEvents: number }> {
  const today = new Date().toISOString().slice(0, 10)
  const cutoff = fairnessCutoffDate(today, config.fairness_window_months)

  const { count } = await admin
    .from('shows')
    .select('*', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .gte('date', cutoff)
    .lte('date', today)
    .in('status', [...FAIRNESS_EVENT_STATUSES])

  return { totalClubEvents: count ?? 0 }
}
