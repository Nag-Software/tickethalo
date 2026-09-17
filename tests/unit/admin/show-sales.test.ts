import { describe, expect, it } from 'vitest'
import {
  canRefundAllTickets,
  checkShowDetailsChange,
  deleteShowBlockedMessage,
  deletionOutcome,
  describeDeletionBlockers,
  describeTicketSalesState,
  formatMinorAmount,
  hasOutstandingSales,
  hasRefundableSales,
  isTicketSalesStopped,
  normalizeShowSalesSummary,
  soldTicketCount,
  ticketSalesChip,
  ticketSalesNote,
  toShowSalesOverviewDto,
  toTicketSalesStateDto,
  type ShowSalesOverview,
  type ShowSalesSummary,
  type TicketSalesStateDto,
} from '@/lib/show-sales-shared'
import { ticketSalesState } from '@/lib/ticket-sales'

/** Et show uten noe salg. Hver test legger på det den handler om. */
function summary(overrides: Partial<ShowSalesSummary> = {}): ShowSalesSummary {
  return {
    paid_orders: 0,
    paid_amount: 0,
    valid_tickets: 0,
    used_tickets: 0,
    refunded_orders: 0,
    awaiting_refund_orders: 0,
    awaiting_refund_amount: 0,
    total_orders: 0,
    fee_invoices: 0,
    open_dispute_orders: 0,
    pending_refund_orders: 0,
    ...overrides,
  }
}

const ALL_KINDS: TicketSalesStateDto['kind'][] = ['open', 'not_yet_open', 'closed', 'ended', 'unavailable']

describe('deletionOutcome', () => {
  it('deletes a show that never had an order or a fee invoice', () => {
    expect(deletionOutcome(summary())).toBe('delete')
  })

  it.each([
    ['a paid order', { paid_orders: 1, paid_amount: 25000, total_orders: 1 }],
    ['a valid ticket', { valid_tickets: 1 }],
    ['a scanned ticket', { used_tickets: 1 }],
    ['a payment waiting to be refunded', { awaiting_refund_orders: 1, awaiting_refund_amount: 25000, total_orders: 1 }],
    ['an open dispute on a refunded order', { open_dispute_orders: 1, refunded_orders: 1, total_orders: 1 }],
  ])('blocks deletion while the show has %s', (_label, overrides) => {
    expect(deletionOutcome(summary(overrides))).toBe('blocked')
    expect(hasOutstandingSales(summary(overrides))).toBe(true)
  })

  it('blocks deletion while a refund is still pending in Stripe', () => {
    const pending = summary({ pending_refund_orders: 1, refunded_orders: 1, total_orders: 1 })
    expect(deletionOutcome(pending)).toBe('blocked')
    expect(describeDeletionBlockers(pending, 'NOK')).toContain(
      '1 refund is still being processed by Stripe — wait until the buyers have received the money',
    )
  })

  it('has no outstanding sales once everything is refunded', () => {
    expect(hasOutstandingSales(summary({ refunded_orders: 3, total_orders: 3, fee_invoices: 1 }))).toBe(false)
  })

  it('blocks even when history would otherwise archive the show', () => {
    expect(deletionOutcome(summary({ paid_orders: 1, refunded_orders: 4, total_orders: 5, fee_invoices: 2 }))).toBe(
      'blocked',
    )
  })

  it('archives a fully refunded show so orders and refunds stay for accounting', () => {
    expect(deletionOutcome(summary({ refunded_orders: 3, total_orders: 3 }))).toBe('archive')
  })

  it('archives a show with cancelled orders that have been refunded', () => {
    expect(deletionOutcome(summary({ total_orders: 1 }))).toBe('archive')
  })

  it('archives a show that only has fee invoices', () => {
    expect(deletionOutcome(summary({ fee_invoices: 1 }))).toBe('archive')
  })
})

