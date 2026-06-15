import { describe, expect, it } from 'vitest'
import {
  MAX_ARTIST_AVAILABILITY_DATES,
  canAddAvailabilityDate,
  countActiveAvailabilityDates,
  isAvailabilityDateActive,
} from './artist-availability'

describe('artist availability limits', () => {
  const today = '2026-06-15'

  it('counts only current and future dates', () => {
    const rows = [
      { available_date: '2026-06-10' },
      { available_date: '2026-06-15' },
      { available_date: '2026-06-20' },
    ]

    expect(countActiveAvailabilityDates(rows, today)).toBe(2)
    expect(isAvailabilityDateActive('2026-06-10', today)).toBe(false)
    expect(isAvailabilityDateActive('2026-06-20', today)).toBe(true)
  })

  it('allows adding until max 3 active dates', () => {
    const twoActive = [
      { available_date: '2026-06-16' },
      { available_date: '2026-06-17' },
    ]
    const threeActive = [
      ...twoActive,
      { available_date: '2026-06-18' },
    ]

    expect(canAddAvailabilityDate(twoActive, today)).toBe(true)
    expect(canAddAvailabilityDate(threeActive, today)).toBe(false)
    expect(MAX_ARTIST_AVAILABILITY_DATES).toBe(3)
  })
})
