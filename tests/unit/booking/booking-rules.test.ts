import { describe, expect, it } from 'vitest'
import {
  compareCandidates,
  candidatePoints,
  hasScheduleConflict,
  matchesHardRequirements,
  offerQuota,
  orderByScarcity,
  pendingOffersToWithdraw,
  rankCandidates,
  requirementBlocker,
  type ExistingOffer,
  type HardRequirement,
  type MatchableArtist,
  type RankedCandidate,
} from '@/lib/booking-rules'
import { DEFAULT_BOOKING_SETTINGS } from '@/lib/booking-settings'

const settings = DEFAULT_BOOKING_SETTINGS

const standUpSpot: HardRequirement = { role_name: 'Stand-up', energy_level: 'low', required_gender: 'man' }
const hostSpot: HardRequirement = { role_name: 'Host', energy_level: 'any', required_gender: 'any' }

const lowEnergyStandUp: MatchableArtist = { category: ['stand-up'], admin_energy_level: 'low', gender: 'man' }
const unratedStandUp: MatchableArtist = { category: ['stand-up', 'open mic'], admin_energy_level: null, gender: 'man' }

function offer(overrides: Partial<ExistingOffer> = {}): ExistingOffer {
  return {
    id: 'offer-1',
    artist_id: 'artist-1',
    show_requirement_id: 'spot-standup',
    status: 'sent',
    source: 'auto',
    ...overrides,
  }
}

function withdraw(offers: ExistingOffer[], options: {
  artists?: Record<string, MatchableArtist>
  excluded?: string[]
} = {}) {
  return pendingOffersToWithdraw({
    offers,
    bookableArtists: new Map(Object.entries(options.artists ?? { 'artist-1': unratedStandUp })),
    requirements: new Map([['spot-standup', standUpSpot], ['spot-host', hostSpot]]),
    excludedArtistIds: new Set(options.excluded ?? []),
  })
}

function candidate(overrides: Partial<RankedCandidate> = {}): RankedCandidate {
  return { id: 'a', score: 5, clubBookingsInWindow: 0, lastClubBookingDate: null, ...overrides }
}

describe('hard requirements', () => {
  it('matches role, energy and gender', () => {
    expect(matchesHardRequirements(lowEnergyStandUp, standUpSpot)).toBe(true)
  })

  it('rejects a comedian the club has not given the role', () => {
    expect(matchesHardRequirements(lowEnergyStandUp, hostSpot)).toBe(false)
  })

  it('rejects a comedian without an energy rating on a spot that asks for one', () => {
    expect(matchesHardRequirements(unratedStandUp, standUpSpot)).toBe(false)
    expect(matchesHardRequirements(unratedStandUp, { ...standUpSpot, energy_level: 'any' })).toBe(true)
  })

  it('only lets prefer_not_to_say match a spot open to any gender', () => {
    const artist: MatchableArtist = { ...lowEnergyStandUp, gender: 'prefer_not_to_say' }
    expect(matchesHardRequirements(artist, standUpSpot)).toBe(false)
    expect(matchesHardRequirements(artist, { ...standUpSpot, required_gender: 'any' })).toBe(true)
  })

  it('names the requirement that blocks, so the alert can say what to relax', () => {
    expect(requirementBlocker(lowEnergyStandUp, hostSpot)).toBe('role')
    expect(requirementBlocker(unratedStandUp, standUpSpot)).toBe('energy')
    expect(requirementBlocker({ ...lowEnergyStandUp, gender: 'woman' }, standUpSpot)).toBe('gender')
    expect(requirementBlocker(lowEnergyStandUp, standUpSpot)).toBeNull()
  })

  it('reports the role first, because that is the one the booker cannot relax', () => {
    const wrongEverything: MatchableArtist = { category: ['headliner'], admin_energy_level: 'high', gender: 'woman' }
    expect(requirementBlocker(wrongEverything, standUpSpot)).toBe('role')
  })
})