describe('describeDeletionBlockers', () => {
  it('returns nothing when deletion is not blocked', () => {
    expect(describeDeletionBlockers(summary({ refunded_orders: 2, total_orders: 2 }), 'NOK')).toEqual([])
  })

  it('lists every blocker with counts and amounts', () => {
    const blockers = describeDeletionBlockers(
      summary({
        paid_orders: 3,
        paid_amount: 75000,
        valid_tickets: 5,
        used_tickets: 2,
        awaiting_refund_orders: 2,
        awaiting_refund_amount: 50050,
        total_orders: 5,
        open_dispute_orders: 2,
      }),
      'NOK',
    )

    expect(blockers).toHaveLength(5)
    expect(blockers[0]).toBe('5 sold tickets are still valid')
    expect(blockers[1]).toBe('2 tickets have been scanned at the door')
    expect(blockers[2]).toMatch(/^3 paid orders \(.*750.*\) have not been refunded$/)
    expect(blockers[3]).toMatch(/^2 payments \(.*500\.50.*\) that did not issue tickets are waiting to be refunded$/)
    expect(blockers[4]).toBe('2 payments are disputed in Stripe — wait for the disputes to close')
  })

  it('uses singular forms for one of each', () => {
    const blockers = describeDeletionBlockers(
      summary({
        paid_orders: 1,
        paid_amount: 25000,
        valid_tickets: 1,
        used_tickets: 1,
        awaiting_refund_orders: 1,
        awaiting_refund_amount: 25000,
        open_dispute_orders: 1,
      }),
      'NOK',
    )

    expect(blockers[0]).toBe('1 sold ticket is still valid')
    expect(blockers[1]).toBe('1 ticket has been scanned at the door')
    expect(blockers[2]).toMatch(/^1 paid order \(.*\) has not been refunded$/)
    expect(blockers[3]).toMatch(/^1 payment \(.*\) that did not issue tickets is waiting to be refunded$/)
    expect(blockers[4]).toBe('1 payment is disputed in Stripe — wait for the dispute to close')
  })

  it('only describes what is actually blocking', () => {
    expect(describeDeletionBlockers(summary({ awaiting_refund_orders: 1, awaiting_refund_amount: 10000 }), 'EUR')).toEqual([
      expect.stringContaining('waiting to be refunded'),
    ])
  })

  it('always has a blocker when the outcome is blocked', () => {
    const cases = [
      summary({ paid_orders: 1 }),
      summary({ valid_tickets: 1 }),
      summary({ used_tickets: 1 }),
      summary({ awaiting_refund_orders: 1 }),
      summary({ open_dispute_orders: 1 }),
    ]

    for (const row of cases) {
      expect(deletionOutcome(row)).toBe('blocked')
      expect(describeDeletionBlockers(row, 'NOK').length).toBeGreaterThan(0)
    }
  })
})

describe('deleteShowBlockedMessage', () => {
  it('counts valid and scanned tickets as sold tickets', () => {
    expect(deleteShowBlockedMessage({ paid_orders: 2, valid_tickets: 3, used_tickets: 1, awaiting_refund_orders: 0 })).toBe(
      'This show has 4 sold tickets that are not refunded. Stop ticket sales and refund all tickets before deleting.',
    )
  })

  it('uses the singular for one ticket', () => {
    expect(deleteShowBlockedMessage({ paid_orders: 1, valid_tickets: 1, used_tickets: 0, awaiting_refund_orders: 0 })).toBe(
      'This show has 1 sold ticket that is not refunded. Stop ticket sales and refund all tickets before deleting.',
    )
  })

  it('falls back to paid orders when no tickets are left', () => {
    expect(deleteShowBlockedMessage({ paid_orders: 2, valid_tickets: 0, used_tickets: 0, awaiting_refund_orders: 0 })).toContain(
      '2 paid orders that are not refunded',
    )
  })

  it('mentions payments waiting to be refunded', () => {
    expect(deleteShowBlockedMessage({ paid_orders: 0, valid_tickets: 0, used_tickets: 0, awaiting_refund_orders: 1 })).toBe(
      'This show has 1 payment waiting to be refunded. Refund all tickets before deleting.',
    )
  })

  it('adds open disputes, which a refund cannot clear', () => {
    expect(
      deleteShowBlockedMessage({
        paid_orders: 1,
        valid_tickets: 0,
        used_tickets: 0,
        awaiting_refund_orders: 0,
        open_dispute_orders: 1,
      }),
    ).toBe(
      'This show has 1 paid order that is not refunded. Stop ticket sales and refund all tickets before deleting. ' +
        '1 payment is disputed in Stripe — wait for the dispute to close.',
    )
  })

  it('explains a block that is only an open dispute', () => {
    expect(
      deleteShowBlockedMessage({
        paid_orders: 0,
        valid_tickets: 0,
        used_tickets: 0,
        awaiting_refund_orders: 0,
        open_dispute_orders: 2,
      }),
    ).toBe("This show can't be deleted yet. 2 payments are disputed in Stripe — wait for the disputes to close.")
  })
})

describe('sales stopped and refund all', () => {
  it('treats closed, ended and unavailable sales as stopped', () => {
    expect(ALL_KINDS.filter((kind) => isTicketSalesStopped({ kind }))).toEqual(['closed', 'ended', 'unavailable'])
  })

  it('has something to refund only with paid or queued payments', () => {
    expect(hasRefundableSales(summary())).toBe(false)
    expect(hasRefundableSales(summary({ refunded_orders: 3, total_orders: 3 }))).toBe(false)
    expect(hasRefundableSales(summary({ paid_orders: 1 }))).toBe(true)
    expect(hasRefundableSales(summary({ awaiting_refund_orders: 1 }))).toBe(true)
  })

  it('requires sales to be stopped before refunding everything', () => {
    const paid = summary({ paid_orders: 2, valid_tickets: 2 })
    expect(canRefundAllTickets({ kind: 'open' }, paid)).toBe(false)
    expect(canRefundAllTickets({ kind: 'not_yet_open' }, paid)).toBe(false)
    expect(canRefundAllTickets({ kind: 'closed' }, paid)).toBe(true)
    expect(canRefundAllTickets({ kind: 'ended' }, paid)).toBe(true)
    expect(canRefundAllTickets({ kind: 'closed' }, summary())).toBe(false)
  })

  it('counts sold tickets as valid plus scanned', () => {
    expect(soldTicketCount({ valid_tickets: 7, used_tickets: 3 })).toBe(10)
  })
})

