import { artistMatchesRole, normalizeArtistRole } from '@/lib/artist-roles'

export const FAIRNESS_EVENT_STATUSES = ['booking', 'fullbooked', 'published', 'completed'] as const
export const CONFIRMED_SPOT_STATUSES = ['confirmed', 'completed', 'paid'] as const

/**
 * Comedians are no longer graded on a 1–10 quality scale. Booking is driven by
 * per-club nivå (role tags), availability, fairness/history and flagging.
 * The scoring engine still expects an `admin_score`, so the booking data paths
 * feed every candidate this neutral value: it clears any min-score gate and is
 * identical for everyone, so it never differentiates candidates. The dormant
 * quality machinery can be removed entirely in a later cleanup.
 */
export const BOOKING_NEUTRAL_SCORE = 10

export type ClubBookingSettings = {
  club_id?: string
  fairness_window_months: number
  fairness_multiplier_0: number
  fairness_multiplier_1: number
  fairness_multiplier_2: number
  fairness_multiplier_3: number
  fairness_multiplier_4_plus: number
  consecutive_event_multiplier: number
  quality_weight: number
  availability_bonus: number
  role_match_bonus: number
  offers_per_slot: number
  /** Max simultaneous sent offers per requirement per booking wave. */
  offers_per_wave: number
  fallback_limit: number
  min_bookable_score: number
}

/** Autobooking: 24h response window per offer. */
export const AUTO_BOOKING_OFFER_EXPIRY_MS = 24 * 60 * 60 * 1000

export const OFFER_BUDGET_STATUSES = [
  'sent',
  'declined',
  'expired',
  'filled_by_other',
  'accepted',
] as const

/** Artist cannot receive a new offer on this show while any offer has one of these statuses. */
export const OFFER_REOFFER_BLOCK_STATUSES = [
  'sent',
  'declined',
  'expired',
  'accepted',
] as const

export function buildShowBookingInvolvedSet(input: {
  offers: Array<{ artist_id: string; status: string }>
  confirmedSpotArtistIds: string[]
  excludedArtistIds?: string[]
}): Set<string> {
  const involved = new Set<string>([
    ...input.confirmedSpotArtistIds,
    ...(input.excludedArtistIds ?? []),
  ])

  for (const offer of input.offers) {
    if (OFFER_REOFFER_BLOCK_STATUSES.includes(offer.status as (typeof OFFER_REOFFER_BLOCK_STATUSES)[number])) {
      involved.add(offer.artist_id)
    }
  }

  return involved
}

export function autoBookingOfferExpiresAt(from = Date.now()): string {
  return new Date(from + AUTO_BOOKING_OFFER_EXPIRY_MS).toISOString()
}

/** Cancel excess sent offers per requirement, keeping the oldest N (cascade queue). */
export function selectExcessSentOfferIdsToCancel<
  T extends { id: string; show_requirement_id: string | null; sent_at: string | null },
>(sentOffers: T[], keepPerRequirement: number): string[] {
  const keep = Math.max(1, keepPerRequirement)
  const byRequirement = new Map<string, T[]>()

  for (const offer of sentOffers) {
    if (!offer.show_requirement_id) continue
    const list = byRequirement.get(offer.show_requirement_id) ?? []
    list.push(offer)
    byRequirement.set(offer.show_requirement_id, list)
  }

  const toCancel: string[] = []
  for (const offers of byRequirement.values()) {
    if (offers.length <= keep) continue
    const sorted = [...offers].sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? ''))
    for (let i = keep; i < sorted.length; i++) {
      toCancel.push(sorted[i].id)
    }
  }

  return toCancel
}

/** @deprecated Use selectExcessSentOfferIdsToCancel with keepPerRequirement = 1 */
export function selectDuplicateSentOfferIdsToCancel<
  T extends { id: string; show_requirement_id: string | null; sent_at: string | null },
>(sentOffers: T[]): string[] {
  return selectExcessSentOfferIdsToCancel(sentOffers, 1)
}

export const DEFAULT_CLUB_BOOKING_SETTINGS: ClubBookingSettings = {
  fairness_window_months: 12,
  fairness_multiplier_0: 1.0,
  fairness_multiplier_1: 0.7,
  fairness_multiplier_2: 0.5,
  fairness_multiplier_3: 0.3,
  fairness_multiplier_4_plus: 0.2,
  consecutive_event_multiplier: 0.1,
  quality_weight: 100,
  availability_bonus: 30,
  role_match_bonus: 15,
  offers_per_slot: 10,
  offers_per_wave: 1,
  fallback_limit: 5,
  min_bookable_score: 6,
}

