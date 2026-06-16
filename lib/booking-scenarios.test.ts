import { describe, expect, it } from 'vitest'
import {
  computeBaseScore,
  computeFinalScore,
  DEFAULT_CLUB_BOOKING_SETTINGS,
  buildShowBookingInvolvedSet,
  detectFairnessPreset,
  FAIRNESS_PRESETS,
  getEffectiveMinScore,
  matchesHardRequirements,
  parseClubBookingSettingsRow,
  selectFallbackCandidates,
  strictFilter,
  type ScoringArtist,
  type ScoringRequirement,
} from './booking-scoring'
import {
  createFairnessContext,
  createRealisticClubRoster,
  makeArtist,
  makeRequirement,
  simulateBooking,
  simulateBookingCascade,
  withPreset,
} from './booking-test-helpers'

const config = { ...DEFAULT_CLUB_BOOKING_SETTINGS }

function req(overrides: Partial<ScoringRequirement> = {}): ScoringRequirement {
  return {
    role_name: 'stand-up',
    min_score: null,
    energy_level: 'any',
    required_gender: 'any',
    ...overrides,
  }
}

describe('matchesHardRequirements', () => {
  it('krever riktig rolle', () => {
    const standUp = makeArtist('a1', { roles: ['stand-up'] })
    const headliner = makeArtist('a2', { roles: ['headliner'] })
    expect(matchesHardRequirements(standUp, req())).toBe(true)
    expect(matchesHardRequirements(headliner, req())).toBe(false)
  })

  it('filtrerer på energinivå', () => {
    const experienced = makeArtist('a1', { energy: 'experienced' })
    const newcomer = makeArtist('a2', { energy: 'newcomer' })
    const experiencedReq = req({ energy_level: 'experienced' })
    expect(matchesHardRequirements(experienced, experiencedReq)).toBe(true)
    expect(matchesHardRequirements(newcomer, experiencedReq)).toBe(false)
  })

  it('filtrerer på kjønn', () => {
    const female = makeArtist('a1', { gender: 'female' })
    const male = makeArtist('a2', { gender: 'male' })
    const femaleReq = req({ required_gender: 'female' })
    expect(matchesHardRequirements(female, femaleReq)).toBe(true)
    expect(matchesHardRequirements(male, femaleReq)).toBe(false)
  })

  it('aksepterer flere roller på komiker', () => {
    const multi = makeArtist('a1', { roles: ['stand-up', 'headliner'] })
    expect(matchesHardRequirements(multi, req({ role_name: 'headliner' }))).toBe(true)
    expect(matchesHardRequirements(multi, req({ role_name: 'stand-up' }))).toBe(true)
  })
})