describe('two shows the same evening', () => {
  const tonight = { showId: 'show-1', date: '2026-03-13', conflictWindowHours: 3 }

  it('lets a comedian do two spots the same night when they are far enough apart', () => {
    expect(hasScheduleConflict({
      ...tonight,
      startTime: '19:00',
      bookings: [{ show_id: 'show-2', date: '2026-03-13', start_time: '22:30' }],
    })).toBe(false)
  })

  it('blocks two shows that start within the window', () => {
    expect(hasScheduleConflict({
      ...tonight,
      startTime: '19:00',
      bookings: [{ show_id: 'show-2', date: '2026-03-13', start_time: '21:00' }],
    })).toBe(true)
  })

  it('treats a missing start time as the whole day', () => {
    expect(hasScheduleConflict({
      ...tonight,
      startTime: null,
      bookings: [{ show_id: 'show-2', date: '2026-03-13', start_time: '23:00' }],
    })).toBe(true)

    expect(hasScheduleConflict({
      ...tonight,
      startTime: '19:00',
      bookings: [{ show_id: 'show-2', date: '2026-03-13', start_time: null }],
    })).toBe(true)
  })

  it('ignores other dates and the show itself', () => {
    expect(hasScheduleConflict({
      ...tonight,
      startTime: '19:00',
      bookings: [
        { show_id: 'show-1', date: '2026-03-13', start_time: '19:00' },
        { show_id: 'show-3', date: '2026-03-14', start_time: '19:00' },
      ],
    })).toBe(false)
  })

  it('follows the configured window', () => {
    const bookings = [{ show_id: 'show-2', date: '2026-03-13', start_time: '23:00' }]
    expect(hasScheduleConflict({ ...tonight, startTime: '19:00', bookings, conflictWindowHours: 3 })).toBe(false)
    expect(hasScheduleConflict({ ...tonight, startTime: '19:00', bookings, conflictWindowHours: 6 })).toBe(true)
  })
})

describe('the queue', () => {
  it('gives ten points per score point', () => {
    expect(candidatePoints(candidate({ score: 7 }), settings)).toBe(70)
  })

  it('takes one score point off per booking in the same club', () => {
    expect(candidatePoints(candidate({ score: 8, clubBookingsInWindow: 2 }), settings)).toBe(60)
  })

  it('puts the higher score first', () => {
    const ranked = rankCandidates([
      candidate({ id: 'low', score: 4 }),
      candidate({ id: 'high', score: 9 }),
    ], settings)
    expect(ranked.map((row) => row.id)).toEqual(['high', 'low'])
  })

  it('lets rotation beat a slightly better score', () => {
    const busy = candidate({ id: 'busy', score: 9, clubBookingsInWindow: 2 })
    const fresh = candidate({ id: 'fresh', score: 8 })
    expect(rankCandidates([busy, fresh], settings).map((row) => row.id)).toEqual(['fresh', 'busy'])
  })

  it('breaks a tie on who has waited longest, and never on database order', () => {
    const ranked = rankCandidates([
      candidate({ id: 'recent', lastClubBookingDate: '2026-03-01' }),
      candidate({ id: 'never', lastClubBookingDate: null }),
      candidate({ id: 'long-ago', lastClubBookingDate: '2025-09-01' }),
    ], settings)

    expect(ranked.map((row) => row.id)).toEqual(['never', 'long-ago', 'recent'])
  })

  // Poengene er flyttall. 2,9 × 10 gir 28.999999999999996, mens 3,9 × 10
  // minus ett rotasjonstrekk gir nøyaktig 29. Uten en terskel vant den
  // travleste med 3,5e-15, og rotasjonen ble aldri tatt hensyn til.
  it('treats a floating-point hair’s breadth as a tie', () => {
    const fresh = candidate({ id: 'fresh', score: 2.9, lastClubBookingDate: null })
    const busy = candidate({ id: 'busy', score: 3.9, clubBookingsInWindow: 1, lastClubBookingDate: '2026-03-01' })

    expect(candidatePoints(fresh, settings)).not.toBe(candidatePoints(busy, settings))
    expect(rankCandidates([busy, fresh], settings).map((row) => row.id)).toEqual(['fresh', 'busy'])
  })

  it('falls back to the id, so the same run always gives the same lineup', () => {
    expect(compareCandidates(candidate({ id: 'a' }), candidate({ id: 'b' }), settings)).toBeLessThan(0)
    expect(compareCandidates(candidate({ id: 'b' }), candidate({ id: 'a' }), settings)).toBeGreaterThan(0)
    expect(compareCandidates(candidate({ id: 'a' }), candidate({ id: 'a' }), settings)).toBe(0)
  })
})

