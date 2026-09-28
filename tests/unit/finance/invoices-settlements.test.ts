import { describe, expect, it } from 'vitest'
import {
  buildFeeInvoiceReference,
  clubInvoiceRecipient,
  formatMinor,
  normalizeFeeInvoiceReference,
} from '@/lib/fee-invoices'
import { monthPeriod, parseMonthPeriod, periodBounds, previousMonthPeriod, refundedClubAmount } from '@/lib/settlements'

describe('fee invoice recipients', () => {
  it('prefers legal identity and invoice email', () => {
    expect(clubInvoiceRecipient({
      name: 'Comedy Club', legal_name: ' Comedy AS ', org_number: ' 123 ',
      invoice_email: ' invoice@example.com ', support_email: 'support@example.com',
    })).toEqual({ name: 'Comedy AS', orgNumber: '123', email: 'invoice@example.com' })
  })

  it('falls back to display name and support email', () => {
    expect(clubInvoiceRecipient({ name: ' Club ', support_email: ' help@example.com ' })).toEqual({
      name: 'Club', orgNumber: null, email: 'help@example.com',
    })
  })

  it('returns null for blank optional recipient fields', () => {
    expect(clubInvoiceRecipient({ name: 'Club', org_number: ' ', invoice_email: ' ', support_email: ' ' })).toEqual({
      name: 'Club', orgNumber: null, email: null,
    })
  })
})

describe('fee invoice references', () => {
  it('contains the UTC issue year and month', () => {
    expect(buildFeeInvoiceReference(new Date('2026-08-31T23:59:00Z'))).toMatch(/^TH-2608-[0-9A-HJKMNP-TV-Z]{6}$/)
  })

  it.each([
    ['TH-2608-K7QP3M', 'TH-2608-K7QP3M'],
    ['th2608k7qp3m', 'TH-2608-K7QP3M'],
    ['Deres ref: TH 2608 K7QP3M.', 'TH-2608-K7QP3M'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeFeeInvoiceReference(input)).toBe(expected)
  })

  it.each([null, undefined, '', 'TH-2608-ILOU12', 'XTH-2608-K7QP3M', 'TH-2608-K7QP3MX'])(
    'rejects invalid or embedded reference %j',
    (input) => expect(normalizeFeeInvoiceReference(input)).toBeNull(),
  )
})

describe('fee invoice amount formatting', () => {
  it.each([
    [0, 'NOK', /0/],
    [100_000, 'NOK', /1[\s ]000/],
    [14_328, 'NOK', /143,28/],
    [1_050, 'EUR', /10,50/],
  ] as const)('formats %i minor %s', (amount, currency, expected) => {
    expect(formatMinor(amount, currency)).toMatch(expected)
  })
})

describe('settlement periods', () => {
  it.each([
    ['2026-09-16T12:00:00Z', { start: '2026-08-01', end: '2026-08-31' }],
    ['2026-03-01T00:00:00Z', { start: '2026-02-01', end: '2026-02-28' }],
    ['2024-03-01T00:00:00Z', { start: '2024-02-01', end: '2024-02-29' }],
    ['2026-01-01T00:00:00Z', { start: '2025-12-01', end: '2025-12-31' }],
  ] as const)('returns previous complete month for %s', (date, expected) => {
    expect(previousMonthPeriod(new Date(date))).toEqual(expected)
  })
})

describe('settlement period bounds', () => {
  // Norsk tid: sommertid er UTC+2, vintertid UTC+1. Månedens første salg
  // klokka 00:30 den 1. skal inn i den måneden, ikke den forrige.
  it('starts and ends the month at Norwegian midnight', () => {
    expect(periodBounds({ start: '2026-08-01', end: '2026-08-31' })).toEqual({
      from: '2026-07-31T22:00:00.000Z',
      to: '2026-08-31T21:59:59.999Z',
    })
    expect(periodBounds({ start: '2026-01-01', end: '2026-01-31' })).toEqual({
      from: '2025-12-31T23:00:00.000Z',
      to: '2026-01-31T22:59:59.999Z',
    })
  })

  it('spans the switch to and from summer time', () => {
    expect(periodBounds({ start: '2026-03-01', end: '2026-03-31' })).toEqual({
      from: '2026-02-28T23:00:00.000Z',
      to: '2026-03-31T21:59:59.999Z',
    })
    expect(periodBounds({ start: '2026-10-01', end: '2026-10-31' })).toEqual({
      from: '2026-09-30T22:00:00.000Z',
      to: '2026-10-31T22:59:59.999Z',
    })
  })

  it('parses a manual rerun period and rejects anything else', () => {
    expect(parseMonthPeriod('2026-02')).toEqual(monthPeriod(2026, 2))
    expect(monthPeriod(2026, 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(parseMonthPeriod('2026-13')).toBeNull()
    expect(parseMonthPeriod('2026-2')).toBeNull()
    expect(parseMonthPeriod('')).toBeNull()
    expect(parseMonthPeriod(null)).toBeNull()
  })
})

describe('settlement refunds', () => {
  it('takes what went back to the buyer minus the commission Tickethalo returned', () => {
    expect(refundedClubAmount({ club_net_amount: 45_000, refunded_amount: 50_000, application_fee_refunded_amount: 5_000 })).toBe(
      45_000,
    )
  })

  it('charges the club the kept commission when a dashboard refund did not return it', () => {
    // Samme tap som utbetalingen trekker: klubben betalte provisjon på et salg som ble borte.
    expect(refundedClubAmount({ club_net_amount: 45_000, refunded_amount: 50_000, application_fee_refunded_amount: 0 })).toBe(
      50_000,
    )
  })

  it('charges a lost dispute as the loss the club actually took, not as an ordinary refund', () => {
    // Stripe trakk 200 kr og 150 kr i gebyr; ordren står som refundert uten
    // refunded_amount (refunds.ts: «pengene gikk tilbake gjennom disputten»).
    expect(
      refundedClubAmount({ club_net_amount: 18_000, refunded_amount: 0, application_fee_refunded_amount: 0, dispute_net_amount: 35_000 }),
    ).toBe(35_000)
  })

  it('falls back to the club share for refunded orders without a refunded amount', () => {
    expect(refundedClubAmount({ club_net_amount: 45_000, refunded_amount: 0, application_fee_refunded_amount: 0 })).toBe(45_000)
    expect(refundedClubAmount({ club_net_amount: null, refunded_amount: null, application_fee_refunded_amount: null })).toBe(0)
  })
})