describe('selectFallbackCandidates', () => {
  const artists = [
    makeArtist('high', { score: 8, roles: ['stand-up'] }),
    makeArtist('near', { score: 5, roles: ['stand-up'] }),
    makeArtist('low', { score: 3, roles: ['stand-up'] }),
    makeArtist('wrong-role', { score: 10, roles: ['headliner'] }),
  ]

  it('returnerer tom liste når ingen matcher hard requirements', () => {
    const result = selectFallbackCandidates(
      artists,
      req({ role_name: 'konferansier' }),
      new Set(),
      config,
      5,
    )
    expect(result).toHaveLength(0)
  })

  it('slapper min score med 1 poeng først', () => {
    const strictReq = req({ min_score: 6 })
    const result = selectFallbackCandidates(artists, strictReq, new Set(), config, 3)
    expect(result.map(a => a.id)).toEqual(['high', 'near'])
  })

  it('slapper min score med 2 poeng når nødvendig', () => {
    const strictReq = req({ min_score: 8 })
    const result = selectFallbackCandidates(artists, strictReq, new Set(), config, 3)
    expect(result.map(a => a.id)).toEqual(['high'])
  })

  it('respekterer alreadyInvolved og limit', () => {
    const result = selectFallbackCandidates(
      artists,
      req({ min_score: 6 }),
      new Set(['high']),
      config,
      1,
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('near')
  })
})

describe('scoring under ulike fairness-presets', () => {
  const veteran = makeArtist('veteran', { score: 9, roles: ['stand-up'] })
  const rookie = makeArtist('rookie', { score: 7, roles: ['stand-up'] })
  const availableSet = new Set([veteran.id, rookie.id])

  it('under mild preset er gapet mellom veteran og nykommer mindre enn under strict', () => {
    const mildConfig = withPreset('mild')
    const strictConfig = withPreset('strict')
    const context = createFairnessContext({ veteran: 3, rookie: 0 })
    const veteranMild = computeFinalScore(veteran, 'stand-up', mildConfig, availableSet, context)
    const rookieMild = computeFinalScore(rookie, 'stand-up', mildConfig, availableSet, context)
    const veteranStrict = computeFinalScore(veteran, 'stand-up', strictConfig, availableSet, context)
    const rookieStrict = computeFinalScore(rookie, 'stand-up', strictConfig, availableSet, context)

    const mildGap = rookieMild - veteranMild
    const strictGap = rookieStrict - veteranStrict
    expect(mildGap).toBeLessThan(strictGap)
    expect(rookieStrict).toBeGreaterThan(veteranStrict)
  })

  it('under strict preset favoriserer ubooket komiker sterkt', () => {
    const strictConfig = withPreset('strict')
    const strictContext = createFairnessContext({ veteran: 4, rookie: 0 })
    const veteranScore = computeFinalScore(veteran, 'stand-up', strictConfig, availableSet, strictContext)
    const rookieScore = computeFinalScore(rookie, 'stand-up', strictConfig, availableSet, strictContext)
    expect(rookieScore).toBeGreaterThan(veteranScore)
  })

  it('normal preset ligger mellom mild og strict', () => {
    const normalConfig = withPreset('normal')
    const context = createFairnessContext({ veteran: 2, rookie: 0 })
    const veteranScore = computeFinalScore(veteran, 'stand-up', normalConfig, availableSet, context)
    const rookieScore = computeFinalScore(rookie, 'stand-up', normalConfig, availableSet, context)
    expect(rookieScore).toBeGreaterThan(veteranScore)
    expect(veteranScore).toBeGreaterThan(0)
  })
})

describe('tilgjengelighet og rollebonus', () => {
  it('tilgjengelig komiker får availability_bonus', () => {
    const artist = makeArtist('a1', { score: 7 })
    const unavailable = computeBaseScore(artist, 'stand-up', config, new Set())
    const available = computeBaseScore(artist, 'stand-up', config, new Set(['a1']))
    expect(available - unavailable).toBe(config.availability_bonus)
  })

  it('rolle-match gir ekstra poeng', () => {
    const matched = makeArtist('matched', { score: 7, roles: ['stand-up'] })
    const unmatched = makeArtist('unmatched', { score: 7, roles: ['open mic'] })
    const matchedScore = computeBaseScore(matched, 'stand-up', config, new Set())
    const unmatchedScore = computeBaseScore(unmatched, 'stand-up', config, new Set())
    expect(matchedScore - unmatchedScore).toBe(config.role_match_bonus)
  })
})

describe('simulateBooking — stor klubb (80 komikere)', () => {
  const roster = createRealisticClubRoster('large')

  it('sender ett tilbud per kjøring — kaskade fyller backup-budsjett over tid', () => {
    const requirements = [
      makeRequirement('su-1', 'stand-up', { quantity: 4, lineupPosition: 2 }),
    ]
    const singleRun = simulateBooking({
      artists: roster,
      requirements,
      config: { ...config, offers_per_slot: 3 },
    })
    expect(singleRun.assignments).toHaveLength(1)

    const cascade = simulateBookingCascade({
      artists: roster,
      requirements,
      config: { ...config, offers_per_slot: 3 },
    }, 12)

    const assignments = cascade.flatMap(step => step.assignments)
    const standUpOffers = assignments.filter(a => a.requirementId === 'su-1')
    expect(standUpOffers.length).toBe(12)
    expect(new Set(assignments.map(a => a.artistId)).size).toBe(12)
  })

  it('prioriterer konferansier og headliner før open mic ved dekning', () => {
    const requirements = [
      makeRequirement('om-1', 'open mic', { quantity: 2, lineupPosition: 4 }),
      makeRequirement('mc-1', 'konferansier', { quantity: 1, lineupPosition: 0 }),
      makeRequirement('hl-1', 'headliner', { quantity: 1, lineupPosition: 1 }),
      makeRequirement('su-1', 'stand-up', { quantity: 3, lineupPosition: 2 }),
    ]

    const { assignments } = simulateBooking({
      artists: roster,
      requirements,
      config: { ...config, offers_per_slot: 1 },
    })

    const firstAssignments = assignments.slice(0, 3)
    const rolesFilled = firstAssignments.map(a => a.roleName)
    expect(rolesFilled).toContain('konferansier')
    expect(rolesFilled).toContain('headliner')
  })

  it('respekterer fairness — ofte booket komiker rangerer lavere', () => {
    const standUpArtists = roster.filter(a => a.category?.includes('stand-up'))
    const frequentlyBooked = standUpArtists.find(a => (a.admin_score ?? 0) >= 8)!

    const bookingCounts: Record<string, number> = {}
    for (const a of roster) bookingCounts[a.id] = 0
    bookingCounts[frequentlyBooked.id] = 5

    const { assignments } = simulateBooking({
      artists: roster,
      requirements: [makeRequirement('su-1', 'stand-up', { quantity: 1 })],
      config: { ...config, offers_per_slot: 5 },
      fairnessContext: createFairnessContext(bookingCounts),
    })

    expect(assignments).toHaveLength(1)
    const topOffer = assignments[0]
    expect(topOffer.artistId).not.toBe(frequentlyBooked.id)

    const topArtistBookings = bookingCounts[topOffer.artistId] ?? 0
    expect(topArtistBookings).toBeLessThan(bookingCounts[frequentlyBooked.id])
  })

  it('straffer komiker som var på forrige show', () => {
    const standUpArtists = roster.filter(a => a.category?.includes('stand-up') && (a.admin_score ?? 0) >= 7)
    const previousArtist = standUpArtists[0]
    const freshArtist = standUpArtists.find(a => a.id !== previousArtist.id && (a.admin_score ?? 0) === (previousArtist.admin_score ?? 0))

    if (!freshArtist) return

    const { assignments } = simulateBooking({
      artists: [previousArtist, freshArtist],
      requirements: [makeRequirement('su-1', 'stand-up', { quantity: 1 })],
      config: { ...config, offers_per_slot: 1 },
      fairnessContext: createFairnessContext({}, [previousArtist.id]),
    })

    expect(assignments[0].artistId).toBe(freshArtist.id)
  })
})

describe('simulateBooking — liten klubb (8 komikere)', () => {
  it('bruker fallback når strict-kandidater er oppbrukt', () => {
    const narrowPool = [
      makeArtist('s1', { score: 10, roles: ['stand-up'] }),
      makeArtist('s2', { score: 9, roles: ['stand-up'] }),
      makeArtist('s3', { score: 5, roles: ['stand-up'] }),
      makeArtist('s4', { score: 4, roles: ['stand-up'] }),
    ]
    const requirements = [
      makeRequirement('su-1', 'stand-up', { quantity: 2, minScore: 6 }),
    ]

    const strictCount = narrowPool.filter(
      a => strictFilter(a, requirements[0], new Set(), config),
    ).length
    expect(strictCount).toBe(2)

    const cascade = simulateBookingCascade({
      artists: narrowPool,
      requirements,
      config: { ...config, offers_per_slot: 2, fallback_limit: 3 },
    }, 4)
    const assignments = cascade.flatMap(step => step.assignments)

    expect(assignments.length).toBeGreaterThan(strictCount)
    const usedFallback = assignments.some(a => (narrowPool.find(r => r.id === a.artistId)?.admin_score ?? 0) < 6)
    expect(usedFallback).toBe(true)
  })

  it('får ikke nok tilbud når poolen er for liten', () => {
    const twoArtists = [
      makeArtist('a1', { score: 8, roles: ['stand-up'] }),
      makeArtist('a2', { score: 7, roles: ['stand-up'] }),
    ]

    const cascade = simulateBookingCascade({
      artists: twoArtists,
      requirements: [makeRequirement('su-1', 'stand-up', { quantity: 5 })],
      config: { ...config, offers_per_slot: 2 },
    }, 5)
    const assignments = cascade.flatMap(step => step.assignments)

    expect(assignments.length).toBe(2)
  })

  it('håndterer kvinnelig krav med få kvinner i poolen', () => {
    const mixed = [
      makeArtist('f1', { score: 8, gender: 'female', roles: ['stand-up'] }),
      makeArtist('m1', { score: 10, gender: 'male', roles: ['stand-up'] }),
      makeArtist('m2', { score: 9, gender: 'male', roles: ['stand-up'] }),
    ]

    const { assignments } = simulateBooking({
      artists: mixed,
      requirements: [makeRequirement('su-f', 'stand-up', { quantity: 2, gender: 'female' })],
      config: { ...config, offers_per_slot: 2 },
    })

    expect(assignments).toHaveLength(1)
    expect(assignments[0].artistId).toBe('f1')
  })
})

describe('simulateBooking — fullt show-oppsett', () => {
  it('booker realistisk kveld: MC + headliner + 4 stand-up + 2 open mic', () => {
    const roster = createRealisticClubRoster('medium')
    const requirements = [
      makeRequirement('mc', 'konferansier', { quantity: 1, lineupPosition: 0 }),
      makeRequirement('hl', 'headliner', { quantity: 1, minScore: 8, lineupPosition: 1 }),
      makeRequirement('su1', 'stand-up', { quantity: 2, lineupPosition: 2 }),
      makeRequirement('su2', 'stand-up', { quantity: 2, lineupPosition: 3 }),
      makeRequirement('om', 'open mic', { quantity: 2, lineupPosition: 4 }),
    ]

    const { assignments, offersByRequirement } = simulateBooking({
      artists: roster,
      requirements,
      config: { ...config, offers_per_slot: 2 },
    })

    for (const reqId of ['mc', 'hl', 'su1', 'su2', 'om']) {
      expect(offersByRequirement.get(reqId)?.length).toBeGreaterThan(0)
    }

    const artistIds = assignments.map(a => a.artistId)
    expect(new Set(artistIds).size).toBe(artistIds.length)

    for (const assignment of assignments) {
      const artist = roster.find(a => a.id === assignment.artistId)!
      expect(matchesHardRequirements(artist, requirements.find(r => r.id === assignment.requirementId)!)).toBe(true)
    }
  })

  it('hopper over manuelle krav', () => {
    const artists = [
      makeArtist('a1', { roles: ['stand-up'] }),
      makeArtist('a2', { roles: ['stand-up'] }),
    ]

    const { assignments } = simulateBooking({
      artists,
      requirements: [
        makeRequirement('manual', 'stand-up', { quantity: 1, bookingMode: 'manual' }),
        makeRequirement('auto', 'stand-up', { quantity: 1 }),
      ],
      config: { ...config, offers_per_slot: 1 },
    })

    expect(assignments.every(a => a.requirementId === 'auto')).toBe(true)
  })

  it('ekskluderer allerede involverte komikere', () => {
    const artists = createRealisticClubRoster('medium')
    const alreadyBooked = artists[0].id

    const { assignments } = simulateBooking({
      artists,
      requirements: [makeRequirement('su', 'stand-up', { quantity: 3 })],
      config: { ...config, offers_per_slot: 2 },
      alreadyInvolved: [alreadyBooked],
    })

    expect(assignments.every(a => a.artistId !== alreadyBooked)).toBe(true)
  })
})

describe('simulateBooking — ulike konfigurasjonsparametere', () => {
  const artists = Array.from({ length: 20 }, (_, i) =>
    makeArtist(`a${i}`, { score: 5 + (i % 6), roles: ['stand-up'] }),
  )

  it('offers_per_slot styrer antall tilbud per plass over kaskade', () => {
    const req = [makeRequirement('su', 'stand-up', { quantity: 2 })]
    const low = simulateBookingCascade({
      artists,
      requirements: req,
      config: { ...config, offers_per_slot: 2 },
    }, 10)
    const high = simulateBookingCascade({
      artists,
      requirements: req,
      config: { ...config, offers_per_slot: 5 },
    }, 20)

    expect(low.flatMap(r => r.assignments)).toHaveLength(4)
    expect(high.flatMap(r => r.assignments)).toHaveLength(10)
  })

  it('høy min_bookable_score filtrerer bort svake komikere', () => {
    const strictConfig = { ...config, min_bookable_score: 9, offers_per_slot: 3 }
    const { assignments } = simulateBooking({
      artists,
      requirements: [makeRequirement('su', 'stand-up', { quantity: 2 })],
      config: strictConfig,
    })

    for (const a of assignments) {
      const artist = artists.find(x => x.id === a.artistId)!
      expect(artist.admin_score).toBeGreaterThanOrEqual(9)
    }
  })

  it('høy quality_weight forsterker forskjell mellom topp og bunn', () => {
    const highQuality = withPreset('normal', { quality_weight: 200, offers_per_slot: 1 })
    const lowQuality = withPreset('normal', { quality_weight: 50, offers_per_slot: 1 })

    const top = makeArtist('top', { score: 10, roles: ['stand-up'] })
    const mid = makeArtist('mid', { score: 6, roles: ['stand-up'] })

    const highResult = simulateBooking({
      artists: [top, mid],
      requirements: [makeRequirement('su', 'stand-up', { quantity: 1 })],
      config: highQuality,
    })
    const lowResult = simulateBooking({
      artists: [top, mid],
      requirements: [makeRequirement('su', 'stand-up', { quantity: 1 })],
      config: lowQuality,
    })

    expect(highResult.assignments[0].artistId).toBe('top')
    expect(lowResult.assignments[0].artistId).toBe('top')
    expect(highResult.assignments[0].finalScore).toBeGreaterThan(lowResult.assignments[0].finalScore)
  })

  it('fallback_limit begrenser antall relaxed-tilbud', () => {
    const weakPool = [
      makeArtist('w1', { score: 4, roles: ['stand-up'] }),
      makeArtist('w2', { score: 4, roles: ['stand-up'] }),
      makeArtist('w3', { score: 4, roles: ['stand-up'] }),
    ]

    const { assignments } = simulateBooking({
      artists: weakPool,
      requirements: [makeRequirement('su', 'stand-up', { quantity: 3, minScore: 8 })],
      config: { ...config, offers_per_slot: 3, fallback_limit: 1 },
    })

    expect(assignments.length).toBeLessThanOrEqual(1)
  })
})

describe('simulateBooking — kaskade', () => {
  it('liten pool sender kun ett tilbud til høyest score', () => {
    const artists = [
      makeArtist('top', { score: 10, roles: ['stand-up'] }),
      makeArtist('mid', { score: 8, roles: ['stand-up'] }),
      makeArtist('low', { score: 5, roles: ['stand-up'] }),
      makeArtist('a4', { score: 7, roles: ['stand-up'] }),
      makeArtist('a5', { score: 6, roles: ['stand-up'] }),
    ]

    const { assignments } = simulateBooking({
      artists,
      requirements: [makeRequirement('su', 'stand-up', { quantity: 1 })],
      config: { ...config, offers_per_slot: 10 },
    })

    expect(assignments).toHaveLength(1)
    expect(assignments[0].artistId).toBe('top')
  })

  it('blokkerer nytt tilbud når aktivt sent-tilbud finnes', () => {
    const artists = [
      makeArtist('a1', { score: 10, roles: ['stand-up'] }),
      makeArtist('a2', { score: 9, roles: ['stand-up'] }),
    ]

    const blocked = simulateBooking({
      artists,
      requirements: [makeRequirement('su', 'stand-up', { quantity: 1 })],
      config: { ...config, offers_per_slot: 5, offers_per_wave: 1 },
      pendingOffersByRequirement: { su: 1 },
    })

    expect(blocked.assignments).toHaveLength(0)
  })

  it('kaskade sender neste kandidat etter simulert avslag', () => {
    const artists = [
      makeArtist('a1', { score: 10, roles: ['stand-up'] }),
      makeArtist('a2', { score: 9, roles: ['stand-up'] }),
      makeArtist('a3', { score: 8, roles: ['stand-up'] }),
    ]

    const steps = simulateBookingCascade({
      artists,
      requirements: [makeRequirement('su', 'stand-up', { quantity: 1 })],
      config: { ...config, offers_per_slot: 5 },
    }, 3)

    const ids = steps.flatMap(s => s.assignments.map(a => a.artistId))
    expect(ids).toEqual(['a1', 'a2', 'a3'])
  })

  it('komiker med kansellert tilbud på én spot kan tilbys en annen spot', () => {
    const artists = [
      makeArtist('a1', { score: 10, roles: ['stand-up', 'open mic'] }),
      makeArtist('a2', { score: 9, roles: ['stand-up'] }),
      makeArtist('a3', { score: 8, roles: ['open mic'] }),
    ]

    const requirements = [
      makeRequirement('su', 'stand-up', { quantity: 1 }),
      makeRequirement('om', 'open mic', { quantity: 1, lineupPosition: 1 }),
    ]

    const involved = buildShowBookingInvolvedSet({
      offers: [{ artist_id: 'a1', status: 'cancelled' }],
      confirmedSpotArtistIds: [],
    })

    const { assignments } = simulateBooking({
      artists,
      requirements: [requirements[1]],
      config: { ...config, offers_per_slot: 2, offers_per_wave: 1 },
      alreadyInvolved: [...involved],
    })

    expect(assignments).toHaveLength(1)
    expect(assignments[0].artistId).toBe('a1')
  })

  it('respekterer offers_per_slot som totalt budsjett over kaskade', () => {
    const artists = Array.from({ length: 10 }, (_, i) =>
      makeArtist(`a${i}`, { score: 10 - i, roles: ['stand-up'] }),
    )

    const steps = simulateBookingCascade({
      artists,
      requirements: [makeRequirement('su', 'stand-up', { quantity: 1 })],
      config: { ...config, offers_per_slot: 3 },
    }, 10)

    expect(steps.flatMap(s => s.assignments)).toHaveLength(3)
  })
})

describe('fairness over flere booking-nivåer', () => {
  it('reduserer score gradvis for 0, 1, 2 og 3 bookinger', () => {
    const artist = makeArtist('a1', { score: 8, roles: ['stand-up'] })
    const availableSet = new Set<string>()
    const scores: number[] = []

    for (let bookings = 0; bookings <= 3; bookings++) {
      const context = createFairnessContext({ a1: bookings })
      scores.push(computeFinalScore(artist, 'stand-up', config, availableSet, context))
    }

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThan(scores[i - 1])
    }
  })

  it('4+ bookinger deler samme laveste fairness-multiplikator', () => {
    const artist = makeArtist('a1', { score: 8, roles: ['stand-up'] })
    const availableSet = new Set<string>()
    const four = computeFinalScore(artist, 'stand-up', config, availableSet, createFairnessContext({ a1: 4 }))
    const ten = computeFinalScore(artist, 'stand-up', config, availableSet, createFairnessContext({ a1: 10 }))
    expect(four).toBe(ten)
    expect(four).toBeLessThan(
      computeFinalScore(artist, 'stand-up', config, availableSet, createFairnessContext({ a1: 3 })),
    )
  })

  it('simulert sesong roterer komikere over tid', () => {
    const roster = createRealisticClubRoster('medium').filter(a => a.category?.includes('stand-up'))
    const bookingCounts: Record<string, number> = {}
    for (const a of roster) bookingCounts[a.id] = 0

    const winnersPerRound: string[] = []

    for (let show = 0; show < 8; show++) {
      const { assignments } = simulateBooking({
        artists: roster,
        requirements: [makeRequirement('su', 'stand-up', { quantity: 1 })],
        config: { ...config, offers_per_slot: 1 },
        fairnessContext: createFairnessContext({ ...bookingCounts }),
      })

      const winner = assignments[0]?.artistId
      if (!winner) break
      winnersPerRound.push(winner)
      bookingCounts[winner] = (bookingCounts[winner] ?? 0) + 1
    }

    expect(new Set(winnersPerRound).size).toBeGreaterThan(1)
    expect(winnersPerRound.length).toBeGreaterThanOrEqual(4)
  })
})

