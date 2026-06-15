import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CLUB_BOOKING_SETTINGS,
  FAIRNESS_PRESETS,
  computeBaseScore,
  computeFinalScore,
  detectFairnessPreset,
  fairnessCutoffDate,
  getCatchUpBoost,
  getConsecutiveMultiplier,
  getDominanceMultiplier,
  getFairnessMultiplier,
  getFairShareCap,
  getGlobalBookingCap,
  getEffectiveMinScore,
  getRoleExpansionOptions,
  getUnderbookedBoost,
  matchesRoleForDemand,
  selectExcessSentOfferIdsToCancel,
  strictFilter,
} from './booking-scoring'
import { createFairnessContext, makeArtist } from './booking-test-helpers'

const config = { ...DEFAULT_CLUB_BOOKING_SETTINGS }
const strictConfig = { ...DEFAULT_CLUB_BOOKING_SETTINGS, ...FAIRNESS_PRESETS.strict }

const artist = {
  id: 'artist-1',
  admin_score: 8,
  admin_energy_level: 'experienced',
  gender: 'male',
  category: ['stand-up'],
}

const requirement = {
  role_name: 'stand-up',
  min_score: 6,
  energy_level: 'any',
  required_gender: 'any',
}

describe('getFairnessMultiplier', () => {
  it('returns tier multipliers for booking counts', () => {
    expect(getFairnessMultiplier(0, config)).toBe(1)
    expect(getFairnessMultiplier(1, config)).toBe(0.7)
    expect(getFairnessMultiplier(2, config)).toBe(0.5)
    expect(getFairnessMultiplier(3, config)).toBe(0.3)
    expect(getFairnessMultiplier(4, config)).toBe(0.2)
    expect(getFairnessMultiplier(99, config)).toBe(0.2)
  })
})

describe('getConsecutiveMultiplier', () => {
  it('applies consecutive penalty when artist was on previous event', () => {
    const previous = new Set(['artist-1'])
    expect(getConsecutiveMultiplier('artist-1', previous, config)).toBe(0.1)
    expect(getConsecutiveMultiplier('artist-2', previous, config)).toBe(1)
  })
})

describe('computeFinalScore', () => {
  const availableSet = new Set<string>()
  const fairnessContext = {
    bookingCountByArtist: new Map([['artist-1', 2]]),
    totalClubEvents: 10,
    artistsOnPreviousEvent: new Set<string>(),
    windowMonths: 12,
  }

  it('multiplies base score by fairness and consecutive multipliers', () => {
    const base = computeBaseScore(artist, 'stand-up', config, availableSet)
    const expected = base * 0.5 * 1
    expect(computeFinalScore(artist, 'stand-up', config, availableSet, fairnessContext)).toBe(expected)
  })

  it('never returns zero when multipliers are above zero', () => {
    const heavyContext = {
      bookingCountByArtist: new Map([['artist-1', 10]]),
      totalClubEvents: 10,
      artistsOnPreviousEvent: new Set(['artist-1']),
      windowMonths: 12,
    }
    expect(computeFinalScore(artist, 'stand-up', config, availableSet, heavyContext)).toBeGreaterThan(0)
  })

  it('combines consecutive and fairness penalties', () => {
    const combinedContext = {
      bookingCountByArtist: new Map([['artist-1', 1]]),
      totalClubEvents: 5,
      artistsOnPreviousEvent: new Set(['artist-1']),
      windowMonths: 12,
    }
    const base = computeBaseScore(artist, 'stand-up', config, availableSet)
    expect(computeFinalScore(artist, 'stand-up', config, availableSet, combinedContext)).toBeCloseTo(base * 0.7 * 0.1)
  })
})

describe('fairnessCutoffDate', () => {
  it('subtracts months from show date', () => {
    expect(fairnessCutoffDate('2026-06-15', 12)).toBe('2025-06-15')
    expect(fairnessCutoffDate('2026-06-15', 6)).toBe('2025-12-15')
  })
})

describe('strictFilter', () => {
  it('respects min bookable score from config', () => {
    const lowScoreArtist = { ...artist, admin_score: 5 }
    expect(strictFilter(lowScoreArtist, requirement, new Set(), config)).toBe(false)
    expect(strictFilter(artist, requirement, new Set(), config)).toBe(true)
  })

  it('excludes already involved artists', () => {
    expect(strictFilter(artist, requirement, new Set(['artist-1']), config)).toBe(false)
  })
})

describe('detectFairnessPreset', () => {
  it('detects normal preset from defaults', () => {
    expect(detectFairnessPreset(DEFAULT_CLUB_BOOKING_SETTINGS)).toBe('normal')
  })

  it('detects strict preset', () => {
    expect(detectFairnessPreset(strictConfig)).toBe('strict')
  })
})

describe('getFairShareCap', () => {
  it('returns at least 1 and tightens cap when demand exceeds pool size', () => {
    expect(getFairShareCap(10, 22)).toBe(1)
    expect(getFairShareCap(50, 10)).toBe(1)
    expect(getFairShareCap(20, 22)).toBe(1)
  })
})

