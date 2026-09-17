import { describe, expect, it } from 'vitest'
import { isPubliclySellable } from '@/lib/public-events'
import type { ClubReadiness } from '@/lib/stripe-connect'
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
    const state = toPublicTicketSalesState(ticketSalesState(show('2026-12-15'), now), true)
    expect(state).toEqual({ kind: 'not_yet_open', openDate: '2026-09-17' })
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })

  it('drops when the booker closed sales', () => {
    const state = ticketSalesState(show('2026-10-01', { ticket_sales_closed_at: '2026-09-15T08:00:00Z' }), now)
    expect(toPublicTicketSalesState(state, true)).toEqual({ kind: 'closed' })
  })

  it.each([
    [show('2026-10-01'), 'open'],
    [show('2026-09-15'), 'ended'],
    [show('2026-10-01', { status: 'cancelled' }), 'unavailable'],
  ] as const)('passes %# through as %s', (input, kind) => {
    expect(toPublicTicketSalesState(ticketSalesState(input, now), true)).toEqual({ kind })
  })

  it('shows an open window as not on sale when checkout would refuse the purchase', () => {
    const state = toPublicTicketSalesState(ticketSalesState(show('2026-10-01'), now), false)
    expect(state).toEqual({ kind: 'unavailable' })
    expect(ticketSalesButtonLabel(state)).toBe('Not on sale')
  })

  it.each([
    [show('2026-12-15'), { kind: 'not_yet_open', openDate: '2026-09-17' }],
    [show('2026-10-01', { ticket_sales_closed_at: '2026-09-15T08:00:00Z' }), { kind: 'closed' }],
    [show('2026-09-15'), { kind: 'ended' }],
  ] as const)('keeps the window state %# for a show checkout cannot sell yet', (input, expected) => {
    expect(toPublicTicketSalesState(ticketSalesState(input, now), false)).toEqual(expected)
  })
})

describe('isPubliclySellable', () => {
  const readyClub: ClubReadiness = {
    stripe_account_id: 'acct_123',
    charges_enabled: true,
    payouts_enabled: true,
    payout_schedule_interval: 'manual',
    legal_name: 'Comedy AS',
    org_number: '123456789',
    support_email: 'club@example.com',
  }
  const priced = { ticket_url: null, ticket_price: 25000 }

  it('sells a priced show from a ready club', () => {
    expect(isPubliclySellable(priced, readyClub)).toBe(true)
  })

  it.each([null, 0, -100])('refuses a show with price %s', (ticket_price) => {
    expect(isPubliclySellable({ ticket_url: null, ticket_price }, readyClub)).toBe(false)
  })

  it('refuses a show without a club', () => {
    expect(isPubliclySellable(priced, null)).toBe(false)
    expect(isPubliclySellable(priced, undefined)).toBe(false)
  })

  it.each([
    ['no Stripe account', { stripe_account_id: null }],
    ['charges disabled', { charges_enabled: false }],
    ['payouts disabled', { payouts_enabled: false }],
    ['automatic payouts confirmed by Stripe', { payout_schedule_interval: 'daily' }],
    ['missing legal name', { legal_name: ' ' }],
    ['missing org number', { org_number: null }],
  ] as const)('refuses a club with %s', (_label, overrides) => {
    expect(isPubliclySellable(priced, { ...readyClub, ...overrides })).toBe(false)
  })

  it('accepts an unknown payout schedule, which checkout looks up before deciding', () => {
    expect(isPubliclySellable(priced, { ...readyClub, payout_schedule_interval: null })).toBe(true)
    // Ukjent plan redder ikke en klubb som mangler noe annet.
    expect(
      isPubliclySellable(priced, { ...readyClub, payout_schedule_interval: null, charges_enabled: false }),
    ).toBe(false)
  })

  it('leaves an external ticket page to the sales window alone', () => {
    expect(isPubliclySellable({ ticket_url: 'https://tickets.example.com/x', ticket_price: null }, null)).toBe(true)
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