describe('formatMinorAmount', () => {
  it('formats minor units in the show currency', () => {
    expect(formatMinorAmount(25000, 'NOK')).toMatch(/250/)
    expect(formatMinorAmount(25000, 'NOK')).not.toMatch(/\.00/)
    expect(formatMinorAmount(12345, 'EUR')).toBe('€123.45')
  })

  it('does not throw on an unknown currency code', () => {
    expect(formatMinorAmount(1050, 'NOPE!')).toBe('10.50 NOPE!')
  })

  it('treats a non-finite amount as zero', () => {
    expect(formatMinorAmount(Number.NaN, 'EUR')).toBe('€0')
  })
})

describe('normalizeShowSalesSummary', () => {
  it('turns nulls and numeric strings into numbers', () => {
    expect(
      normalizeShowSalesSummary({ paid_orders: '2', paid_amount: '50000', valid_tickets: null, fee_invoices: undefined }),
    ).toEqual(summary({ paid_orders: 2, paid_amount: 50000 }))
  })

  it('keeps open disputes', () => {
    expect(normalizeShowSalesSummary({ open_dispute_orders: '3' }).open_dispute_orders).toBe(3)
  })
})

describe('sales state wording', () => {
  const now = new Date('2026-09-16T12:00:00Z')
  const show = (overrides: Record<string, unknown>) => ({
    status: 'published',
    date: '2026-10-01',
    ticket_sales_closed_at: null,
    deleted_at: null,
    ...overrides,
  })

  it('serialises the opening time for the client', () => {
    const dto = toTicketSalesStateDto(ticketSalesState(show({ date: '2027-03-01' }), now))
    expect(dto).toEqual({ kind: 'not_yet_open', openDate: '2026-12-02', opensAt: '2026-12-01T23:00:00.000Z' })
  })

  it('explains when sales open', () => {
    const dto: TicketSalesStateDto = { kind: 'not_yet_open', openDate: '2026-12-02', opensAt: '2026-12-01T23:00:00.000Z' }
    expect(ticketSalesChip(dto)).toEqual({ label: 'Sales open 2 December 2026', tone: 'scheduled' })
    expect(ticketSalesNote(dto)).toBe('Ticket sales open 2 December 2026')
    expect(describeTicketSalesState(dto, 'published').description).toMatch(/90 days before the show/)
  })

  it('says when sales were stopped, in Norwegian time', () => {
    const dto: TicketSalesStateDto = { kind: 'closed', closedAt: '2026-09-16T12:30:00Z' }
    expect(ticketSalesChip(dto).tone).toBe('stopped')
    expect(ticketSalesNote(dto)).toBe('Ticket sales stopped on 16 September 2026 at 14:30')
    expect(describeTicketSalesState(dto, 'published').title).toBe('Ticket sales stopped on 16 September 2026 at 14:30')
  })

  it('adds no note while sales are open or over', () => {
    expect(ticketSalesNote({ kind: 'open' })).toBeNull()
    expect(ticketSalesNote({ kind: 'ended' })).toBeNull()
    expect(ticketSalesNote({ kind: 'unavailable' })).toBeNull()
  })

  it('explains why an unpublished or cancelled show is not on sale', () => {
    expect(describeTicketSalesState({ kind: 'unavailable' }, 'draft').description).toMatch(/isn't published/)
    expect(describeTicketSalesState({ kind: 'unavailable' }, 'cancelled').description).toMatch(/is cancelled/)
  })
})

describe('toShowSalesOverviewDto', () => {
  it('serialises dates and adds the blockers', () => {
    const overview: ShowSalesOverview = {
      showId: 'show-1',
      title: 'Friday Laughs',
      status: 'published',
      date: '2027-03-01',
      currency: 'NOK',
      sales: { kind: 'not_yet_open', opensAt: new Date('2026-12-01T23:00:00.000Z'), openDate: '2026-12-02' },
      summary: summary({ valid_tickets: 2, paid_orders: 1, paid_amount: 50000, total_orders: 1 }),
      deletion: 'blocked',
    }

    const dto = toShowSalesOverviewDto(overview)
    expect(dto.sales).toEqual({ kind: 'not_yet_open', opensAt: '2026-12-01T23:00:00.000Z', openDate: '2026-12-02' })
    expect(dto.blockers).toHaveLength(2)
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto)
  })
})

