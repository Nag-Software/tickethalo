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
      'Headliner', 'Host', 'Stand-up', 'Stand-up', 'Stand-up', 'Open Mic',
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

  it('sets the open mic to an explicit no-fee agreement', () => {
    expect(defaultLineupSpots().at(-1)).toMatchObject({ role_name: 'Open Mic', compensation_percent: 0 })
  })

  it('does not share mutable rows between calls', () => {
    const first = defaultLineupSpots()
    first[0].role_name = 'Changed'
    expect(defaultLineupSpots()[0].role_name).toBe('Headliner')
  })
})