describe('pending offers the engine withdraws', () => {
  it('withdraws an engine offer when the comedian no longer matches the spot', () => {
    expect(withdraw([offer({ source: 'auto' })])).toEqual(['offer-1'])
  })

  it('keeps an engine offer that still matches', () => {
    expect(withdraw([offer({ source: 'auto' })], { artists: { 'artist-1': lowEnergyStandUp } })).toEqual([])
  })

  it('keeps an offer the booker sent to a comedian who does not match the spot', () => {
    // Samme situasjon som i produksjon 17. september: manuelt tilbud på en
    // Stand-up-plass med lav energi, til en komiker klubben ikke har gitt
    // energinivå. Før rettelsen ble det trukket neste gang motoren kjørte.
    expect(withdraw([offer({ source: 'manual' })])).toEqual([])
    expect(withdraw([offer({ source: 'manual', show_requirement_id: 'spot-host' })])).toEqual([])
  })

  it('still withdraws a manual offer when the comedian is excluded from the show', () => {
    expect(withdraw([offer({ source: 'manual' })], { excluded: ['artist-1'] })).toEqual(['offer-1'])
  })

  it('still withdraws a manual offer when the club can no longer book the comedian', () => {
    // Ikke i `bookableArtists`: fjernet fra listen, flagget eller ikke godkjent.
    expect(withdraw([offer({ source: 'manual' })], { artists: {} })).toEqual(['offer-1'])
  })

  it('withdraws an offer whose spot is gone', () => {
    expect(withdraw([offer({ source: 'manual', show_requirement_id: 'spot-deleted' })])).toEqual(['offer-1'])
  })

  it('ignores offers that are already answered or have no spot', () => {
    expect(withdraw([
      offer({ id: 'accepted', status: 'accepted' }),
      offer({ id: 'declined', status: 'declined' }),
      offer({ id: 'expired', status: 'expired' }),
      offer({ id: 'no-spot', show_requirement_id: null }),
    ])).toEqual([])
  })
})

describe('offer quota per spot', () => {
  it('fills an open seat up to the wave target', () => {
    expect(offerQuota({ quantity: 1, filled: 0, pendingAuto: 0, pendingManual: 0, target: 2 }))
      .toEqual({ slotsNeeded: 1, currentPendingOffers: 0, maxNewOffers: 2 })
  })

  it('only tops up to the target, however often it runs', () => {
    expect(offerQuota({ quantity: 1, filled: 0, pendingAuto: 2, pendingManual: 0, target: 2 }))
      .toEqual({ slotsNeeded: 1, currentPendingOffers: 2, maxNewOffers: 0 })

    expect(offerQuota({ quantity: 1, filled: 0, pendingAuto: 2, pendingManual: 0, target: 4 }))
      .toEqual({ slotsNeeded: 1, currentPendingOffers: 2, maxNewOffers: 2 })
  })

  it('sends nothing on a filled spot', () => {
    expect(offerQuota({ quantity: 1, filled: 1, pendingAuto: 0, pendingManual: 0, target: 10 }))
      .toEqual({ slotsNeeded: 0, currentPendingOffers: 0, maxNewOffers: 0 })
  })

  it('leaves a seat alone while the booker’s own offer waits for a reply', () => {
    expect(offerQuota({ quantity: 1, filled: 0, pendingAuto: 0, pendingManual: 1, target: 10 }))
      .toEqual({ slotsNeeded: 0, currentPendingOffers: 0, maxNewOffers: 0 })
  })

  it('keeps working the other seats on a spot with several', () => {
    expect(offerQuota({ quantity: 3, filled: 1, pendingAuto: 4, pendingManual: 1, target: 10 }))
      .toEqual({ slotsNeeded: 1, currentPendingOffers: 4, maxNewOffers: 6 })
  })

  it('never goes negative when there are more offers than the target', () => {
    expect(offerQuota({ quantity: 1, filled: 0, pendingAuto: 12, pendingManual: 3, target: 10 }))
      .toEqual({ slotsNeeded: 0, currentPendingOffers: 12, maxNewOffers: 0 })
  })

  it('sends nothing when the wave has not started', () => {
    expect(offerQuota({ quantity: 1, filled: 0, pendingAuto: 0, pendingManual: 0, target: 0 }))
      .toEqual({ slotsNeeded: 1, currentPendingOffers: 0, maxNewOffers: 0 })
  })
})

describe('which spot picks first', () => {
  const spot = (requirementId: string, candidateCount: number, lineupPosition: number) =>
    ({ requirementId, candidateCount, lineupPosition })

  it('lets the spot with fewest candidates pick first', () => {
    // Host har tre kandidater, Headliner åtte. Før tok Headliner dem først,
    // fordi rollerekkefølgen var fast.
    const ordered = orderByScarcity([spot('headliner', 8, 1), spot('host', 3, 2)])
    expect(ordered.map((entry) => entry.requirementId)).toEqual(['host', 'headliner'])
  })

  it('puts spots with no candidates last — they have nothing to take anyway', () => {
    const ordered = orderByScarcity([spot('empty', 0, 1), spot('few', 2, 2), spot('many', 9, 3)])
    expect(ordered.map((entry) => entry.requirementId)).toEqual(['few', 'many', 'empty'])
  })

  it('uses the lineup position when two spots are equally scarce', () => {
    const ordered = orderByScarcity([spot('second', 4, 5), spot('first', 4, 2)])
    expect(ordered.map((entry) => entry.requirementId)).toEqual(['first', 'second'])
  })
})