describe('checkShowDetailsChange', () => {
  // 17 September 2026, 12:00 in Oslo.
  const now = new Date('2026-09-17T10:00:00Z')

  const published = { date: '2026-10-01', currency: 'NOK', status: 'published', deleted_at: null }

  function check(overrides: Partial<Parameters<typeof checkShowDetailsChange>[0]> = {}) {
    return checkShowDetailsChange(
      { show: published, date: published.date, clubCurrency: 'NOK', hasSales: false, earliestSaleAt: null, ...overrides },
      now,
    )
  }

  function errorOf(result: ReturnType<typeof checkShowDetailsChange>) {
    return result.ok ? null : result.error
  }

  it('saves other edits when neither date nor currency changes', () => {
    expect(check({ hasSales: true, earliestSaleAt: '2026-09-01T10:00:00Z' })).toEqual({
      ok: true,
      currency: 'NOK',
      dateChanged: false,
    })
  })

  it('lets a show without sales move anywhere and follow the club currency', () => {
    expect(check({ date: '2027-06-01', clubCurrency: 'EUR' })).toEqual({ ok: true, currency: 'EUR', dateChanged: true })
    expect(check({ date: '2026-01-01' })).toEqual({ ok: true, currency: 'NOK', dateChanged: true })
  })

  it("keeps the show's currency when the club has none", () => {
    expect(check({ clubCurrency: null, show: { ...published, currency: 'SEK' } })).toMatchObject({ currency: 'SEK' })
  })

  it('keeps the currency tickets were sold in, and still saves', () => {
    expect(check({ clubCurrency: 'EUR', hasSales: true, earliestSaleAt: '2026-09-01T10:00:00Z' })).toEqual({
      ok: true,
      currency: 'NOK',
      dateChanged: false,
    })
  })

  it('rejects a move that puts the first sale outside the 90-day window, with the dates', () => {
    const result = check({ date: '2027-03-01', hasSales: true, earliestSaleAt: '2026-09-16T08:00:00Z' })
    expect(errorOf(result)).toBe(
      'Tickets for this show were first sold on 16 September 2026. For a show on 1 March 2027, ticket sales ' +
        "can't open before 2 December 2026, 90 days before the show. Pick a date on or before 14 December 2026, " +
        'or refund all tickets first.',
    )
  })

  it('allows the latest date whose window still covers the first sale, and not a day later', () => {
    // Salget var 16. september kl. 00:30 norsk tid — like etter midnatt.
    const earliestSaleAt = '2026-09-15T22:30:00Z'
    expect(check({ date: '2026-12-14', hasSales: true, earliestSaleAt }).ok).toBe(true)
    expect(check({ date: '2026-12-15', hasSales: true, earliestSaleAt }).ok).toBe(false)
  })

  it('lets a show with sales move closer', () => {
    expect(check({ date: '2026-09-25', hasSales: true, earliestSaleAt: '2026-09-01T10:00:00Z' })).toEqual({
      ok: true,
      currency: 'NOK',
      dateChanged: true,
    })
  })

  it('rejects moving a show with sales to a date that has passed', () => {
    const result = check({ date: '2026-09-16', hasSales: true, earliestSaleAt: '2026-09-01T10:00:00Z' })
    expect(errorOf(result)).toBe(
      "Tickets have been sold for this show, so it can't be moved to 16 September 2026, a date that has already passed.",
    )
    expect(check({ date: '2026-09-17', hasSales: true, earliestSaleAt: '2026-09-01T10:00:00Z' }).ok).toBe(true)
  })

  it('rejects moving a cancelled show that still has sales', () => {
    const show = { ...published, status: 'cancelled' }
    expect(errorOf(check({ show, date: '2026-10-02', hasSales: true }))).toMatch(/cancelled .* Refund all tickets first\.$/)
    expect(check({ show, date: '2026-10-02' }).ok).toBe(true)
  })

  it('never moves an archived show', () => {
    const show = { ...published, status: 'cancelled', deleted_at: '2026-09-10T10:00:00Z' }
    expect(errorOf(check({ show, date: '2026-10-02' }))).toBe("This show has been deleted, so its date can't be changed.")
  })

  it('rejects a date that is not a calendar date', () => {
    expect(errorOf(check({ date: '2026-02-30' }))).toBe('Pick a valid date for the show.')
    expect(errorOf(check({ date: '' }))).toBe('Pick a valid date for the show.')
  })

  it('ignores a sale time it cannot read instead of blocking the save', () => {
    expect(check({ date: '2026-10-05', hasSales: true, earliestSaleAt: 'not a date' }).ok).toBe(true)
  })
})