export type FairnessPresetId = 'mild' | 'normal' | 'strict'

export const FAIRNESS_PRESETS: Record<FairnessPresetId, Pick<
  ClubBookingSettings,
  'fairness_multiplier_1' | 'fairness_multiplier_2' | 'fairness_multiplier_3' | 'fairness_multiplier_4_plus' | 'consecutive_event_multiplier'
>> = {
  mild: {
    fairness_multiplier_1: 0.85,
    fairness_multiplier_2: 0.7,
    fairness_multiplier_3: 0.55,
    fairness_multiplier_4_plus: 0.4,
    consecutive_event_multiplier: 0.3,
  },
  normal: {
    fairness_multiplier_1: 0.7,
    fairness_multiplier_2: 0.5,
    fairness_multiplier_3: 0.3,
    fairness_multiplier_4_plus: 0.2,
    consecutive_event_multiplier: 0.1,
  },
  strict: {
    fairness_multiplier_1: 0.35,
    fairness_multiplier_2: 0.15,
    fairness_multiplier_3: 0.08,
    fairness_multiplier_4_plus: 0.03,
    consecutive_event_multiplier: 0.02,
  },
}

export function detectFairnessPreset(settings: ClubBookingSettings): FairnessPresetId {
  for (const id of ['normal', 'mild', 'strict'] as const) {
    const preset = FAIRNESS_PRESETS[id]
    if (
      settings.fairness_multiplier_1 === preset.fairness_multiplier_1
      && settings.fairness_multiplier_2 === preset.fairness_multiplier_2
      && settings.fairness_multiplier_3 === preset.fairness_multiplier_3
      && settings.fairness_multiplier_4_plus === preset.fairness_multiplier_4_plus
      && settings.consecutive_event_multiplier === preset.consecutive_event_multiplier
    ) {
      return id
    }
  }
  return 'normal'
}

export type ScoringArtist = {
  id: string
  admin_score: number | null
  admin_energy_level: string | null
  gender: string | null
  category: string[] | null
}

export type ScoringRequirement = {
  role_name: string
  min_score: number | null
  energy_level: string
  required_gender: string
}

export type ClubFairnessContext = {
  bookingCountByArtist: Map<string, number>
  bookingCountByArtistRole?: Map<string, number>
  totalClubEvents: number
  artistsOnPreviousEvent: Set<string>
  windowMonths: number
}

export type ScoringPoolContext = {
  eligiblePoolSize: number
}

const DOMINANCE_BASE: Record<FairnessPresetId, number> = {
  strict: 0.05,
  normal: 0.1,
  mild: 0.4,
}

const UNDERBOOKED_BOOST: Record<FairnessPresetId, number> = {
  strict: 35,
  normal: 24,
  mild: 8,
}

export function fairnessCutoffDate(showDate: string, windowMonths: number): string {
  const date = new Date(`${showDate}T12:00:00`)
  date.setMonth(date.getMonth() - windowMonths)
  return date.toISOString().slice(0, 10)
}

export function getFairnessMultiplier(bookingCount: number, config: ClubBookingSettings): number {
  if (bookingCount <= 0) return config.fairness_multiplier_0
  if (bookingCount === 1) return config.fairness_multiplier_1
  if (bookingCount === 2) return config.fairness_multiplier_2
  if (bookingCount === 3) return config.fairness_multiplier_3
  return config.fairness_multiplier_4_plus
}

export function getConsecutiveMultiplier(
  artistId: string,
  artistsOnPreviousEvent: Set<string>,
  config: ClubBookingSettings,
): number {
  return artistsOnPreviousEvent.has(artistId) ? config.consecutive_event_multiplier : 1
}

export function getRoleBookingCount(
  artistId: string,
  roleName: string,
  context: ClubFairnessContext,
): number {
  const normalizedRole = normalizeArtistRole(roleName)
  if (normalizedRole && context.bookingCountByArtistRole && context.bookingCountByArtistRole.size > 0) {
    return context.bookingCountByArtistRole.get(`${artistId}:${normalizedRole}`) ?? 0
  }
  return 0
}

