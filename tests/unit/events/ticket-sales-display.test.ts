import { describe, expect, it } from 'vitest'
import { ticketSalesState } from '@/lib/ticket-sales'
import {
  formatSalesOpenDate,
  formatSalesOpenDateShort,
  ticketSalesButtonLabel,
  ticketSalesNote,
  toPublicTicketSalesState,
} from '@/lib/ticket-sales-display'

const show = (date: string, overrides: Record<string, unknown> = {}) => ({
  status: 'published',
  date,
  ticket_sales_closed_at: null,
  deleted_at: null,
  ...overrides,
})

describe('toPublicTicketSalesState', () => {
  const now = new Date('2026-09-16T10:00:00Z')

  it('keeps only serializable fields', () => {
    const state = toPublicTicketSalesState(ticketSalesState(show('2026-12-15'), now))
    expect(state).toEqual({ kind: 'not_yet_open', openDate: '2026-09-17' })
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it('drops when the booker closed sales', () => {
    const state = ticketSalesState(show('2026-10-01', { ticket_sales_closed_at: '2026-09-15T08:00:00Z' }), now)
    expect(toPublicTicketSalesState(state)).toEqual({ kind: 'closed' })
  })

  it.each([
    [show('2026-10-01'), 'open'],
    [show('2026-09-15'), 'ended'],
    [show('2026-10-01', { status: 'cancelled' }), 'unavailable'],
  ] as const)('passes %# through as %s', (input, kind) => {
    expect(toPublicTicketSalesState(ticketSalesState(input, now))).toEqual({ kind })
  })
})

describe('sales date formatting', () => {
  it('formats the open date in English, long and short', () => {
    expect(formatSalesOpenDate('2026-09-17')).toBe('17 September 2026')
    expect(formatSalesOpenDateShort('2026-09-17')).toBe('17 Sep')
  })

  it('keeps the Norwegian calendar date across daylight saving changes', () => {
    // 00:00 i Oslo er 23:00 UTC dagen før om vinteren og 22:00 om sommeren.
    expect(formatSalesOpenDateShort('2026-01-01')).toBe('1 Jan')
    expect(formatSalesOpenDateShort('2026-03-29')).toBe('29 Mar')
    expect(formatSalesOpenDate('2026-10-25')).toBe('25 October 2026')
  })
})

describe('ticket sales button and note', () => {
  it.each([
    [{ kind: 'open' }, null],
    [{ kind: 'not_yet_open', openDate: '2026-09-17' }, 'On sale 17 Sep'],
    [{ kind: 'closed' }, 'Sales closed'],
    [{ kind: 'ended' }, 'Show has ended'],
    [{ kind: 'unavailable' }, 'Not on sale'],
  ] as const)('labels %j', (state, expected) => {
    expect(ticketSalesButtonLabel(state)).toBe(expected)
  })

  it('says when sales open, and nothing otherwise', () => {
    expect(ticketSalesNote({ kind: 'not_yet_open', openDate: '2026-09-17' })).toBe(
      'Tickets go on sale 17 September 2026 at 00:00.',
    )
    expect(ticketSalesNote({ kind: 'open' })).toBeNull()
    expect(ticketSalesNote({ kind: 'closed' })).toBeNull()
  })
})