describe('getDominanceMultiplier', () => {
  it('returns 1 when below fair cap', () => {
    expect(getDominanceMultiplier(0, 10, 22, config)).toBe(1)
  })

  it('applies preset-scaled penalty at and above fair cap', () => {
    expect(getDominanceMultiplier(1, 10, 22, strictConfig)).toBeCloseTo(0.05)
    expect(getDominanceMultiplier(1, 10, 22, config)).toBeCloseTo(0.1)
    expect(getDominanceMultiplier(1, 10, 22, {
      ...config,
      ...FAIRNESS_PRESETS.mild,
    })).toBeCloseTo(0.4)
  })

  it('compounds penalty for each booking beyond cap', () => {
    expect(getDominanceMultiplier(3, 10, 22, strictConfig)).toBeCloseTo(0.05 ** 3)
  })
})

describe('getUnderbookedBoost', () => {
  it('boosts only unbooked artists when demand exceeds pool size', () => {
    expect(getUnderbookedBoost(0, 10, 22, strictConfig)).toBe(35)
    expect(getUnderbookedBoost(0, 10, 22, config)).toBe(24)
    expect(getUnderbookedBoost(1, 10, 22, config)).toBe(0)
    expect(getUnderbookedBoost(0, 30, 22, config)).toBe(0)
  })
})

describe('computeFinalScore with pool context', () => {
  const availableSet = new Set<string>()
  const fairnessContext = {
    bookingCountByArtist: new Map([['artist-1', 5]]),
    totalClubEvents: 22,
    artistsOnPreviousEvent: new Set<string>(),
    windowMonths: 12,
  }
  const poolContext = { eligiblePoolSize: 10 }

  it('applies dominance and underbooked boost when pool context is provided', () => {
    const unbooked = { ...artist, id: 'artist-2', admin_score: 6 }
    const base = computeBaseScore(unbooked, 'stand-up', config, availableSet)
    const withPool = computeFinalScore(unbooked, 'stand-up', config, availableSet, fairnessContext, poolContext)
    expect(withPool).toBeGreaterThan(base)

    const booked = { ...artist, id: 'artist-1' }
    const bookedBase = computeBaseScore(booked, 'stand-up', config, availableSet)
    const bookedWithPool = computeFinalScore(booked, 'stand-up', config, availableSet, fairnessContext, poolContext)
    expect(bookedWithPool).toBeLessThan(bookedBase * 0.5)
  })
})

describe('getGlobalBookingCap', () => {
  it('scales with club activity and roster size', () => {
    expect(getGlobalBookingCap(16, 60)).toBe(4)
    expect(getGlobalBookingCap(8, 60)).toBe(3)
  })
})

describe('getRoleExpansionOptions', () => {
  it('expands niche roles when demand exceeds dedicated pool size', () => {
    expect(getRoleExpansionOptions('open mic', 2, 4)).toEqual({ expandOpenMicPool: true })
    expect(getRoleExpansionOptions('headliner', 2, 2)).toEqual({ expandHeadlinerPool: true })
    expect(getRoleExpansionOptions('stand-up', 2, 20)).toEqual({})
  })
})

describe('matchesRoleForDemand', () => {
  it('allows stand-up comedians to cover open mic when pool is expanded', () => {
    const standUp = makeArtist('su', { score: 7, roles: ['stand-up'] })
    const req = {
      role_name: 'open mic',
      min_score: 6,
      energy_level: 'any',
      required_gender: 'any',
    }

    expect(matchesRoleForDemand(standUp, req, config, { expandOpenMicPool: true })).toBe(true)
    expect(matchesRoleForDemand(standUp, req, config)).toBe(false)
  })
})

describe('getCatchUpBoost', () => {
  it('boosts active comedians when imported booking history exists', () => {
    const ctx = createFairnessContext({ a: 4, b: 3, c: 2 })
    expect(getCatchUpBoost(2, ctx)).toBe(56)
    expect(getCatchUpBoost(3, ctx)).toBe(40)
    expect(getCatchUpBoost(0, ctx)).toBe(0)
  })
})

describe('getEffectiveMinScore', () => {
  it('uses the higher of requirement min and config floor', () => {
    expect(getEffectiveMinScore({ ...requirement, min_score: 8 }, config)).toBe(8)
    expect(getEffectiveMinScore({ ...requirement, min_score: null }, config)).toBe(6)
  })
})

describe('selectExcessSentOfferIdsToCancel', () => {
  it('keeps oldest sent offer per requirement and cancels the rest when keep = 1', () => {
    const ids = selectExcessSentOfferIdsToCancel([
      { id: 'a', show_requirement_id: 'req-1', sent_at: '2026-06-15T19:51:00Z' },
      { id: 'b', show_requirement_id: 'req-1', sent_at: '2026-06-15T19:52:00Z' },
      { id: 'c', show_requirement_id: 'req-1', sent_at: '2026-06-15T19:52:01Z' },
      { id: 'd', show_requirement_id: 'req-2', sent_at: '2026-06-15T19:52:00Z' },
    ], 1)

    expect(ids.sort()).toEqual(['b', 'c'])
  })
})