export function roleBookingKey(artistId: string, roleName: string): string | null {
  const normalizedRole = normalizeArtistRole(roleName)
  return normalizedRole ? `${artistId}:${normalizedRole}` : null
}

export function getFairShareCap(eligiblePoolSize: number, totalClubEvents: number): number {
  const poolSize = Math.max(1, eligiblePoolSize)
  const demandRatio = totalClubEvents / poolSize
  if (demandRatio >= 3) return 1
  const base = Math.max(1, Math.floor(totalClubEvents / poolSize))
  if (demandRatio >= 2) return Math.max(1, base - 1)
  return base
}

export function getDominanceMultiplier(
  bookingCount: number,
  eligiblePoolSize: number,
  totalClubEvents: number,
  config: ClubBookingSettings,
): number {
  if (bookingCount <= 0) return 1

  const fairCap = getFairShareCap(eligiblePoolSize, totalClubEvents)
  if (bookingCount < fairCap) return 1

  const preset = detectFairnessPreset(config)
  const excess = bookingCount - fairCap + 1
  return DOMINANCE_BASE[preset] ** excess
}

export function getCatchUpBoost(
  globalBookingCount: number,
  fairnessContext: ClubFairnessContext,
): number {
  const bookedCounts = [...fairnessContext.bookingCountByArtist.values()].filter(count => count > 0)
  const catchUpClub = bookedCounts.length > 0
    && bookedCounts.filter(count => count >= 2).length >= 3
    && Math.max(...bookedCounts) >= 4

  if (!catchUpClub || globalBookingCount <= 0 || globalBookingCount >= 4) return 0
  if (globalBookingCount === 3) return 40
  return globalBookingCount * 28
}

export function getUnderbookedBoost(
  bookingCount: number,
  eligiblePoolSize: number,
  totalClubEvents: number,
  config: ClubBookingSettings,
): number {
  if (bookingCount > 0) return 0
  if (totalClubEvents <= eligiblePoolSize) return 0

  const preset = detectFairnessPreset(config)
  return UNDERBOOKED_BOOST[preset]
}

export function computeBaseScore(
  artist: ScoringArtist,
  roleName: string,
  config: ClubBookingSettings,
  availableSet: Set<string>,
): number {
  const quality = ((artist.admin_score ?? 0) / 10) * config.quality_weight
  const availability = availableSet.has(artist.id) ? config.availability_bonus : 0
  const roleMatch = artistMatchesRole(roleName, artist) ? config.role_match_bonus : 0
  return quality + availability + roleMatch
}

export function computeFinalScore(
  artist: ScoringArtist,
  roleName: string,
  config: ClubBookingSettings,
  availableSet: Set<string>,
  fairnessContext: ClubFairnessContext,
  poolContext?: ScoringPoolContext,
): number {
  const baseScore = computeBaseScore(artist, roleName, config, availableSet)
  const globalBookingCount = fairnessContext.bookingCountByArtist.get(artist.id) ?? 0
  const roleBookingCount = getRoleBookingCount(artist.id, roleName, fairnessContext)
  const fairnessMultiplier = getFairnessMultiplier(globalBookingCount, config)
  const consecutiveMultiplier = getConsecutiveMultiplier(artist.id, fairnessContext.artistsOnPreviousEvent, config)

  if (!poolContext) {
    return baseScore * fairnessMultiplier * consecutiveMultiplier
  }

  const eligiblePoolSize = Math.max(1, poolContext.eligiblePoolSize)
  const dominanceMultiplier = getDominanceMultiplier(
    roleBookingCount,
    eligiblePoolSize,
    fairnessContext.totalClubEvents,
    config,
  )
  const underbookedBoost = getUnderbookedBoost(
    roleBookingCount,
    eligiblePoolSize,
    fairnessContext.totalClubEvents,
    config,
  )

  const catchUpBoost = getCatchUpBoost(globalBookingCount, fairnessContext)

  return baseScore * fairnessMultiplier * consecutiveMultiplier * dominanceMultiplier + underbookedBoost + catchUpBoost
}

export function matchesHardRequirements(artist: ScoringArtist, req: ScoringRequirement): boolean {
  if (!artistMatchesRole(req.role_name, artist)) return false
  if (req.energy_level !== 'any' && artist.admin_energy_level !== req.energy_level) return false
  if (req.required_gender && req.required_gender !== 'any' && artist.gender !== req.required_gender) return false
  return true
}

