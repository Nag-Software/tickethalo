import { normalizeArtistRole } from '@/lib/artist-roles'
import {
  computeFinalScore,
  DEFAULT_CLUB_BOOKING_SETTINGS,
  expandCandidatesForDemand,
  FAIRNESS_PRESETS,
  applyBookingFairnessFilters,
  getGlobalBookingCap,
  getRoleBookingCount,
  getRoleExpansionOptions,
  selectFallbackCandidates,
  strictFilter,
  type ClubBookingSettings,
  type ClubFairnessContext,
  type ScoringArtist,
  type ScoringRequirement,
} from '@/lib/booking-scoring'

export type SimRequirement = ScoringRequirement & {
  id: string
  quantity: number
  lineup_position: number
  booking_mode?: string
}

export type SimAssignment = {
  artistId: string
  requirementId: string
  roleName: string
  finalScore: number
}

export type SimulateBookingInput = {
  artists: ScoringArtist[]
  requirements: SimRequirement[]
  config?: ClubBookingSettings
  availableArtistIds?: string[]
  fairnessContext?: ClubFairnessContext
  alreadyInvolved?: string[]
  /** Active sent offers per requirement — blocks new offers when > 0. */
  pendingOffersByRequirement?: Record<string, number>
  /** Total offer attempts per requirement (declined/expired/sent/etc.). */
  offersUsedByRequirement?: Record<string, number>
}

export type SimulateBookingResult = {
  assignments: SimAssignment[]
  offersByRequirement: Map<string, string[]>
  involvedArtistIds: Set<string>
}

function requirementRolePriority(roleName: string | null | undefined) {
  const role = normalizeArtistRole(roleName)
  if (role === 'konferansier') return 0
  if (role === 'headliner') return 1
  if (role === 'klubbspot') return 2
  if (role === 'stand-up') return 2
  if (role === 'open mic') return 3
  return 4
}

function applyFairCapFilter(
  candidates: ScoringArtist[],
  roleName: string,
  fairnessContext: ClubFairnessContext,
  poolSize: number,
  rosterSize: number,
): ScoringArtist[] {
  return applyBookingFairnessFilters(candidates, roleName, fairnessContext, poolSize, rosterSize)
}

function sortCandidatesByScore(
  artists: ScoringArtist[],
  roleName: string,
  config: ClubBookingSettings,
  availableSet: Set<string>,
  fairnessContext: ClubFairnessContext,
  totalRolePoolSize: number,
  rosterSize: number,
) {
  const poolContext = { eligiblePoolSize: Math.max(1, totalRolePoolSize) }
  const bookedCounts = [...fairnessContext.bookingCountByArtist.values()].filter(count => count > 0)
  const catchUpClub = bookedCounts.length > 0
    && bookedCounts.filter(count => count >= 2).length >= 3
    && Math.max(...bookedCounts) >= 4
  return [...artists].sort((a, b) => {
    const globalA = fairnessContext.bookingCountByArtist.get(a.id) ?? 0
    const globalB = fairnessContext.bookingCountByArtist.get(b.id) ?? 0
    if (globalA !== globalB) {
      return catchUpClub ? globalB - globalA : globalA - globalB
    }

    const countA = getRoleBookingCount(a.id, roleName, fairnessContext)
    const countB = getRoleBookingCount(b.id, roleName, fairnessContext)
    if (countA !== countB) {
      return catchUpClub ? countB - countA : countA - countB
    }

    if (globalA > 0) {
      const scoreA = a.admin_score ?? 0
      const scoreB = b.admin_score ?? 0
      if (scoreA !== scoreB) return scoreA - scoreB
    }

    return computeFinalScore(b, roleName, config, availableSet, fairnessContext, poolContext)
      - computeFinalScore(a, roleName, config, availableSet, fairnessContext, poolContext)
  })
}

