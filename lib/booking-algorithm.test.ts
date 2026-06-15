import { describe, expect, it } from 'vitest'
import {
  getGlobalBookingCap,
  getRoleExpansionOptions,
  matchesHardRequirements,
  matchesRoleForDemand,
  roleBookingKey,
  type ClubBookingSettings,
  type ScoringArtist,
} from './booking-scoring'
import {
  buildRequirements,
  simulateSeason,
} from './booking-democracy-helpers'
import {
  createFairnessContext,
  createRealisticClubRoster,
  makeArtist,
  makeRequirement,
  simulateBooking,
  simulateBookingCascade,
  withPreset,
  type SimAssignment,
  type SimRequirement,
} from './booking-test-helpers'

function expansionForRequirement(
  artists: ScoringArtist[],
  req: SimRequirement,
  config: ClubBookingSettings,
  totalClubEvents: number,
) {
  const dedicatedPoolSize = artists.filter(a =>
    strictFilterWithoutExpansion(a, req, config),
  ).length
  const demandRatio = totalClubEvents / Math.max(1, dedicatedPoolSize)
  return getRoleExpansionOptions(req.role_name, demandRatio, dedicatedPoolSize)
}

function strictFilterWithoutExpansion(
  artist: ScoringArtist,
  req: SimRequirement,
  config: ClubBookingSettings,
) {
  return matchesHardRequirements(artist, req)
    && (artist.admin_score ?? 0) >= Math.max(req.min_score ?? config.min_bookable_score, config.min_bookable_score)
}

/** Verifiserer at hver assignment matcher sitt konkrete krav — inkl. rolleutvidelse. */
function assertAssignmentsMatchRequirements(
  assignments: SimAssignment[],
  requirements: SimRequirement[],
  artists: ScoringArtist[],
  config: ClubBookingSettings,
  totalClubEvents = 20,
) {
  for (const assignment of assignments) {
    const artist = artists.find(a => a.id === assignment.artistId)
    const req = requirements.find(r => r.id === assignment.requirementId)
    expect(artist, `ukjent komiker ${assignment.artistId}`).toBeDefined()
    expect(req, `ukjent krav ${assignment.requirementId}`).toBeDefined()

    const expansion = expansionForRequirement(artists, req!, config, totalClubEvents)
    expect(
      matchesRoleForDemand(artist!, req!, config, expansion),
      `${assignment.artistId} booket på ${req!.role_name} uten gyldig rolle-match`,
    ).toBe(true)
  }
}

