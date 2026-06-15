import { expect } from 'vitest'
import {
  DEFAULT_CLUB_BOOKING_SETTINGS,
  matchesHardRequirements,
  type ClubBookingSettings,
  type ScoringArtist,
} from '@/lib/booking-scoring'
import {
  createFairnessContext,
  makeArtist,
  makeRequirement,
  simulateBooking,
  type SimRequirement,
  withPreset,
} from '@/lib/booking-test-helpers'
import { roleBookingKey } from '@/lib/booking-scoring'

export type DemocracyScenario = {
  id: number
  name: string
  rosterSize: number
  numShows: number
  slotsPerShow: number
  preset: 'mild' | 'normal' | 'strict'
  lineup: 'stand-up' | 'full' | 'open-mic-heavy' | 'headliner-focus'
  availabilityPct: number
  seed: number
  preBookedCount: number
  offersPerSlot: number
}

export type SeasonResult = {
  showWinners: string[][]
  bookingCounts: Map<string, number>
  totalSpots: number
  uniqueWinners: number
  maxBookingsPerArtist: number
  minBookingsAmongWinners: number
  avgBookingsPerWinner: number
  dominanceRatio: number
  giniCoefficient: number
}

function seededRandom(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/** Deterministisk roster med minst `count` komikere (alltid >= 50 i testene). */
export function createSeededRoster(count: number, seed: number): ScoringArtist[] {
  const rand = seededRandom(seed)
  const rolePool = ['stand-up', 'stand-up', 'stand-up', 'open mic', 'headliner', 'konferansier'] as const
  const energies = ['newcomer', 'experienced', 'veteran'] as const

  return Array.from({ length: count }, (_, i) => {
    const roleRoll = rand()
    const role = rolePool[Math.floor(roleRoll * rolePool.length)]
    const score = 4 + Math.floor(rand() * 7)
    const gender = rand() < 0.35 ? 'female' : 'male'
    const energy = energies[Math.floor(rand() * energies.length)]
    const extraRole = role === 'stand-up' && rand() < 0.08 ? ['headliner'] : []
    return makeArtist(`s${seed}-${i + 1}`, {
      score,
      gender,
      energy,
      roles: [role, ...extraRole],
    })
  })
}

export function buildRequirements(
  lineup: DemocracyScenario['lineup'],
  slotsPerShow: number,
): SimRequirement[] {
  switch (lineup) {
    case 'full':
      return [
        makeRequirement('mc', 'konferansier', { quantity: 1, lineupPosition: 0 }),
        makeRequirement('hl', 'headliner', { quantity: 1, minScore: 7, lineupPosition: 1 }),
        makeRequirement('su', 'stand-up', { quantity: Math.max(1, slotsPerShow - 2), lineupPosition: 2 }),
        makeRequirement('om', 'open mic', { quantity: 1, lineupPosition: 3 }),
      ]
    case 'open-mic-heavy':
      return [
        makeRequirement('su', 'stand-up', { quantity: Math.max(1, Math.floor(slotsPerShow / 2)), lineupPosition: 0 }),
        makeRequirement('om', 'open mic', { quantity: Math.max(1, Math.ceil(slotsPerShow / 2)), lineupPosition: 1 }),
      ]
    case 'headliner-focus':
      return [
        makeRequirement('hl', 'headliner', { quantity: 1, minScore: 8, lineupPosition: 0 }),
        makeRequirement('su', 'stand-up', { quantity: slotsPerShow, lineupPosition: 1 }),
      ]
    default:
      return [
        makeRequirement('su', 'stand-up', { quantity: slotsPerShow, lineupPosition: 0 }),
      ]
  }
}

function pickShowWinners(
  assignments: { artistId: string; requirementId: string }[],
  requirements: SimRequirement[],
): Array<{ artistId: string; roleName: string }> {
  const winners: Array<{ artistId: string; roleName: string }> = []
  const used = new Set<string>()

  for (const req of [...requirements].sort((a, b) => a.lineup_position - b.lineup_position)) {
    const matches = assignments.filter(
      a => a.requirementId === req.id && !used.has(a.artistId),
    )
    for (let i = 0; i < req.quantity && i < matches.length; i++) {
      winners.push({ artistId: matches[i].artistId, roleName: req.role_name })
      used.add(matches[i].artistId)
    }
  }

  return winners
}

export function simulateSeason(
  roster: ScoringArtist[],
  requirements: SimRequirement[],
  numShows: number,
  config: ClubBookingSettings,
  options: {
    availabilityPct?: number
    seed?: number
    preBookedCount?: number
    offersPerSlot?: number
  } = {},
): SeasonResult {
  const rand = seededRandom(options.seed ?? 42)
  const availabilityPct = options.availabilityPct ?? 1
  const offersPerSlot = options.offersPerSlot ?? 1
  const bookingCounts = new Map<string, number>()
  const bookingCountsByRole = new Map<string, number>()
  for (const a of roster) bookingCounts.set(a.id, 0)

  if (options.preBookedCount && options.preBookedCount > 0) {
    const shuffled = [...roster].sort(() => rand() - 0.5)
    for (let i = 0; i < Math.min(options.preBookedCount, shuffled.length); i++) {
      bookingCounts.set(shuffled[i].id, 2 + (i % 3))
    }
  }

  const availablePool = roster.filter(() => rand() < availabilityPct).map(a => a.id)
  const availableSet = availabilityPct >= 0.99
    ? roster.map(a => a.id)
    : availablePool.length > 0 ? availablePool : roster.map(a => a.id)

  const showWinners: string[][] = []
  let previousEventArtists: string[] = []

  for (let show = 0; show < numShows; show++) {
    const fairnessContext = createFairnessContext(
      Object.fromEntries(bookingCounts),
      previousEventArtists,
      show + 10,
      Object.fromEntries(bookingCountsByRole),
    )

    const result = simulateBooking({
      artists: roster,
      requirements,
      config: { ...config, offers_per_slot: offersPerSlot },
      availableArtistIds: availableSet,
      fairnessContext,
    })

    const winners = pickShowWinners(result.assignments, requirements)
    showWinners.push(winners.map(w => w.artistId))
    previousEventArtists = winners.map(w => w.artistId)

    for (const winner of winners) {
      bookingCounts.set(winner.artistId, (bookingCounts.get(winner.artistId) ?? 0) + 1)
      const key = roleBookingKey(winner.artistId, winner.roleName)
      if (key) {
        bookingCountsByRole.set(key, (bookingCountsByRole.get(key) ?? 0) + 1)
      }
    }
  }

  const counts = [...bookingCounts.values()].filter(c => c > 0)
  const totalSpots = counts.reduce((a, b) => a + b, 0)
  const uniqueWinners = counts.length
  const maxBookingsPerArtist = counts.length ? Math.max(...counts) : 0
  const minBookingsAmongWinners = counts.length ? Math.min(...counts) : 0
  const avgBookingsPerWinner = uniqueWinners ? totalSpots / uniqueWinners : 0
  const dominanceRatio = avgBookingsPerWinner > 0 ? maxBookingsPerArtist / avgBookingsPerWinner : 0

  const sorted = [...counts].sort((a, b) => a - b)
  let gini = 0
  if (sorted.length > 0 && totalSpots > 0) {
    const n = sorted.length
    let sumDiff = 0
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sumDiff += Math.abs(sorted[i] - sorted[j])
      }
    }
    gini = sumDiff / (2 * n * totalSpots)
  }

  return {
    showWinners,
    bookingCounts,
    totalSpots,
    uniqueWinners,
    maxBookingsPerArtist,
    minBookingsAmongWinners,
    avgBookingsPerWinner,
    dominanceRatio,
    giniCoefficient: gini,
  }
}