describe('edge cases og grenseverdier', () => {
  it('tom artistliste gir ingen tilbud', () => {
    const result = simulateBooking({
      artists: [],
      requirements: [makeRequirement('su', 'stand-up', { quantity: 2 })],
    })
    expect(result.assignments).toHaveLength(0)
  })

  it('ingen auto-krav gir ingen tilbud', () => {
    const result = simulateBooking({
      artists: [makeArtist('a1')],
      requirements: [makeRequirement('su', 'stand-up', { quantity: 1, bookingMode: 'manual' })],
    })
    expect(result.assignments).toHaveLength(0)
  })

  it('alle flagget bort via alreadyInvolved', () => {
    const artists = createRealisticClubRoster('small')
    const result = simulateBooking({
      artists,
      requirements: [makeRequirement('su', 'stand-up', { quantity: 2 })],
      alreadyInvolved: artists.map(a => a.id),
    })
    expect(result.assignments).toHaveLength(0)
  })

  it('kombinert kjønn + energi + min score', () => {
    const artists: ScoringArtist[] = [
      makeArtist('perfect', { score: 8, gender: 'female', energy: 'experienced', roles: ['stand-up'] }),
      makeArtist('wrong-gender', { score: 10, gender: 'male', energy: 'experienced', roles: ['stand-up'] }),
      makeArtist('wrong-energy', { score: 10, gender: 'female', energy: 'newcomer', roles: ['stand-up'] }),
      makeArtist('low-score', { score: 5, gender: 'female', energy: 'experienced', roles: ['stand-up'] }),
    ]

    const requirement = makeRequirement('su', 'stand-up', {
      minScore: 7,
      gender: 'female',
      energy: 'experienced',
    })

    const { assignments } = simulateBooking({
      artists,
      requirements: [requirement],
      config: { ...config, offers_per_slot: 1, fallback_limit: 0 },
    })

    expect(assignments.map(a => a.artistId)).toEqual(['perfect'])
  })

  it('tilgjengelighet avgjør når score og fairness er lik', () => {
    const a = makeArtist('avail', { score: 7, roles: ['stand-up'] })
    const b = makeArtist('busy', { score: 7, roles: ['stand-up'] })

    const { assignments } = simulateBooking({
      artists: [a, b],
      requirements: [makeRequirement('su', 'stand-up', { quantity: 1 })],
      config: { ...config, offers_per_slot: 1 },
      availableArtistIds: ['avail'],
    })

    expect(assignments[0].artistId).toBe('avail')
  })
})