function pickConfirmedWinners(
  assignments: SimAssignment[],
  requirements: SimRequirement[],
) {
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

function runTrackedSeason(
  artists: ScoringArtist[],
  requirements: SimRequirement[],
  numShows: number,
  config: ClubBookingSettings,
  options: {
    totalClubEventsStart?: number
    availableArtistIds?: string[]
  } = {},
) {
  const bookingCounts = new Map<string, number>()
  const roleCounts = new Map<string, number>()
  for (const a of artists) bookingCounts.set(a.id, 0)

  let previousEventArtists: string[] = []
  let totalClubEvents = options.totalClubEventsStart ?? 10

  for (let show = 0; show < numShows; show++) {
    totalClubEvents += 1
    const fairnessContext = createFairnessContext(
      Object.fromEntries(bookingCounts),
      previousEventArtists,
      totalClubEvents,
      Object.fromEntries(roleCounts),
    )

    const result = simulateBooking({
      artists,
      requirements,
      config: { ...config, offers_per_slot: 1 },
      availableArtistIds: options.availableArtistIds ?? artists.map(a => a.id),
      fairnessContext,
    })

    const winners = pickConfirmedWinners(result.assignments, requirements)
    previousEventArtists = winners.map(w => w.artistId)

    for (const winner of winners) {
      bookingCounts.set(winner.artistId, (bookingCounts.get(winner.artistId) ?? 0) + 1)
      const key = roleBookingKey(winner.artistId, winner.roleName)
      if (key) roleCounts.set(key, (roleCounts.get(key) ?? 0) + 1)
    }
  }

  const globalCounts = [...bookingCounts.values()].filter(c => c > 0)
  return {
    bookingCounts,
    roleCounts,
    maxGlobal: globalCounts.length ? Math.max(...globalCounts) : 0,
    uniqueWinners: globalCounts.length,
    totalSpots: globalCounts.reduce((a, b) => a + b, 0),
  }
}

describe('bookingalgoritme — integrasjon', () => {
  describe('rolle-korrekthet per plass', () => {
    it('full kveld: hver assignment matcher sitt spesifikke krav', () => {
      const roster = createRealisticClubRoster('medium')
      const requirements = [
        makeRequirement('mc', 'konferansier', { quantity: 1, lineupPosition: 0 }),
        makeRequirement('hl', 'headliner', { quantity: 1, minScore: 8, lineupPosition: 1 }),
        makeRequirement('su', 'stand-up', { quantity: 3, lineupPosition: 2 }),
        makeRequirement('om', 'open mic', { quantity: 2, lineupPosition: 3 }),
      ]
      const config = withPreset('normal', { offers_per_slot: 1 })

      const { assignments } = simulateBooking({
        artists: roster,
        requirements,
        config,
        fairnessContext: createFairnessContext({}, [], 22),
      })

      assertAssignmentsMatchRequirements(assignments, requirements, roster, config, 22)
      expect(new Set(assignments.map(a => a.artistId)).size).toBe(assignments.length)
    })

    it('rolleutvidelse: stand-up kan bookes på open mic når poolen er liten', () => {
      const roster = [
        makeArtist('om-1', { score: 7, roles: ['open mic'] }),
        makeArtist('om-2', { score: 6, roles: ['open mic'] }),
        ...Array.from({ length: 12 }, (_, i) =>
          makeArtist(`su-${i}`, { score: 6 + (i % 3), roles: ['stand-up'] }),
        ),
      ]
      const requirements = [
        makeRequirement('om', 'open mic', { quantity: 2, lineupPosition: 0 }),
      ]
      const config = withPreset('normal', { offers_per_slot: 1 })

      const steps = simulateBookingCascade({
        artists: roster,
        requirements,
        config,
        fairnessContext: createFairnessContext({}, [], 24),
      }, 4)

      const assignments = steps.flatMap(step => step.assignments)
      expect(assignments.length).toBeGreaterThan(0)
      assertAssignmentsMatchRequirements(assignments, requirements, roster, config, 24)

      const expandedBooking = assignments.find(a => a.artistId.startsWith('su-'))
      expect(expandedBooking, 'forventer at stand-up fyller open mic etter dedikert pool er brukt').toBeDefined()
    })
  })

  describe('nisje-roller under sesongpress', () => {
    it('open-mic-heavy: ingen komiker tar mer enn halvparten av open mic-plassene (strict)', () => {
      const roster = [
        ...Array.from({ length: 4 }, (_, i) =>
          makeArtist(`om-${i}`, { score: 6 + i, roles: ['open mic'] }),
        ),
        ...Array.from({ length: 30 }, (_, i) =>
          makeArtist(`su-${i}`, { score: 5 + (i % 5), roles: ['stand-up'] }),
        ),
      ]
      const requirements = buildRequirements('open-mic-heavy', 3)
      const config = withPreset('strict', { offers_per_slot: 1 })

      const { roleCounts } = runTrackedSeason(roster, requirements, 10, config, {
        totalClubEventsStart: 18,
      })

      const openMicCounts = [...roleCounts.entries()]
        .filter(([key]) => key.endsWith(':open mic'))
        .map(([, count]) => count)

      const totalOpenMicSpots = openMicCounts.reduce((a, b) => a + b, 0)
      expect(totalOpenMicSpots).toBeGreaterThan(0)

      const maxOpenMicShare = Math.max(...openMicCounts) / totalOpenMicSpots
      expect(
        maxOpenMicShare,
        `dominans ${Math.round(maxOpenMicShare * 100)}% på open mic-plasser`,
      ).toBeLessThanOrEqual(0.5)
    })

    it('headliner-focus: flere komikere fyller headliner når dedikert pool er på 2', () => {
      const roster = [
        makeArtist('hl-1', { score: 9, roles: ['headliner'] }),
        makeArtist('hl-2', { score: 9, roles: ['headliner'] }),
        ...Array.from({ length: 20 }, (_, i) =>
          makeArtist(`su-${i}`, { score: 8 + (i % 2), roles: ['stand-up'] }),
        ),
      ]
      const requirements = buildRequirements('headliner-focus', 3)
      const config = withPreset('normal', { offers_per_slot: 1 })

      const { roleCounts } = runTrackedSeason(roster, requirements, 12, config, {
        totalClubEventsStart: 20,
      })

      const headlinerWinners = new Set(
        [...roleCounts.keys()]
          .filter(key => key.endsWith(':headliner'))
          .map(key => key.split(':')[0]),
      )

      expect(headlinerWinners.size).toBeGreaterThanOrEqual(3)
    })

    it('full lineup uten MC: stand-up fyller konferansier-plass ved høy etterspørsel', () => {
      const roster = Array.from({ length: 15 }, (_, i) =>
        makeArtist(`su-${i}`, { score: 7 + (i % 3), roles: ['stand-up'] }),
      )
      const requirements = buildRequirements('full', 2)
      const config = withPreset('normal', { offers_per_slot: 1 })

      const { assignments } = simulateBooking({
        artists: roster,
        requirements,
        config,
        fairnessContext: createFairnessContext({}, [], 22),
      })

      const mcAssignment = assignments.find(a => a.requirementId === 'mc')
      expect(mcAssignment).toBeDefined()
      assertAssignmentsMatchRequirements(assignments, requirements, roster, config, 22)
    })
  })

  describe('preset-atferd', () => {
    it('streng preset gir lavere sesongdominans enn mild på identisk roster', () => {
      const roster = createRealisticClubRoster('medium')
      const requirements = [makeRequirement('su', 'stand-up', { quantity: 2, lineupPosition: 0 })]

      const mild = runTrackedSeason(roster, requirements, 10, withPreset('mild'), {
        totalClubEventsStart: 12,
      })
      const strict = runTrackedSeason(roster, requirements, 10, withPreset('strict'), {
        totalClubEventsStart: 12,
      })

      expect(strict.maxGlobal).toBeLessThanOrEqual(mild.maxGlobal)
      expect(strict.uniqueWinners).toBeGreaterThanOrEqual(
        Math.floor(mild.uniqueWinners * 0.7),
      )
    })

    it('streng preset lar ubooket komiker slå ofte-booket veteran på samme show', () => {
      const veteran = makeArtist('veteran', { score: 10, roles: ['stand-up'] })
      const rookie = makeArtist('rookie', { score: 7, roles: ['stand-up'] })
      const requirements = [makeRequirement('su', 'stand-up', { quantity: 1 })]

      const strictResult = simulateBooking({
        artists: [veteran, rookie],
        requirements,
        config: withPreset('strict', { offers_per_slot: 1 }),
        fairnessContext: createFairnessContext({ veteran: 4, rookie: 0 }, [], 20),
      })

      expect(strictResult.assignments[0]?.artistId).toBe('rookie')
    })
  })

  describe('cap, historikk og rotasjon', () => {
    it('ingen komiker bookes over global cap når alternativer finnes', () => {
      const roster = Array.from({ length: 40 }, (_, i) =>
        makeArtist(`a-${i}`, { score: 6 + (i % 4), roles: ['stand-up'] }),
      )
      const requirements = [makeRequirement('su', 'stand-up', { quantity: 1 })]
      const totalClubEventsStart = 14
      const config = withPreset('normal', { offers_per_slot: 1 })
      const globalCap = getGlobalBookingCap(totalClubEventsStart + 8, roster.length)

      const { maxGlobal } = runTrackedSeason(roster, requirements, 8, config, {
        totalClubEventsStart,
      })

      expect(maxGlobal).toBeLessThanOrEqual(globalCap)
    })

    it('klubb med importert historikk: catch-up fordeler nye plasser bredere', () => {
      const roster = [
        makeArtist('star', { score: 9, roles: ['stand-up'] }),
        ...Array.from({ length: 15 }, (_, i) =>
          makeArtist(`f-${i}`, { score: 7, roles: ['stand-up'] }),
        ),
      ]
      const requirements = [makeRequirement('su', 'stand-up', { quantity: 1 })]
      const config = withPreset('normal', { offers_per_slot: 1 })

      const bookingCounts: Record<string, number> = { ghost: 4, other: 3, star: 2 }
      for (const a of roster) {
        if (!bookingCounts[a.id]) bookingCounts[a.id] = 0
      }

      const freshOnlyWinners = new Set<string>()
      const withHistoryWinners = new Set<string>()

      for (let show = 0; show < 6; show++) {
        const baseContext = createFairnessContext(
          Object.fromEntries(roster.map(a => [a.id, 0])),
          [],
          14 + show,
        )
        const historyContext = createFairnessContext(
          { ...bookingCounts, ...Object.fromEntries(
            roster.filter(a => !bookingCounts[a.id] && a.id !== 'star').map(a => [a.id, 0]),
          ) },
          [],
          14 + show,
        )

        const fresh = simulateBooking({
          artists: roster,
          requirements,
          config,
          fairnessContext: baseContext,
        })
        const withHistory = simulateBooking({
          artists: roster,
          requirements,
          config,
          fairnessContext: historyContext,
        })

        const freshWinner = pickConfirmedWinners(fresh.assignments, requirements)[0]?.artistId
        const historyWinner = pickConfirmedWinners(withHistory.assignments, requirements)[0]?.artistId
        if (freshWinner) freshOnlyWinners.add(freshWinner)
        if (historyWinner) {
          withHistoryWinners.add(historyWinner)
          bookingCounts[historyWinner] = (bookingCounts[historyWinner] ?? 0) + 1
        }
      }

      expect(withHistoryWinners.size).toBeGreaterThan(freshOnlyWinners.size)
      expect(bookingCounts.star).toBeLessThanOrEqual(4)
    })

    it('forrige show + mange bookinger: komiker roteres ut (normal preset)', () => {
      const previous = makeArtist('prev', { score: 9, roles: ['stand-up'] })
      const fresh = makeArtist('fresh', { score: 9, roles: ['stand-up'] })
      const requirements = [makeRequirement('su', 'stand-up', { quantity: 1 })]

      const { assignments } = simulateBooking({
        artists: [previous, fresh],
        requirements,
        config: withPreset('normal', { offers_per_slot: 1 }),
        fairnessContext: createFairnessContext(
          { prev: 3, fresh: 0 },
          ['prev'],
          18,
        ),
      })

      expect(assignments[0]?.artistId).toBe('fresh')
    })
  })

  describe('demokratisk sesong (simulateSeason)', () => {
    it('typisk klubb med 55 komikere og full lineup holder seg innenfor demokratiske grenser', () => {
      const roster = createRealisticClubRoster('large').slice(0, 55)
      const requirements = buildRequirements('full', 2)
      const result = simulateSeason(roster, requirements, 8, withPreset('normal'), {
        seed: 42,
        offersPerSlot: 1,
      })

      expect(result.totalSpots).toBeGreaterThan(0)
      expect(result.maxBookingsPerArtist / result.totalSpots).toBeLessThanOrEqual(0.25)
      expect(result.dominanceRatio).toBeLessThanOrEqual(2.5)
      expect(result.giniCoefficient).toBeLessThan(0.65)
    })
  })
})