export function assertCorrectBookings(
  roster: ScoringArtist[],
  requirements: SimRequirement[],
  showWinners: string[][],
) {
  for (const [showIdx, winners] of showWinners.entries()) {
    expect(new Set(winners).size, `show ${showIdx + 1}: duplikat`).toBe(winners.length)

    for (const winnerId of winners) {
      const artist = roster.find(a => a.id === winnerId)
      expect(artist, `show ${showIdx + 1}: ukjent komiker ${winnerId}`).toBeDefined()

      const matchingReq = requirements.find(r => matchesHardRequirements(artist!, r))
      expect(matchingReq, `show ${showIdx + 1}: ${winnerId} matcher ingen krav`).toBeDefined()
    }
  }
}

export function assertDemocraticDistribution(
  result: SeasonResult,
  rosterSize: number,
  numShows: number,
) {
  const slotsPerShow = result.totalSpots / numShows
  const expectedSpots = numShows * slotsPerShow

  expect(result.totalSpots).toBeGreaterThan(0)
  expect(result.totalSpots).toBeLessThanOrEqual(expectedSpots + 0.01)

  const minUnique = Math.min(
    rosterSize,
    Math.max(3, Math.floor(numShows * 0.4)),
  )
  expect(
    result.uniqueWinners,
    `For få unike komikere booket: ${result.uniqueWinners}/${rosterSize}`,
  ).toBeGreaterThanOrEqual(minUnique)

  const maxAllowedShare = 0.25
  const maxAllowed = Math.max(2, Math.ceil(result.totalSpots * maxAllowedShare))
  expect(
    result.maxBookingsPerArtist,
    `Én komiker dominerte med ${result.maxBookingsPerArtist}/${result.totalSpots} spots`,
  ).toBeLessThanOrEqual(maxAllowed)

  expect(
    result.dominanceRatio,
    `Dominansratio ${result.dominanceRatio.toFixed(2)} er for høy`,
  ).toBeLessThanOrEqual(2.5)

  expect(result.giniCoefficient).toBeLessThan(0.65)
}