function chooseCandidates(
  allArtists: ScoringArtist[],
  req: SimRequirement,
  effectiveInvolved: Set<string>,
  config: ClubBookingSettings,
  availableSet: Set<string>,
  fairnessContext: ClubFairnessContext,
  limit: number,
  fallbackLimit: number,
): ScoringArtist[] {
  const dedicatedPoolSize = allArtists.filter(a =>
    strictFilter(a, req, new Set(), config),
  ).length
  const demandRatio = fairnessContext.totalClubEvents / Math.max(1, dedicatedPoolSize)
  const filterOptions = getRoleExpansionOptions(req.role_name, demandRatio, dedicatedPoolSize)
  const hasRoleExpansion = Object.keys(filterOptions).length > 0

  const totalRolePoolSize = hasRoleExpansion
    ? allArtists.filter(a => strictFilter(a, req, new Set(), config, filterOptions)).length
    : dedicatedPoolSize

  let strictCandidates = allArtists.filter(a => strictFilter(a, req, effectiveInvolved, config, filterOptions))

  if (demandRatio >= 1.2 && (dedicatedPoolSize <= 12 || hasRoleExpansion)) {
    strictCandidates = expandCandidatesForDemand(allArtists, req, effectiveInvolved, config, filterOptions)
  }

  const globalCap = getGlobalBookingCap(fairnessContext.totalClubEvents, allArtists.length)
  const underGlobalCap = strictCandidates.filter(
    artist => (fairnessContext.bookingCountByArtist.get(artist.id) ?? 0) < globalCap,
  )
  if (underGlobalCap.length > 0) {
    strictCandidates = underGlobalCap
  }

  strictCandidates = applyFairCapFilter(
    strictCandidates,
    req.role_name,
    fairnessContext,
    Math.max(totalRolePoolSize, strictCandidates.length),
    allArtists.length,
  )

  let candidates = sortCandidatesByScore(
    strictCandidates,
    req.role_name,
    config,
    availableSet,
    fairnessContext,
    Math.max(totalRolePoolSize, strictCandidates.length),
    allArtists.length,
  ).slice(0, limit)

  if (candidates.length === 0 && fallbackLimit > 0) {
    candidates = selectFallbackCandidates(
      allArtists,
      req,
      effectiveInvolved,
      config,
      Math.min(limit, fallbackLimit),
    )
  }

  return candidates
}

/**
 * Pure simulation of bookShow candidate selection — no database or email side effects.
 */
export function simulateBooking(input: SimulateBookingInput): SimulateBookingResult {
  const config = input.config ?? { ...DEFAULT_CLUB_BOOKING_SETTINGS }
  const availableSet = new Set(input.availableArtistIds ?? [])
  const fairnessContext = input.fairnessContext ?? {
    bookingCountByArtist: new Map<string, number>(),
    totalClubEvents: 0,
    artistsOnPreviousEvent: new Set<string>(),
    windowMonths: config.fairness_window_months,
  }

  const effectiveInvolved = new Set(input.alreadyInvolved ?? [])
  const assignments: SimAssignment[] = []
  const assignedByRequirement = new Map<string, number>()

  const reqEntries = input.requirements
    .filter(req => req.booking_mode !== 'manual')
    .map((req) => {
      const slotsNeeded = req.quantity
      const offerBudget = slotsNeeded * config.offers_per_slot
      const offersUsed = input.offersUsedByRequirement?.[req.id] ?? 0
      const currentPendingOffers = input.pendingOffersByRequirement?.[req.id] ?? 0
      const maxNewOffers = Math.max(0, offerBudget - offersUsed)
      const initialStrictCount = input.artists.filter(a => strictFilter(a, req, effectiveInvolved, config)).length
      return { req, slotsNeeded, currentPendingOffers, offersUsed, initialStrictCount, maxNewOffers }
    })
    .filter(entry => entry.maxNewOffers > 0 && entry.currentPendingOffers < (config.offers_per_wave ?? 1))

  function assignCandidates(req: SimRequirement, candidates: ScoringArtist[]) {
    for (const artist of candidates) {
      effectiveInvolved.add(artist.id)
      assignments.push({
        artistId: artist.id,
        requirementId: req.id,
        roleName: req.role_name,
        finalScore: computeFinalScore(artist, req.role_name, config, availableSet, fairnessContext),
      })
      assignedByRequirement.set(req.id, (assignedByRequirement.get(req.id) ?? 0) + 1)
    }
  }

  const cascadeEntries = [...reqEntries].sort((a, b) => {
    const rolePriority = requirementRolePriority(a.req.role_name) - requirementRolePriority(b.req.role_name)
    if (rolePriority !== 0) return rolePriority

    if ((a.initialStrictCount === 0) !== (b.initialStrictCount === 0)) {
      return a.initialStrictCount === 0 ? 1 : -1
    }
    return a.initialStrictCount - b.initialStrictCount
      || a.req.lineup_position - b.req.lineup_position
  })

  for (const entry of cascadeEntries) {
    const alreadyAssignedForReq = assignedByRequirement.get(entry.req.id) ?? 0
    const remainingForReq = entry.maxNewOffers - alreadyAssignedForReq
    if (remainingForReq <= 0) continue

    const waveSize = Math.min(
      (config.offers_per_wave ?? 1) - entry.currentPendingOffers - alreadyAssignedForReq,
      remainingForReq,
    )
    if (waveSize <= 0) continue

    const fallbackRemaining = Math.max(0, config.fallback_limit - entry.offersUsed - alreadyAssignedForReq)
    const candidates = chooseCandidates(
      input.artists,
      entry.req,
      effectiveInvolved,
      config,
      availableSet,
      fairnessContext,
      waveSize,
      fallbackRemaining,
    )
    assignCandidates(entry.req, candidates)
  }

  const offersByRequirement = new Map<string, string[]>()
  for (const assignment of assignments) {
    const list = offersByRequirement.get(assignment.requirementId) ?? []
    list.push(assignment.artistId)
    offersByRequirement.set(assignment.requirementId, list)
  }

  return {
    assignments,
    offersByRequirement,
    involvedArtistIds: effectiveInvolved,
  }
}

