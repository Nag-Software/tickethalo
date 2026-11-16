import { describe, expect, it } from 'vitest'
import { defaultLineupSpots } from '@/lib/lineup-defaults'

describe('default admin lineup', () => {
  it('creates six individual seats', () => {
    expect(defaultLineupSpots()).toHaveLength(6)
  })

  it('uses continuous one-based positions', () => {
    expect(defaultLineupSpots().map((spot) => spot.lineup_position)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('creates the standard role order', () => {
    expect(defaultLineupSpots().map((spot) => spot.role_name)).toEqual([
      'Host / MC', 'Opener / Bullet', 'Middle / Feature', 'Showcase Spot', 'Open Spot', 'Closer / Headliner',
    ])
  })

  it('keeps every requirement as one independently editable seat', () => {
    expect(defaultLineupSpots().every((spot) => spot.quantity === 1)).toBe(true)
  })

  it('uses percentage compensation for every default seat', () => {
    expect(defaultLineupSpots().every((spot) => spot.compensation_type === 'percent')).toBe(true)
  })

  it('allocates 60 percent of sales across the default lineup', () => {
    expect(defaultLineupSpots().reduce((sum, spot) => sum + spot.compensation_percent, 0)).toBe(60)
  })

  it('puts the opener second, right after the host, as the first act', () => {
    expect(defaultLineupSpots()[1].role_name).toBe('Opener / Bullet')
  })

  it('sets the open spot to an explicit no-fee agreement', () => {
    expect(defaultLineupSpots().find((spot) => spot.role_name === 'Open Spot')).toMatchObject({ compensation_percent: 0 })
  })

  it('follows the club: only active types, in the club order, with their fees', () => {
    const spots = defaultLineupSpots([
      { name: 'Closer / Headliner', position: 3, active: true, default_compensation_percent: 20 },
      { name: 'Improv', position: 1, active: true, default_compensation_percent: null },
      { name: 'Showcase Spot', position: 2, active: false, default_compensation_percent: 10 },
    ])
    expect(spots.map((spot) => [spot.role_name, spot.lineup_position, spot.compensation_percent])).toEqual([
      ['Improv', 1, 0],
      ['Closer / Headliner', 2, 20],
    ])
  })

  it('falls back to the standard bill when the club has switched everything off', () => {
    expect(defaultLineupSpots([{ name: 'Improv', position: 1, active: false, default_compensation_percent: 0 }])).toHaveLength(6)
  })

  it('does not share mutable rows between calls', () => {
    const first = defaultLineupSpots()
    first[0].role_name = 'Changed'
    expect(defaultLineupSpots()[0].role_name).toBe('Host / MC')
  })
})