export function generateDemocracyScenarios(): DemocracyScenario[] {
  const lineupTypes: DemocracyScenario['lineup'][] = [
    'stand-up', 'full', 'open-mic-heavy', 'headliner-focus',
  ]
  const presets: DemocracyScenario['preset'][] = ['mild', 'normal', 'strict']

  return Array.from({ length: 100 }, (_, i) => {
    const rosterSize = 50 + (i % 45)
    const numShows = 6 + (i % 10)
    const slotsPerShow = 1 + (i % 4)

    return {
      id: i + 1,
      name: [
        `Klubb ${rosterSize} komikere, ${numShows} show`,
        lineupTypes[i % lineupTypes.length],
        presets[i % presets.length],
        i % 5 === 0 ? 'med historikk' : 'fresh',
        i % 3 === 0 ? `${Math.round((i % 5) * 20)}% tilgjengelig` : 'full tilgjengelig',
      ].join(' · '),
      rosterSize,
      numShows,
      slotsPerShow,
      preset: presets[i % presets.length],
      lineup: lineupTypes[i % lineupTypes.length],
      availabilityPct: i % 3 === 0 ? 0.2 + (i % 4) * 0.2 : 1,
      seed: 1000 + i * 9973,
      preBookedCount: i % 5 === 0 ? 3 + (i % 5) : 0,
      offersPerSlot: 1 + (i % 2),
    }
  })
}

export function runScenario(scenario: DemocracyScenario) {
  const roster = createSeededRoster(scenario.rosterSize, scenario.seed)
  const requirements = buildRequirements(scenario.lineup, scenario.slotsPerShow)
  const config = withPreset(scenario.preset, {
    ...DEFAULT_CLUB_BOOKING_SETTINGS,
    offers_per_slot: scenario.offersPerSlot,
  })

  const result = simulateSeason(roster, requirements, scenario.numShows, config, {
    availabilityPct: scenario.availabilityPct,
    seed: scenario.seed,
    preBookedCount: scenario.preBookedCount,
    offersPerSlot: scenario.offersPerSlot,
  })

  return { roster, requirements, config, result }
}
