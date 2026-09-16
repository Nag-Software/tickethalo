import { describe, expect, it } from 'vitest'
import { buildBookingSpots, requirementFeeLabel } from '@/lib/booking-spots'
import { requirementFactory, resetFactorySequence } from '@/tests/factories/domain'

describe('booking spot fees', () => {
  it.each([
    [{ compensation_type: null, compensation_amount: null, compensation_percent: null }, 'Not set'],
    [{ compensation_type: 'percent', compensation_amount: null, compensation_percent: null }, 'Not set'],
    [{ compensation_type: 'percent', compensation_amount: null, compensation_percent: 0 }, 'No fee'],
    [{ compensation_type: 'percent', compensation_amount: null, compensation_percent: 12.5 }, '12.5% of sales'],
    [{ compensation_type: 'fixed', compensation_amount: null, compensation_percent: null }, 'Fixed fee'],
    [{ compensation_type: 'fixed', compensation_amount: 0, compensation_percent: null }, 'No fee'],
    [{ compensation_type: 'fixed', compensation_amount: 100_000, compensation_percent: null }, 'NOK 1,000'],
  ] as const)('formats %# fee arrangement', (fee, expected) => {
    expect(requirementFeeLabel(fee, 'NOK')).toBe(expected)
  })
})

describe('booking spot construction', () => {
  const artistName = (id: string) => ({ a1: 'Ada', a2: 'Bjørn', a3: 'Cleo' })[id] ?? id

  it('creates one open row for a requirement with quantity zero', () => {
    resetFactorySequence()
    const spots = buildBookingSpots({
      requirements: [requirementFactory({ quantity: 0 })],
      confirmedSpots: [],
      offers: [],
      artistName,
      currency: 'NOK',
    })
    expect(spots).toHaveLength(1)
    expect(spots[0].state).toBe('open')
  })

  it('expands quantity into sequential seats', () => {
    const spots = buildBookingSpots({
      requirements: [requirementFactory({ id: 'r1', quantity: 3 })],
      confirmedSpots: [],
      offers: [],
      artistName,
      currency: 'NOK',
    })
    expect(spots.map(({ key, position }) => [key, position])).toEqual([
      ['r1-0', 1], ['r1-1', 2], ['r1-2', 3],
    ])
  })

  it.each(['confirmed', 'completed', 'paid'])('treats %s spots as booked', (status) => {
    const [spot] = buildBookingSpots({
      requirements: [requirementFactory({ id: 'r1' })],
      confirmedSpots: [{ id: 's1', artist_id: 'a1', show_requirement_id: 'r1', status }],
      offers: [], artistName, currency: 'NOK',
    })
    expect(spot).toMatchObject({ state: 'booked', artistName: 'Ada', spotId: 's1' })
  })

  it.each(['cancelled', 'declined', 'pending'])('ignores inactive confirmed status %s', (status) => {
    const [spot] = buildBookingSpots({
      requirements: [requirementFactory({ id: 'r1' })],
      confirmedSpots: [{ id: 's1', artist_id: 'a1', show_requirement_id: 'r1', status }],
      offers: [], artistName, currency: 'NOK',
    })
    expect(spot.state).toBe('open')
  })

  it('places booked artists before pending offers', () => {
    const spots = buildBookingSpots({
      requirements: [requirementFactory({ id: 'r1', quantity: 3 })],
      confirmedSpots: [{ id: 's1', artist_id: 'a1', show_requirement_id: 'r1', status: 'confirmed' }],
      offers: [
        { id: 'o1', artist_id: 'a2', show_requirement_id: 'r1', status: 'sent' },
        { id: 'o2', artist_id: 'a3', show_requirement_id: 'r1', status: 'sent' },
      ], artistName, currency: 'NOK',
    })
    expect(spots.map((spot) => [spot.state, spot.artistName])).toEqual([
      ['booked', 'Ada'], ['pending', 'Bjørn'], ['pending', 'Cleo'],
    ])
  })

  it('ignores offers belonging to another requirement', () => {
    const [spot] = buildBookingSpots({
      requirements: [requirementFactory({ id: 'r1' })],
      confirmedSpots: [],
      offers: [{ id: 'o1', artist_id: 'a1', show_requirement_id: 'r2', status: 'sent' }],
      artistName, currency: 'NOK',
    })
    expect(spot.state).toBe('open')
  })

  it('ignores offers that are no longer sent', () => {
    const [spot] = buildBookingSpots({
      requirements: [requirementFactory({ id: 'r1' })],
      confirmedSpots: [],
      offers: [{ id: 'o1', artist_id: 'a1', show_requirement_id: 'r1', status: 'accepted' }],
      artistName, currency: 'NOK',
    })
    expect(spot.state).toBe('open')
  })

  it('preserves fee data on every expanded seat', () => {
    const spots = buildBookingSpots({
      requirements: [requirementFactory({ id: 'r1', quantity: 2, compensation_type: 'percent', compensation_amount: null, compensation_percent: 15 })],
      confirmedSpots: [], offers: [], artistName, currency: 'NOK',
    })
    expect(spots.every((spot) => spot.fee.type === 'percent' && spot.fee.percent === 15)).toBe(true)
  })

  it('continues positions across requirements', () => {
    const spots = buildBookingSpots({
      requirements: [requirementFactory({ id: 'r1', quantity: 2 }), requirementFactory({ id: 'r2', quantity: 2 })],
      confirmedSpots: [], offers: [], artistName, currency: 'NOK',
    })
    expect(spots.map((spot) => spot.position)).toEqual([1, 2, 3, 4])
  })
})
