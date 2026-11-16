import { describe, expect, it } from 'vitest'
import { spotOrder, unstartedSpots } from '@/lib/booking-rules'
import { mergeApplicantReviews } from '@/lib/booking-engine'
import { EMPTY_REVIEW } from '@/lib/club-artist-profile'
import { DEFAULT_BOOKING_SETTINGS } from '@/lib/booking-settings'

const candidate = (id: string, extra: { score?: number; applied?: boolean } = {}) => ({
  id,
  score: extra.score ?? 5,
  clubBookingsInWindow: 0,
  lastClubBookingDate: null,
  applied: extra.applied,
})

describe('applicants first in the suggestion', () => {
  it('puts applicants ahead of better-scored comedians from the roster', () => {
    const order = spotOrder([candidate('star', { score: 9 }), candidate('applicant', { applied: true }), candidate('mid', { score: 6 })], undefined, DEFAULT_BOOKING_SETTINGS)
    expect(order.map((row) => row.id)).toEqual(['applicant', 'star', 'mid'])
  })

  it('keeps the score order among the applicants themselves', () => {
    const order = spotOrder([candidate('a', { applied: true, score: 4 }), candidate('b', { applied: true, score: 8 })], undefined, DEFAULT_BOOKING_SETTINGS)
    expect(order.map((row) => row.id)).toEqual(['b', 'a'])
  })

  it('puts applicants ahead of a queue saved before the setting was on, in the queue’s own order', () => {
    const queue = { order: ['star', 'b', 'mid', 'a'], removed: new Set<string>() }
    const order = spotOrder(
      [candidate('star', { score: 9 }), candidate('a', { applied: true }), candidate('mid'), candidate('b', { applied: true })],
      queue,
      DEFAULT_BOOKING_SETTINGS,
    )
    expect(order.map((row) => row.id)).toEqual(['b', 'a', 'star', 'mid'])
  })

  it('keeps an applicant the booker took out of the queue out', () => {
    const queue = { order: ['star'], removed: new Set(['applicant']) }
    const order = spotOrder([candidate('star'), candidate('applicant', { applied: true })], queue, DEFAULT_BOOKING_SETTINGS)
    expect(order.map((row) => row.id)).toEqual(['star'])
  })

  it('changes nothing when nobody applied', () => {
    const order = spotOrder([candidate('low', { score: 2 }), candidate('high', { score: 9 })], undefined, DEFAULT_BOOKING_SETTINGS)
    expect(order.map((row) => row.id)).toEqual(['high', 'low'])
  })
})

describe('applicants the club has not reviewed', () => {
  const clubReviewed = { ...EMPTY_REVIEW, category: ['headliner'], score: 8 }
  const flagged = { ...EMPTY_REVIEW, category: ['stand-up'], is_flagged: true }

  it('match on their own profile until the club reviews them', () => {
    const merged = mergeApplicantReviews(
      new Map([['known', clubReviewed]]),
      [{ id: 'known', category: ['stand-up'] }, { id: 'new', category: ['open mic', 'nonsense'] }, { id: 'not-applied', category: ['headliner'] }],
      new Set(['known', 'new']),
    )
    expect(merged.get('known')).toBe(clubReviewed)
    expect(merged.get('new')).toMatchObject({ category: ['open mic'], score: EMPTY_REVIEW.score, is_flagged: false })
    expect(merged.has('not-applied')).toBe(false)
  })

  it('keeps a flagged applicant flagged', () => {
    const merged = mergeApplicantReviews(new Map([['f', flagged]]), [{ id: 'f', category: ['stand-up'] }], new Set(['f']))
    expect(merged.get('f')?.is_flagged).toBe(true)
  })
})

describe('spots open for submissions on the remaining-spots card', () => {
  const spot = { id: 'open', quantity: 1, submissions_open: true, auto_started_at: null, rebook_paused_at: null }

  it('are left out normally, and included when the show suggests from submissions', () => {
    expect(unstartedSpots([spot], new Map())).toHaveLength(0)
    expect(unstartedSpots([spot], new Map(), { fromSubmissions: true })).toHaveLength(1)
  })
})
