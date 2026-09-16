import { describe, expect, it } from 'vitest'
import {
  TICKET_SALES_WINDOW_DAYS,
  isTicketSalesOpen,
  osloDate,
  startOfDayInZone,
  ticketSalesOpenDate,
  ticketSalesOpensAt,
  ticketSalesState,
} from '@/lib/ticket-sales'

const published = (date: string, overrides: Record<string, unknown> = {}) => ({
  status: 'published',
  date,
  ticket_sales_closed_at: null,
  deleted_at: null,
  ...overrides,
})

/** Dager fra og med `from` til og med `to`. */
function inclusiveDays(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

describe('ticketSalesOpenDate', () => {
  it('counts the show day as day 1 and opens on day 90', () => {
    expect(ticketSalesOpenDate('2026-12-15')).toBe('2026-09-17')
    expect(inclusiveDays('2026-09-17', '2026-12-15')).toBe(TICKET_SALES_WINDOW_DAYS)
  })

  it('crosses month and year boundaries', () => {
    expect(ticketSalesOpenDate('2027-01-10')).toBe('2026-10-13')
    expect(inclusiveDays(ticketSalesOpenDate('2027-01-10'), '2027-01-10')).toBe(90)
  })

  it('handles leap years', () => {
    expect(inclusiveDays(ticketSalesOpenDate('2028-03-15'), '2028-03-15')).toBe(90)
    expect(ticketSalesOpenDate('2028-03-15')).toBe('2027-12-17')
  })
})

describe('ticketSalesOpensAt', () => {
  it('opens at midnight Oslo time in summer (UTC+2)', () => {
    expect(ticketSalesOpensAt('2026-12-15').toISOString()).toBe('2026-09-16T22:00:00.000Z')
  })

  it('opens at midnight Oslo time in winter (UTC+1)', () => {
    expect(ticketSalesOpenDate('2027-03-30')).toBe('2026-12-31')
    expect(ticketSalesOpensAt('2027-03-30').toISOString()).toBe('2026-12-30T23:00:00.000Z')
  })

  it('uses the right offset on DST change days', () => {
    expect(startOfDayInZone('2026-03-29').toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(startOfDayInZone('2026-10-25').toISOString()).toBe('2026-10-24T22:00:00.000Z')
  })

  it('never lets a sale happen more than 90 days before the show day starts', () => {
    for (const date of ['2026-12-15', '2027-03-30', '2027-06-01', '2027-10-31']) {
      const opensAt = ticketSalesOpensAt(date).getTime()
      const showDayStart = startOfDayInZone(date).getTime()
      expect(showDayStart - opensAt).toBeLessThanOrEqual(90 * 86_400_000)
    }
  })
})

describe('ticketSalesState', () => {
  it('is not yet open one minute before midnight on the opening day', () => {
    const state = ticketSalesState(published('2026-12-15'), new Date('2026-09-16T21:59:00Z'))
    expect(state).toMatchObject({ kind: 'not_yet_open', openDate: '2026-09-17' })
  })

  it('opens exactly at midnight Oslo time', () => {
    expect(isTicketSalesOpen(published('2026-12-15'), new Date('2026-09-16T22:00:00Z'))).toBe(true)
  })

  it('stays open on the show day and ends the day after (Oslo date)', () => {
    expect(ticketSalesState(published('2026-10-17'), new Date('2026-10-17T21:30:00Z')).kind).toBe('open')
    expect(ticketSalesState(published('2026-10-17'), new Date('2026-10-17T22:30:00Z')).kind).toBe('ended')
  })

  it('reports closed sales before the window check', () => {
    const state = ticketSalesState(
      published('2026-12-15', { ticket_sales_closed_at: '2026-09-01T10:00:00Z' }),
      new Date('2026-09-02T10:00:00Z'),
    )
    expect(state).toEqual({ kind: 'closed', closedAt: '2026-09-01T10:00:00Z' })
  })

  it('is unavailable when unpublished, cancelled or deleted', () => {
    const now = new Date('2026-10-01T10:00:00Z')
    expect(ticketSalesState(published('2026-10-17', { status: 'fullbooked' }), now).kind).toBe('unavailable')
    expect(ticketSalesState(published('2026-10-17', { status: 'cancelled' }), now).kind).toBe('unavailable')
    expect(ticketSalesState(published('2026-10-17', { deleted_at: '2026-09-30T10:00:00Z' }), now).kind).toBe('unavailable')
  })
})

describe('osloDate', () => {
  it('uses the Oslo calendar date, not UTC', () => {
    expect(osloDate(new Date('2026-09-16T22:30:00Z'))).toBe('2026-09-17')
    expect(osloDate(new Date('2026-09-16T21:30:00Z'))).toBe('2026-09-16')
  })
})