export function getGlobalBookingCap(totalClubEvents: number, rosterSize: number): number {
  const scale = Math.max(6, Math.round(Math.sqrt(Math.max(1, rosterSize))))
  const dynamic = Math.max(3, Math.ceil(totalClubEvents / scale))
  if (totalClubEvents >= 10) return Math.max(dynamic, 4)
  return dynamic
}

export function getRoleExpansionOptions(
  roleName: string,
  demandRatio: number,
  dedicatedPoolSize = 0,
): {
  expandOpenMicPool?: boolean
  expandHeadlinerPool?: boolean
  expandKonferansierPool?: boolean
} {
  if (demandRatio < 1.2 && dedicatedPoolSize > 3) return {}

  const role = normalizeArtistRole(roleName)
  if (role === 'open mic') return { expandOpenMicPool: true }
  if (role === 'headliner') return { expandHeadlinerPool: true }
  if (role === 'konferansier') return { expandKonferansierPool: true }
  return {}
}

function filterByBookingCap<T>(
  candidates: T[],
  getCount: (candidate: T) => number,
  cap: number,
): T[] {
  if (candidates.length === 0) return candidates

  const belowCap = candidates.filter(candidate => getCount(candidate) < cap)
  if (belowCap.length > 0) return belowCap

  const minCount = Math.min(...candidates.map(getCount))
  if (minCount >= cap) {
    return candidates.filter(candidate => getCount(candidate) === minCount)
  }

  return candidates.filter(candidate => getCount(candidate) === minCount)
}

export function applyBookingFairnessFilters<T extends ScoringArtist>(
  candidates: T[],
  roleName: string,
  fairnessContext: ClubFairnessContext,
  poolSize: number,
  rosterSize: number,
): T[] {
  if (candidates.length === 0) return candidates

  const roleCap = getFairShareCap(poolSize, fairnessContext.totalClubEvents)
  let filtered = filterByBookingCap(
    candidates,
    artist => getRoleBookingCount(artist.id, roleName, fairnessContext),
    roleCap,
  )

  const globalCap = getGlobalBookingCap(fairnessContext.totalClubEvents, rosterSize)
  filtered = filterByBookingCap(
    filtered,
    artist => fairnessContext.bookingCountByArtist.get(artist.id) ?? 0,
    globalCap,
  )

  return filtered
}

/** When open mic demand exceeds dedicated pool size, stand-up comedians may fill open mic slots. */
export function matchesRoleForDemand(
  artist: ScoringArtist,
  req: ScoringRequirement,
  config: ClubBookingSettings,
  options: {
    expandOpenMicPool?: boolean
    expandHeadlinerPool?: boolean
    expandKonferansierPool?: boolean
  } = {},
): boolean {
  if (matchesHardRequirements(artist, req)) return true

  const role = normalizeArtistRole(req.role_name)
  const minScore = getEffectiveMinScore(req, config)
  const score = artist.admin_score ?? 0

  if (req.energy_level !== 'any' && artist.admin_energy_level !== req.energy_level) return false
  if (req.required_gender && req.required_gender !== 'any' && artist.gender !== req.required_gender) return false
  if (score < minScore) return false

  if (
    role === 'open mic'
    && options.expandOpenMicPool
    && artistMatchesRole('stand-up', artist)
    && !artistMatchesRole('open mic', artist)
  ) {
    return true
  }

  if (
    role === 'headliner'
    && options.expandHeadlinerPool
    && artistMatchesRole('stand-up', artist)
    && !artistMatchesRole('headliner', artist)
  ) {
    return true
  }

  if (
    role === 'konferansier'
    && options.expandKonferansierPool
    && artistMatchesRole('stand-up', artist)
    && !artistMatchesRole('konferansier', artist)
  ) {
    return true
  }

  return false
}

export function getEffectiveMinScore(req: ScoringRequirement, config: ClubBookingSettings): number {
  return Math.max(req.min_score ?? config.min_bookable_score, config.min_bookable_score)
}

export function strictFilter(
  artist: ScoringArtist,
  req: ScoringRequirement,
  alreadyInvolved: Set<string>,
  config: ClubBookingSettings,
  options: {
    expandOpenMicPool?: boolean
    expandHeadlinerPool?: boolean
    expandKonferansierPool?: boolean
  } = {},
): boolean {
  if (alreadyInvolved.has(artist.id)) return false
  if (!matchesRoleForDemand(artist, req, config, options)) return false
  if ((artist.admin_score ?? 0) < getEffectiveMinScore(req, config)) return false
  return true
}

