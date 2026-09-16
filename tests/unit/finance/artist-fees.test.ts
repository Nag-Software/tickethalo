import { describe, expect, it } from 'vitest'
import { computeShowFees, type FeeSpotInput } from '@/lib/artist-fees'

const fixed = (id: string, amount: number): FeeSpotInput => ({
  spotId: id,
  artistId: `artist-${id}`,
  compensation_type: 'fixed',
  compensation_amount: amount,
  compensation_percent: null,
})

const percent = (id: string, value: number): FeeSpotInput => ({
  spotId: id,
  artistId: `artist-${id}`,
  compensation_type: 'percent',
  compensation_amount: null,
  compensation_percent: value,
})

describe('show fee calculation', () => {
  it.each([
    [100_000, 9000, 90_000], [100_000, 0, 0], [99, 3333, 33], [-100, 9000, 0],
  ] as const)('calculates the lineup pot from %i net and %i bps', (net, shareBps, pot) => {
    expect(computeShowFees({ net, shareBps, spots: [] }).pot).toBe(pot)
  })

  it('pays fixed fees unchanged when they fit inside the pot', () => {
    const result = computeShowFees({ net: 100_000, shareBps: 9000, spots: [fixed('1', 30_000), fixed('2', 20_000)] })
    expect(result.fees.map((fee) => fee.amount)).toEqual([30_000, 20_000])
    expect(result.overCommitted).toBe(false)
  })

  it('marks fixed fees above the pot as overcommitted without reducing them', () => {
    const result = computeShowFees({ net: 50_000, shareBps: 5000, spots: [fixed('1', 30_000)] })
    expect(result).toMatchObject({ pot: 25_000, total: 30_000, overCommitted: true })
  })

  it('calculates percentages from show net, not the lineup pot', () => {
    const [fee] = computeShowFees({ net: 100_000, shareBps: 9000, spots: [percent('1', 20)] }).fees
    expect(fee.amount).toBe(20_000)
  })

  it('scales all percentage fees proportionally when they exceed remaining room', () => {
    const result = computeShowFees({
      net: 100_000,
      shareBps: 5000,
      spots: [fixed('f', 20_000), percent('p1', 30), percent('p2', 30)],
    })
    expect(result.fees.map((fee) => fee.amount)).toEqual([20_000, 15_000, 15_000])
    expect(result.fees.slice(1).every((fee) => fee.capped)).toBe(true)
  })

  it('reduces percentages to zero when fixed fees consume the pot', () => {
    const result = computeShowFees({ net: 100_000, shareBps: 5000, spots: [fixed('f', 50_000), percent('p', 20)] })
    expect(result.fees[1]).toMatchObject({ amount: 0, capped: true })
  })

  it('floors scaled values so rounding cannot exceed the pot', () => {
    const result = computeShowFees({ net: 101, shareBps: 10000, spots: [percent('1', 100), percent('2', 100)] })
    expect(result.total).toBeLessThanOrEqual(result.pot)
    expect(result.fees.map((fee) => fee.amount)).toEqual([50, 50])
  })

  it.each([
    [fixed('1', -100), 0], [percent('1', -25), 0],
    [{ ...fixed('1', 100), compensation_amount: null }, 0],
    [{ ...percent('1', 10), compensation_percent: null }, 0],
  ] as const)('never returns a negative fee for %#', (spot, amount) => {
    expect(computeShowFees({ net: 100_000, shareBps: 10000, spots: [spot] }).fees[0].amount).toBe(amount)
  })

  it('represents a missing agreement explicitly', () => {
    const [fee] = computeShowFees({
      net: 100_000,
      shareBps: 9000,
      spots: [{ spotId: '1', artistId: 'a1', compensation_type: null, compensation_amount: null, compensation_percent: null }],
    }).fees
    expect(fee).toEqual({ spotId: '1', artistId: 'a1', amount: 0, basis: 'none', percent: null, capped: false })
  })
})