/** Run simulateBooking repeatedly, simulating decline between steps (cascade). */
export function simulateBookingCascade(
  input: SimulateBookingInput,
  maxSteps: number,
): SimulateBookingResult[] {
  const results: SimulateBookingResult[] = []
  let alreadyInvolved = [...(input.alreadyInvolved ?? [])]
  let offersUsedByRequirement = { ...input.offersUsedByRequirement }

  for (let step = 0; step < maxSteps; step++) {
    const result = simulateBooking({
      ...input,
      alreadyInvolved,
      offersUsedByRequirement,
      pendingOffersByRequirement: {},
    })
    if (result.assignments.length === 0) break

    results.push(result)
    for (const assignment of result.assignments) {
      alreadyInvolved.push(assignment.artistId)
      offersUsedByRequirement = {
        ...offersUsedByRequirement,
        [assignment.requirementId]: (offersUsedByRequirement[assignment.requirementId] ?? 0) + 1,
      }
    }
  }

  return results
}

export function makeArtist(
  id: string,
  opts: {
    score?: number
    gender?: string | null
    energy?: string | null
    roles?: string[]
  } = {},
): ScoringArtist {
  return {
    id,
    admin_score: opts.score ?? 7,
    admin_energy_level: opts.energy ?? 'experienced',
    gender: opts.gender ?? 'male',
    category: opts.roles ?? ['stand-up'],
  }
}

export function makeRequirement(
  id: string,
  roleName: string,
  opts: {
    quantity?: number
    minScore?: number | null
    energy?: string
    gender?: string
    lineupPosition?: number
    bookingMode?: string
  } = {},
): SimRequirement {
  return {
    id,
    role_name: roleName,
    quantity: opts.quantity ?? 1,
    min_score: opts.minScore ?? null,
    energy_level: opts.energy ?? 'any',
    required_gender: opts.gender ?? 'any',
    lineup_position: opts.lineupPosition ?? 0,
    booking_mode: opts.bookingMode,
  }
}

/** Realistic club roster: mostly stand-up, few headliners/MCs, varied scores and demographics. */
export function createRealisticClubRoster(size: 'small' | 'medium' | 'large'): ScoringArtist[] {
  const counts = { small: 8, medium: 35, large: 80 } as const
  const total = counts[size]
  const artists: ScoringArtist[] = []

  const roleWeights: Array<{ role: string; weight: number }> = [
    { role: 'stand-up', weight: 0.62 },
    { role: 'open mic', weight: 0.18 },
    { role: 'headliner', weight: 0.12 },
    { role: 'konferansier', weight: 0.08 },
  ]

  function pickRole(index: number): string[] {
    const roll = (index * 17 + 3) % 100 / 100
    let cumulative = 0
    for (const { role, weight } of roleWeights) {
      cumulative += weight
      if (roll < cumulative) {
        const secondary = index % 11 === 0 && role === 'stand-up' ? ['headliner'] : []
        return [role, ...secondary]
      }
    }
    return ['stand-up']
  }

  for (let i = 0; i < total; i++) {
    const scoreBase = 4 + ((i * 7 + 13) % 7)
    const gender = i % 3 === 0 ? 'female' : 'male'
    const energy = i % 5 === 0 ? 'newcomer' : i % 7 === 0 ? 'veteran' : 'experienced'
    artists.push(makeArtist(`club-${i + 1}`, {
      score: scoreBase,
      gender,
      energy,
      roles: pickRole(i),
    }))
  }

  return artists
}

export function createFairnessContext(
  bookingCounts: Record<string, number>,
  previousEventArtists: string[] = [],
  totalClubEvents = 20,
  bookingCountsByRole: Record<string, number> = {},
): ClubFairnessContext {
  return {
    bookingCountByArtist: new Map(Object.entries(bookingCounts)),
    bookingCountByArtistRole: new Map(Object.entries(bookingCountsByRole)),
    totalClubEvents,
    artistsOnPreviousEvent: new Set(previousEventArtists),
    windowMonths: 12,
  }
}

export function withPreset(
  preset: 'mild' | 'normal' | 'strict',
  overrides: Partial<ClubBookingSettings> = {},
): ClubBookingSettings {
  const presets = {
    mild: FAIRNESS_PRESETS.mild,
    normal: {},
    strict: FAIRNESS_PRESETS.strict,
  } as const

  return {
    ...DEFAULT_CLUB_BOOKING_SETTINGS,
    ...presets[preset],
    ...overrides,
  }
}