export function expandCandidatesForDemand<T extends ScoringArtist>(
  allArtists: T[],
  req: ScoringRequirement,
  alreadyInvolved: Set<string>,
  config: ClubBookingSettings,
  options: {
    expandOpenMicPool?: boolean
    expandHeadlinerPool?: boolean
    expandKonferansierPool?: boolean
  } = {},
): T[] {
  const minScore = getEffectiveMinScore(req, config)
  const seen = new Set<string>()
  const expanded: T[] = []

  for (const threshold of [minScore, minScore - 1, minScore - 2]) {
    for (const artist of allArtists) {
      if (alreadyInvolved.has(artist.id) || seen.has(artist.id)) continue
      if (!matchesRoleForDemand(artist, req, config, options)) continue
      if ((artist.admin_score ?? 0) >= threshold) {
        expanded.push(artist)
        seen.add(artist.id)
      }
    }
  }

  return expanded
}

export function selectFallbackCandidates<T extends ScoringArtist>(
  allArtists: T[],
  req: ScoringRequirement,
  alreadyInvolved: Set<string>,
  config: ClubBookingSettings,
  limit: number,
): T[] {
  const minScore = getEffectiveMinScore(req, config)
  const base = allArtists.filter(a => !alreadyInvolved.has(a.id) && matchesHardRequirements(a, req))
  const byScore = (a: T, b: T) => (b.admin_score ?? 0) - (a.admin_score ?? 0)

  const steps: Array<(a: T) => boolean> = [
    a => (a.admin_score ?? 0) >= minScore - 1,
    a => (a.admin_score ?? 0) >= minScore - 2,
  ]

  for (const step of steps) {
    const found = base.filter(step).sort(byScore).slice(0, limit)
    if (found.length > 0) return found
  }
  return []
}

export function parseClubBookingSettingsRow(row: Record<string, unknown> | null | undefined): ClubBookingSettings {
  if (!row) return { ...DEFAULT_CLUB_BOOKING_SETTINGS }
  return {
    club_id: typeof row.club_id === 'string' ? row.club_id : undefined,
    fairness_window_months: Number(row.fairness_window_months ?? DEFAULT_CLUB_BOOKING_SETTINGS.fairness_window_months),
    fairness_multiplier_0: Number(row.fairness_multiplier_0 ?? DEFAULT_CLUB_BOOKING_SETTINGS.fairness_multiplier_0),
    fairness_multiplier_1: Number(row.fairness_multiplier_1 ?? DEFAULT_CLUB_BOOKING_SETTINGS.fairness_multiplier_1),
    fairness_multiplier_2: Number(row.fairness_multiplier_2 ?? DEFAULT_CLUB_BOOKING_SETTINGS.fairness_multiplier_2),
    fairness_multiplier_3: Number(row.fairness_multiplier_3 ?? DEFAULT_CLUB_BOOKING_SETTINGS.fairness_multiplier_3),
    fairness_multiplier_4_plus: Number(row.fairness_multiplier_4_plus ?? DEFAULT_CLUB_BOOKING_SETTINGS.fairness_multiplier_4_plus),
    consecutive_event_multiplier: Number(row.consecutive_event_multiplier ?? DEFAULT_CLUB_BOOKING_SETTINGS.consecutive_event_multiplier),
    quality_weight: Number(row.quality_weight ?? DEFAULT_CLUB_BOOKING_SETTINGS.quality_weight),
    availability_bonus: Number(row.availability_bonus ?? DEFAULT_CLUB_BOOKING_SETTINGS.availability_bonus),
    role_match_bonus: Number(row.role_match_bonus ?? DEFAULT_CLUB_BOOKING_SETTINGS.role_match_bonus),
    offers_per_slot: Number(row.offers_per_slot ?? DEFAULT_CLUB_BOOKING_SETTINGS.offers_per_slot),
    offers_per_wave: Number(row.offers_per_wave ?? DEFAULT_CLUB_BOOKING_SETTINGS.offers_per_wave),
    fallback_limit: Number(row.fallback_limit ?? DEFAULT_CLUB_BOOKING_SETTINGS.fallback_limit),
    min_bookable_score: Number(row.min_bookable_score ?? DEFAULT_CLUB_BOOKING_SETTINGS.min_bookable_score),
  }
}
