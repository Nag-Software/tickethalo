import { describe, expect, it } from 'vitest'
import { formatDayLabel, getOsloToday, isInRange, rangeBounds } from '@/lib/event-filters'

describe('event date filters', () => {
  it('uses Oslo time across the UTC midnight boundary', () => {
    expect(getOsloToday(new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-02')
  })

  it('calculates the remaining Monday-to-Sunday week', () => {
    expect(rangeBounds('this-week', '2026-09-16')).toEqual({ from: '2026-09-16', to: '2026-09-20' })
  })

  it('uses the current weekend when today is Saturday', () => {
    expect(rangeBounds('this-weekend', '2026-09-19')).toEqual({ from: '2026-09-19', to: '2026-09-20' })
  })

  it('checks inclusive range boundaries', () => {
    expect(isInRange('2026-09-20', 'this-week', '2026-09-16')).toBe(true)
    expect(isInRange('2026-09-21', 'this-week', '2026-09-16')).toBe(false)
  })

  it('labels today and tomorrow without a UTC conversion', () => {
    expect(formatDayLabel('2026-09-16', '2026-09-16')).toBe('Today')
    expect(formatDayLabel('2026-09-17', '2026-09-16')).toBe('Tomorrow')
  })
})
