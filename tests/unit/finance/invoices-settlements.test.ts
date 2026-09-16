import { describe, expect, it } from 'vitest'
import {
  buildFeeInvoiceReference,
  clubInvoiceRecipient,
  formatMinor,
  normalizeFeeInvoiceReference,
} from '@/lib/fee-invoices'
import { previousMonthPeriod } from '@/lib/settlements'

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