describe('parseClubBookingSettingsRow og presets', () => {
  it('parser database-rad med manglende felter', () => {
    const parsed = parseClubBookingSettingsRow({
      club_id: 'club-1',
      fairness_window_months: 6,
      offers_per_slot: 15,
    })
    expect(parsed.club_id).toBe('club-1')
    expect(parsed.fairness_window_months).toBe(6)
    expect(parsed.offers_per_slot).toBe(15)
    expect(parsed.min_bookable_score).toBe(DEFAULT_CLUB_BOOKING_SETTINGS.min_bookable_score)
  })

  it('returnerer defaults for null-rad', () => {
    const parsed = parseClubBookingSettingsRow(null)
    expect(parsed).toEqual(DEFAULT_CLUB_BOOKING_SETTINGS)
  })

  it('detekterer alle fairness-presets', () => {
    for (const id of ['mild', 'normal', 'strict'] as const) {
      const settings = {
        ...DEFAULT_CLUB_BOOKING_SETTINGS,
        ...FAIRNESS_PRESETS[id],
      }
      expect(detectFairnessPreset(settings)).toBe(id)
    }
  })
})

describe('getEffectiveMinScore i praksis', () => {
  it('krav-minimum over config-gulv', () => {
    expect(getEffectiveMinScore(req({ min_score: 9 }), config)).toBe(9)
    expect(getEffectiveMinScore(req({ min_score: 4 }), config)).toBe(6)
  })
})
