import {
  computeBaseScore,
  computeFinalScore,
  getRoleBookingCount,
  strictFilter,
  type ClubBookingSettings,
  type ScoringRequirement,
} from '@/lib/booking-scoring'
import { buildClubFairnessContext } from '@/lib/club-booking-settings'
import { ARTIST_ROLE_OPTIONS, normalizeArtistRole, type CanonicalArtistRole } from '@/lib/artist-roles'
import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

export type ArtistPriorityRow = {
  artistId: string
  fullName: string
  stageName: string | null
  adminScore: number | null
  globalBookings: number
  roleBookings: number
  /** Marked available on the reference show date, if any. */
  prioritizedForReferenceShow: boolean
  /** Number of future dates the artist has prioritized (0–3). */
  upcomingAvailabilityCount: number
  baseScore: number
  finalScore: number
  bookable: boolean
}

export type ClubArtistPriorities = {
  rows: ArtistPriorityRow[]
  referenceDate: string | null
  referenceShowTitle: string | null
  roleName: CanonicalArtistRole
  eligiblePoolSize: number
  totalClubEvents: number
}

export function parsePriorityRoleParam(value: string | undefined): CanonicalArtistRole {
  const normalized = normalizeArtistRole(value ?? 'stand-up')
  if (normalized && ARTIST_ROLE_OPTIONS.some(option => option.value === normalized)) {
    return normalized
  }
  return 'stand-up'
}

function mockRequirement(roleName: string): ScoringRequirement {
  return {
    role_name: roleName,
    min_score: null,
    energy_level: 'any',
    required_gender: 'any',
  }
}

export async function loadClubArtistPriorities(
  admin: AdminClient,
  clubId: string,
  settings: ClubBookingSettings,
  roleName: CanonicalArtistRole,
): Promise<ClubArtistPriorities> {
  const today = new Date().toISOString().slice(0, 10)

  const { data: referenceShow } = await admin
    .from('shows')
    .select('date, title')
    .eq('club_id', clubId)
    .gte('date', today)
    .in('status', ['booking', 'fullbooked', 'published'])
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle()

  const referenceDate = referenceShow?.date ?? null
  const requirement = mockRequirement(roleName)

  const fairnessContext = await buildClubFairnessContext(admin, clubId, {
    id: 'priority-preview',
    date: referenceDate ?? today,
    start_time: null,
    created_at: referenceDate ?? today,
  }, settings)

  const [{ data: artists }, { data: allFutureAvailability }] = await Promise.all([
    admin
      .from('artists')
      .select('id, full_name, stage_name, admin_score, admin_energy_level, gender, category')
      .eq('status', 'approved')
      .eq('is_flagged', false)
      .order('full_name'),
    admin
      .from('artist_availability')
      .select('artist_id, available_date')
      .gte('available_date', today),
  ])

  const availabilityByArtist = new Map<string, Set<string>>()
  for (const row of allFutureAvailability ?? []) {
    if (!availabilityByArtist.has(row.artist_id)) {
      availabilityByArtist.set(row.artist_id, new Set())
    }
    availabilityByArtist.get(row.artist_id)!.add(row.available_date)
  }

  const availableSet = new Set<string>()
  if (referenceDate) {
    for (const row of allFutureAvailability ?? []) {
      if (row.available_date === referenceDate) {
        availableSet.add(row.artist_id)
      }
    }
  }
  const roster = artists ?? []
  const eligiblePoolSize = Math.max(
    1,
    roster.filter(artist => strictFilter(artist, requirement, new Set(), settings)).length,
  )
  const poolContext = { eligiblePoolSize }

  const rows: ArtistPriorityRow[] = roster.map((artist) => {
    const globalBookings = fairnessContext.bookingCountByArtist.get(artist.id) ?? 0
    const roleBookings = getRoleBookingCount(artist.id, roleName, fairnessContext)
    const baseScore = computeBaseScore(artist, roleName, settings, availableSet)
    const finalScore = computeFinalScore(
      artist,
      roleName,
      settings,
      availableSet,
      fairnessContext,
      poolContext,
    )

    return {
      artistId: artist.id,
      fullName: artist.full_name,
      stageName: artist.stage_name,
      adminScore: artist.admin_score,
      globalBookings,
      roleBookings,
      prioritizedForReferenceShow: referenceDate
        ? availabilityByArtist.get(artist.id)?.has(referenceDate) ?? false
        : false,
      upcomingAvailabilityCount: availabilityByArtist.get(artist.id)?.size ?? 0,
      baseScore,
      finalScore,
      bookable: strictFilter(artist, requirement, new Set(), settings),
    }
  })

  rows.sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore
    return (b.adminScore ?? 0) - (a.adminScore ?? 0)
  })

  return {
    rows,
    referenceDate,
    referenceShowTitle: referenceShow?.title ?? null,
    roleName,
    eligiblePoolSize,
    totalClubEvents: fairnessContext.totalClubEvents,
  }
}
