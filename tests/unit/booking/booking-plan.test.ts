import { describe, expect, it } from 'vitest'
import {
  planOfferWave,
  waveEntries,
  type PlanCandidate,
  type WaveEntry,
  type WaveRequirement,
} from '@/lib/booking-rules'
import { DEFAULT_BOOKING_SETTINGS } from '@/lib/booking-settings'

const settings = DEFAULT_BOOKING_SETTINGS
const now = new Date('2026-10-20T08:00:00Z')

function comedian(id: string, overrides: Partial<PlanCandidate> = {}): PlanCandidate {
  return {
    id,
    category: ['stand-up'],
    admin_energy_level: 'high',
    gender: 'woman',
    score: 5,
    clubBookingsInWindow: 0,
    lastClubBookingDate: null,
    unavailable: false,
    conflicted: false,
    ...overrides,
  }
}

function spot(id: string, overrides: Partial<WaveRequirement> = {}): WaveRequirement {
  return {
    id,
    role_name: 'Stand-up',
    energy_level: 'any',
    required_gender: 'any',
    min_skill_level: null,
    quantity: 1,
    lineup_position: 1,
    submissions_open: false,
    auto_started_at: now.toISOString(),
    ...overrides,
  }
}

function entry(req: WaveRequirement, pool: PlanCandidate[], overrides: Partial<WaveEntry<WaveRequirement>> = {}) {
  return {
    req,
    requirementId: req.id,
    lineupPosition: req.lineup_position,
    slotsNeeded: req.quantity,
    currentPendingOffers: 0,
    maxNewOffers: 2 * req.quantity,
    candidateCount: pool.length,
    ...overrides,
  }
}

const picks = (assignments: Array<{ candidate: PlanCandidate; req: WaveRequirement }>) =>
  assignments.map(({ candidate, req }) => `${req.id}:${candidate.id}`)

describe('which spots get offers now', () => {
  const pool = [comedian('a'), comedian('b'), comedian('c')]
  const base = {
    pool,
    involved: new Set<string>(),
    filled: new Map<string, number>(),
    pendingAuto: new Map<string, number>(),
    pendingManual: new Map<string, number>(),
    now,
    settings,
    rush: false,
  }

  it('gives an open seat two offers on day one', () => {
    const [row] = waveEntries({ ...base, requirements: [spot('s1')] })
    expect(row).toMatchObject({ requirementId: 's1', slotsNeeded: 1, maxNewOffers: 2, candidateCount: 3 })
  })

  it('leaves spots open for submissions, spots not started and filled spots alone', () => {
    const rows = waveEntries({
      ...base,
      requirements: [
        spot('open', { submissions_open: true }),
        spot('not-started', { auto_started_at: null }),
        spot('filled'),
      ],
      filled: new Map([['filled', 1]]),
    })
    expect(rows).toEqual([])
  })

  it('counts only the candidates who meet the skill level', () => {
    const [row] = waveEntries({
      ...base,
      pool: [comedian('weak', { score: 2 }), comedian('ok', { score: 5 }), comedian('strong', { score: 9 })],
      requirements: [spot('s1', { min_skill_level: 'medium' })],
    })
    expect(row.candidateCount).toBe(2)
  })
})

describe('the wave', () => {
  it('ranks by points within a spot', () => {
    const pool = [comedian('low', { score: 4 }), comedian('top', { score: 9 }), comedian('mid', { score: 6 })]
    const req = spot('s1')
    const result = planOfferWave({ entries: [entry(req, pool)], pool, involved: new Set(), settings })
    expect(picks(result)).toEqual(['s1:top', 's1:mid'])
  })

  it('lets the scarcest spot pick first, so the only host is not spent on stand-up', () => {
    const allRounder = comedian('a', { category: ['konferansier', 'stand-up'], score: 9 })
    const pool = [allRounder, comedian('b', { score: 8 }), comedian('c', { score: 7 })]
    const host = spot('host', { role_name: 'Host', lineup_position: 2 })
    const standUp = spot('standup', { lineup_position: 1 })

    const result = planOfferWave({
      entries: [entry(standUp, pool, { candidateCount: 3 }), entry(host, pool, { candidateCount: 1 })],
      pool,
      involved: new Set(),
      settings,
    })

    expect(picks(result)).toEqual(['host:a', 'standup:b', 'standup:c'])
  })

  it('deals the offers out in rounds, so one spot does not empty the list', () => {
    const pool = ['a', 'b', 'c', 'd'].map((id, index) => comedian(id, { score: 9 - index }))
    const first = spot('first', { lineup_position: 1 })
    const second = spot('second', { lineup_position: 2 })

    const result = planOfferWave({
      entries: [entry(first, pool), entry(second, pool)],
      pool,
      involved: new Set(),
      settings,
    })

    expect(picks(result)).toEqual(['first:a', 'second:b', 'first:c', 'second:d'])
  })

  it('skips the involved, the unavailable, the double-booked and those below the skill level', () => {
    const pool = [
      comedian('involved', { score: 10 }),
      comedian('busy', { score: 10, unavailable: true }),
      comedian('elsewhere', { score: 10, conflicted: true }),
      comedian('weak', { score: 3 }),
      comedian('ok', { score: 5 }),
    ]
    const req = spot('s1', { min_skill_level: 'medium' })
    const result = planOfferWave({ entries: [entry(req, pool)], pool, involved: new Set(['involved']), settings })
    expect(picks(result)).toEqual(['s1:ok'])
  })

  it('sends nothing when no spot needs offers', () => {
    expect(planOfferWave({ entries: [], pool: [comedian('a')], involved: new Set(), settings })).toEqual([])
  })
})

describe('the booker’s approved suggestion', () => {
  const pool = ['a', 'b', 'c', 'd'].map((id, index) => comedian(id, { score: 9 - index }))
  const req = spot('s1')

  it('is exactly the normal wave when nothing is approved', () => {
    const plain = planOfferWave({ entries: [entry(req, pool)], pool, involved: new Set(), settings })
    const empty = planOfferWave({ entries: [entry(req, pool)], pool, involved: new Set(), settings, approved: {} })
    expect(picks(empty)).toEqual(picks(plain))
  })

  it('sends the comedians the booker picked, not the top of the queue', () => {
    const result = planOfferWave({
      entries: [entry(req, pool)],
      pool,
      involved: new Set(),
      settings,
      approved: { s1: ['d', 'c'] },
    })
    expect(picks(result)).toEqual(['s1:d', 's1:c'])
  })

  it('fills from the queue when an approved comedian can no longer take it', () => {
    const busyPool = pool.map((candidate) => candidate.id === 'd' ? { ...candidate, unavailable: true } : candidate)
    const result = planOfferWave({
      entries: [entry(req, busyPool)],
      pool: busyPool,
      involved: new Set(),
      settings,
      approved: { s1: ['d', 'c'] },
    })
    expect(picks(result)).toEqual(['s1:c', 's1:a'])
  })

  it('never sends more than the wave allows, and never the same comedian twice', () => {
    const other = spot('s2', { lineup_position: 2 })
    const result = planOfferWave({
      entries: [entry(req, pool), entry(other, pool)],
      pool,
      involved: new Set(),
      settings,
      approved: { s1: ['a', 'b', 'c'], s2: ['a', 'd'] },
    })
    expect(picks(result)).toEqual(['s1:a', 's1:b', 's2:d', 's2:c'])
  })
})
