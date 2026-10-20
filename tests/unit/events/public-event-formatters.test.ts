import { describe, expect, it } from 'vitest'
import {
  formatShortDate,
  formatShowDate,
  formatShowPrice as formatPrice,
  formatShowTime,
  formatTicketPrice,
  remainingTickets,
  ticketFillPercent,
} from '@/lib/public-events'

describe('public show formatting', () => {
  it('formats start and end time', () => {
    expect(formatShowTime({ start_time: '19:30:00', end_time: '21:00:00' })).toBe('19:30-21:00')
  })

  it('formats only a start time', () => {
    expect(formatShowTime({ start_time: '19:30:00', end_time: null })).toBe('19:30')
  })

  it('uses a fallback when time is missing', () => {
    expect(formatShowTime({ start_time: null, end_time: null })).toBe('Time TBA')
  })

  it.each([
    [0, 'Free'], [null, 'Free'], [27_000, 'NOK 270'],
  ] as const)('formats ticket price %j', (ticket_price, expected) => {
    expect(formatTicketPrice({ ticket_price, currency: 'NOK' })).toBe(expected)
  })

  it('formats long and short show dates', () => {
    expect(formatShowDate('2026-09-16')).toContain('16 September 2026')
    expect(formatShortDate('2026-09-16')).toContain('16 Sept')
  })
})

describe('public show capacity', () => {
  it.each([
    [null, 10, null], [100, 0, 100], [100, 75, 25], [100, 150, 0],
  ] as const)('returns remaining capacity %#', (capacity, soldTickets, expected) => {
    expect(remainingTickets({ capacity, soldTickets })).toBe(expected)
  })

  it.each([
    [null, 10, 0], [0, 10, 0], [100, 0, 0], [100, 75, 75], [3, 1, 33], [100, 150, 100],
  ] as const)('returns fill percentage %#', (capacity, soldTickets, expected) => {
    expect(ticketFillPercent({ capacity, soldTickets })).toBe(expected)
  })

  it('shows one price alone, several as from the lowest, and a free one as a range', () => {
    const types = (...amounts: number[]) => amounts.map((unitAmount) => ({ unitAmount }))
    // Intl skriver et hardt mellomrom mellom valuta og beløp.
    const formatShowPrice = (...args: Parameters<typeof formatPrice>) => formatPrice(...args).replace(/\u00a0/g, ' ')
    expect(formatShowPrice({ ticket_price: 25_000, currency: 'NOK', ticketTypes: types(25_000) })).toBe('NOK 250')
    expect(formatShowPrice({ ticket_price: 20_000, currency: 'NOK', ticketTypes: types(25_000, 20_000) })).toBe('From NOK 200')
    expect(formatShowPrice({ ticket_price: 0, currency: 'NOK', ticketTypes: types(0, 25_000, 40_000) })).toBe('Free – NOK 400')
    expect(formatShowPrice({ ticket_price: 0, currency: 'NOK', ticketTypes: types(0) })).toBe('Free')
    expect(formatShowPrice({ ticket_price: 25_000, currency: 'NOK' })).toBe('NOK 250')
  })
})
