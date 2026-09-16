// @vitest-environment node
import type Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import {
  ALL_FEES_REPORT_TYPE,
  buildFeeEntries,
  feeEntryRowKey,
  isReportUnavailableError,
  nextFeeReportInterval,
  parseCsv,
  parseFeesReport,
  reportTimestampToIso,
  sumFeesByCharge,
  toMinorUnits,
  toPlatformBalanceTransaction,
  type ApplicationFeeLink,
  type FeesReportRow,
} from '@/lib/stripe-fees'

/**
 * Utdrag av en Fees report (all_fees.balance_transaction_created.itemized.2)
 * kjørt med Etc/UTC. ch_3Club1 har gebyret som én linje inkl. mva; ch_3Club2
 * har det samme gebyret delt i gebyr og en egen mva-linje, slik
 * balansetransaksjonene på plattformen viser det (−6,78 og −1,69). `suite` er
 * en kolonne vi ikke ber om og skal ignoreres.
 */
const FIXTURE = [
  'balance_transaction_id,balance_transaction_created,fee_transaction_id,incurred_at,incurred_by,incurred_by_type,amount,tax,currency,product,feature_name,fee_description,suite',
  'txn_1Card,2026-08-24 14:41:07,,2026-08-24 12:00:05,ch_3Club1,charge,8.47,1.69,nok,Payments,card_payments,Card payment fee,Payments',
  'txn_1Card,2026-08-24 14:41:07,,2026-08-24 12:10:00,ch_3Club2,charge,6.78,0.00,nok,Payments,card_payments,"Card payments, domestic",Payments',
  'txn_1Vat,2026-08-24 14:41:08,,2026-08-24 12:10:00,ch_3Club2,charge,1.69,1.69,nok,Payments,tax,VAT on Stripe fees,Payments',
  'txn_1Payout,2026-08-25 06:00:00,,2026-08-25 05:59:00,po_1Payout,payout,2.50,0.50,nok,Connect,payouts,"Payout fee, ""standard""",Connect',
  '',
].join('\r\n')

describe('parseCsv', () => {
  it('splits plain rows and ignores a trailing newline', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('keeps commas, newlines and escaped quotes inside quoted fields', () => {
    expect(parseCsv('name,description\nfee,"Card, domestic ""EEA""\nsecond line"\n')).toEqual([
      ['name', 'description'],
      ['fee', 'Card, domestic "EEA"\nsecond line'],
    ])
  })

  it('keeps empty fields, including a trailing empty field', () => {
    expect(parseCsv('a,,c,\n"",x,,')).toEqual([
      ['a', '', 'c', ''],
      ['', 'x', '', ''],
    ])
  })

  it('strips a byte order mark and parses a last row without newline', () => {
    expect(parseCsv('﻿amount,currency\n8.47,nok')).toEqual([
      ['amount', 'currency'],
      ['8.47', 'nok'],
    ])
  })

  it('returns no rows for empty input', () => {
    expect(parseCsv('')).toEqual([])
  })

  it('rejects an unterminated quoted field', () => {
    expect(() => parseCsv('a,"open\n1,2')).toThrow(/unterminated/)
  })
})

describe('parseFeesReport', () => {
  it('reads rows by header name and ignores unknown columns', () => {
    const rows = parseFeesReport(FIXTURE)

    expect(rows).toHaveLength(4)
    expect(rows[0]).toEqual({
      balance_transaction_id: 'txn_1Card',
      balance_transaction_created: '2026-08-24 14:41:07',
      fee_transaction_id: null,
      incurred_at: '2026-08-24 12:00:05',
      incurred_by: 'ch_3Club1',
      incurred_by_type: 'charge',
      amount: '8.47',
      tax: '1.69',
      currency: 'nok',
      product: 'Payments',
      feature_name: 'card_payments',
      fee_description: 'Card payment fee',
    })
    expect(rows[0]).not.toHaveProperty('suite')
    expect(rows[1].fee_description).toBe('Card payments, domestic')
    expect(rows[3].fee_description).toBe('Payout fee, "standard"')
  })

  it('sets missing optional columns to null', () => {
    expect(parseFeesReport('currency,amount\nnok,1.00\n')).toEqual([
      {
        balance_transaction_id: null,
        balance_transaction_created: null,
        fee_transaction_id: null,
        incurred_at: null,
        incurred_by: null,
        incurred_by_type: null,
        amount: '1.00',
        tax: null,
        currency: 'nok',
        product: null,
        feature_name: null,
        fee_description: null,
      },
    ])
  })

  it('skips blank lines', () => {
    expect(parseFeesReport('amount,currency\n\n1.00,nok\n\n')).toHaveLength(1)
  })

  it('returns nothing for an empty file', () => {
    expect(parseFeesReport('')).toEqual([])
  })

  it('fails loudly when amount or currency is missing', () => {
    expect(() => parseFeesReport('incurred_by,currency\nch_1,nok\n')).toThrow(/"amount" column/)
    expect(() => parseFeesReport('amount,currency\n,nok\n')).toThrow(/line 2/)
  })
})

describe('toMinorUnits', () => {
  it.each([
    ['8.47', 'NOK', 847],
    ['1.69', 'nok', 169],
    ['1234', 'NOK', 123400],
    ['-0.5', 'NOK', -50],
    ['0.07', 'EUR', 7],
    ['.5', 'USD', 50],
    ['12.', 'USD', 1200],
    ['+3.10', 'SEK', 310],
    ['1234', 'JPY', 1234],
    ['1.234', 'KWD', 1234],
    ['0.1', 'BHD', 100],
  ])('converts %s %s to %i', (major, currency, expected) => {
    expect(toMinorUnits(major, currency)).toBe(expected)
  })

  it('does not drift on values that are inexact as floats', () => {
    expect(toMinorUnits('1.005', 'NOK')).toBe(101)
    expect(toMinorUnits('0.29', 'NOK')).toBe(29)
    expect(toMinorUnits('4.35', 'NOK')).toBe(435)
    expect(toMinorUnits('123456789.99', 'NOK')).toBe(12345678999)
  })

  it('rounds extra decimals half away from zero', () => {
    expect(toMinorUnits('12.5', 'JPY')).toBe(13)
    expect(toMinorUnits('12.49', 'JPY')).toBe(12)
    expect(toMinorUnits('-8.475', 'NOK')).toBe(-848)
    expect(toMinorUnits('8.4749', 'NOK')).toBe(847)
  })

  it('never returns negative zero', () => {
    expect(Object.is(toMinorUnits('-0.004', 'NOK'), 0)).toBe(true)
    expect(Object.is(toMinorUnits('-0', 'NOK'), 0)).toBe(true)
  })

  it.each(['', ' ', '-', '.', 'abc', '1,234.00', '1e3', '8.47 NOK'])('rejects %j', (value) => {
    expect(() => toMinorUnits(value, 'NOK')).toThrow(/Invalid amount/)
  })
})

describe('reportTimestampToIso', () => {
  it('treats zone-less report timestamps as UTC', () => {
    expect(reportTimestampToIso('2026-08-24 14:41:07')).toBe('2026-08-24T14:41:07.000Z')
    expect(reportTimestampToIso('2026-08-24T14:41')).toBe('2026-08-24T14:41:00.000Z')
  })

  it('accepts dates, Unix seconds and zoned timestamps', () => {
    expect(reportTimestampToIso('2026-08-24')).toBe('2026-08-24T00:00:00.000Z')
    expect(reportTimestampToIso('1787582467')).toBe(new Date(1787582467 * 1000).toISOString())
    expect(reportTimestampToIso('2026-08-24T16:41:07+02:00')).toBe('2026-08-24T14:41:07.000Z')
  })

  it('returns null for empty values and throws on garbage', () => {
    expect(reportTimestampToIso(null)).toBeNull()
    expect(() => reportTimestampToIso('yesterday')).toThrow(/Invalid timestamp/)
  })
})

describe('feeEntryRowKey', () => {
  const [row] = parseFeesReport(FIXTURE)

  it('is a stable sha256 hex digest', () => {
    expect(feeEntryRowKey(row, 0)).toMatch(/^[0-9a-f]{64}$/)
    expect(feeEntryRowKey({ ...row }, 0)).toBe(feeEntryRowKey(row, 0))
  })

  it('differs by occurrence and by identifying fields', () => {
    expect(feeEntryRowKey(row, 1)).not.toBe(feeEntryRowKey(row, 0))
    expect(feeEntryRowKey({ ...row, amount: '8.48' }, 0)).not.toBe(feeEntryRowKey(row, 0))
    expect(feeEntryRowKey({ ...row, incurred_by: 'ch_other' }, 0)).not.toBe(feeEntryRowKey(row, 0))
  })

  it('ignores currency casing', () => {
    expect(feeEntryRowKey({ ...row, currency: 'NOK' }, 0)).toBe(feeEntryRowKey(row, 0))
  })
})

describe('buildFeeEntries', () => {
  it('converts report lines to stored entries in minor units', () => {
    const entries = buildFeeEntries(parseFeesReport(FIXTURE), 'frr_1')

    expect(entries).toHaveLength(4)
    expect(entries[0]).toEqual({
      row_key: expect.stringMatching(/^[0-9a-f]{64}$/),
      report_run_id: 'frr_1',
      balance_transaction_id: 'txn_1Card',
      fee_transaction_id: null,
      incurred_by: 'ch_3Club1',
      incurred_by_type: 'charge',
      incurred_at: '2026-08-24T12:00:05.000Z',
      amount: 847,
      tax_amount: 169,
      currency: 'NOK',
      product: 'Payments',
      feature_name: 'card_payments',
      fee_description: 'Card payment fee',
    })
    expect(entries[0]).not.toHaveProperty('order_id')
    expect(entries.map((entry) => entry.amount)).toEqual([847, 678, 169, 250])
    expect(new Set(entries.map((entry) => entry.row_key)).size).toBe(4)
  })

  it('defaults missing tax to zero', () => {
    const [entry] = buildFeeEntries(parseFeesReport('amount,currency,incurred_by,incurred_by_type\n3.00,nok,ch_1,charge\n'), 'frr_1')
    expect(entry.tax_amount).toBe(0)
  })

  it('keeps identical duplicate lines as separate entries', () => {
    const line = 'ch_1,charge,1.00,0.00,nok,Card fee'
    const report = `incurred_by,incurred_by_type,amount,tax,currency,fee_description\n${line}\n${line}\n`
    const entries = buildFeeEntries(parseFeesReport(report), 'frr_1')

    expect(entries).toHaveLength(2)
    expect(entries[0].row_key).not.toBe(entries[1].row_key)
  })

  it('gives the same keys when an overlapping run reports the same lines', () => {
    const first = buildFeeEntries(parseFeesReport(FIXTURE), 'frr_1').map((entry) => entry.row_key)
    const second = buildFeeEntries(parseFeesReport(FIXTURE), 'frr_2').map((entry) => entry.row_key)
    expect(second).toEqual(first)
  })

  it('fails on an unparseable amount instead of dropping the fee', () => {
    const rows: FeesReportRow[] = parseFeesReport('amount,currency\n1.00,nok\n')
    expect(() => buildFeeEntries([{ ...rows[0], amount: 'n/a' }], 'frr_1')).toThrow(/Invalid amount/)
  })
})

describe('sumFeesByCharge', () => {
  it('sums fee and tax per charge and skips non-charge lines', () => {
    const totals = sumFeesByCharge(buildFeeEntries(parseFeesReport(FIXTURE), 'frr_1'))

    expect(totals.get('ch_3Club1')).toEqual({ amount: 847, tax: 169, currency: 'NOK', lines: 1 })
    // Gebyr og egen mva-linje summerer til det samme som én linje inkl. mva.
    expect(totals.get('ch_3Club2')).toEqual({ amount: 847, tax: 169, currency: 'NOK', lines: 2 })
    expect(totals.has('po_1Payout')).toBe(false)
    expect(totals.size).toBe(2)
  })

  it('includes negative adjustments and treats missing tax as zero', () => {
    const totals = sumFeesByCharge([
      { incurred_by: 'ch_1', incurred_by_type: 'charge', amount: 500, tax_amount: 100, currency: 'NOK' },
      { incurred_by: 'ch_1', incurred_by_type: 'charge', amount: -50, tax_amount: null, currency: 'nok' },
      { incurred_by: null, incurred_by_type: 'charge', amount: 999, currency: 'NOK' },
    ])

    expect(totals.get('ch_1')).toEqual({ amount: 450, tax: 100, currency: 'NOK', lines: 2 })
    expect(totals.size).toBe(1)
  })

  it('flags mixed currencies for the same charge', () => {
    const totals = sumFeesByCharge([
      { incurred_by: 'ch_1', incurred_by_type: 'charge', amount: 500, currency: 'NOK' },
      { incurred_by: 'ch_1', incurred_by_type: 'charge', amount: 40, currency: 'EUR' },
      { incurred_by: 'ch_1', incurred_by_type: 'charge', amount: 10, currency: 'NOK' },
    ])

    expect(totals.get('ch_1')?.currency).toBeNull()
  })
})

describe('nextFeeReportInterval', () => {
  const day = 86_400
  const available = { dataAvailableStart: 1_780_000_000, dataAvailableEnd: 1_780_000_000 + 30 * day }

  it('continues from the last processed run, at most seven days', () => {
    const lastProcessedEnd = available.dataAvailableStart + 10 * day
    expect(nextFeeReportInterval({ ...available, lastProcessedEnd, oldestPendingOrderAt: 1 })).toEqual({
      start: lastProcessedEnd,
      end: lastProcessedEnd + 7 * day,
    })
  })

  it('stops at data_available_end', () => {
    const lastProcessedEnd = available.dataAvailableEnd - day
    expect(nextFeeReportInterval({ ...available, lastProcessedEnd, oldestPendingOrderAt: null })).toEqual({
      start: lastProcessedEnd,
      end: available.dataAvailableEnd,
    })
  })

  it('starts at the UTC day of the oldest pending order on the first run', () => {
    const orderAt = Date.parse('2026-06-10T21:30:00Z') / 1000
    const result = nextFeeReportInterval({
      lastProcessedEnd: null,
      oldestPendingOrderAt: orderAt,
      dataAvailableStart: Date.parse('2026-01-01T00:00:00Z') / 1000,
      dataAvailableEnd: Date.parse('2026-09-12T00:00:00Z') / 1000,
    })

    expect(result).toEqual({
      start: Date.parse('2026-06-10T00:00:00Z') / 1000,
      end: Date.parse('2026-06-17T00:00:00Z') / 1000,
    })
  })

  it('clamps to data_available_start', () => {
    expect(
      nextFeeReportInterval({ ...available, lastProcessedEnd: null, oldestPendingOrderAt: available.dataAvailableStart - 40 * day }),
    ).toEqual({ start: available.dataAvailableStart, end: available.dataAvailableStart + 7 * day })

    expect(nextFeeReportInterval({ ...available, lastProcessedEnd: null, oldestPendingOrderAt: null })?.start).toBe(
      available.dataAvailableStart,
    )
  })

  it('returns null when Stripe has no newer data', () => {
    expect(
      nextFeeReportInterval({ ...available, lastProcessedEnd: available.dataAvailableEnd, oldestPendingOrderAt: null }),
    ).toBeNull()
    expect(
      nextFeeReportInterval({ ...available, lastProcessedEnd: available.dataAvailableEnd + day, oldestPendingOrderAt: null }),
    ).toBeNull()
  })
})

describe('toPlatformBalanceTransaction', () => {
  const syncedAt = '2026-09-16T05:00:00.000Z'
  const base = {
    object: 'balance_transaction',
    fee: 0,
    fee_details: [],
    exchange_rate: null,
    status: 'available',
    created: 1_787_582_467,
    available_on: 1_787_702_400,
  }

  it('maps a daily Stripe fee batch without a source', () => {
    const transaction = {
      ...base,
      id: 'txn_1Fee',
      type: 'stripe_fee',
      reporting_category: 'fee',
      amount: -678,
      net: -678,
      currency: 'nok',
      source: null,
      description: 'Card (2026-08-24)',
    } as unknown as Stripe.BalanceTransaction

    expect(toPlatformBalanceTransaction(transaction, new Map(), syncedAt)).toEqual({
      id: 'txn_1Fee',
      type: 'stripe_fee',
      reporting_category: 'fee',
      amount: -678,
      fee: 0,
      net: -678,
      currency: 'NOK',
      source_id: null,
      description: 'Card (2026-08-24)',
      connected_account_id: null,
      charge_id: null,
      created_at_stripe: new Date(1_787_582_467 * 1000).toISOString(),
      available_on: new Date(1_787_702_400 * 1000).toISOString(),
      synced_at: syncedAt,
    })
  })

  it('links application fees and fee refunds to club and charge', () => {
    const links = new Map<string, ApplicationFeeLink>([
      ['fee_1', { connectedAccountId: 'acct_1U80L52MJ1TrM8Nl', chargeId: 'ch_3Club1' }],
    ])

    const commission = toPlatformBalanceTransaction(
      {
        ...base,
        id: 'txn_1Commission',
        type: 'application_fee',
        reporting_category: 'platform_earning',
        amount: 1990,
        net: 1990,
        currency: 'nok',
        source: { id: 'fee_1', object: 'application_fee' },
        description: null,
      } as unknown as Stripe.BalanceTransaction,
      links,
      syncedAt,
    )

    expect(commission).toMatchObject({
      source_id: 'fee_1',
      connected_account_id: 'acct_1U80L52MJ1TrM8Nl',
      charge_id: 'ch_3Club1',
    })

    const refund = toPlatformBalanceTransaction(
      {
        ...base,
        id: 'txn_1CommissionRefund',
        type: 'application_fee_refund',
        reporting_category: 'platform_earning_refund',
        amount: -1990,
        net: -1990,
        currency: 'nok',
        source: { id: 'fr_1', object: 'fee_refund', fee: 'fee_1' },
        description: null,
      } as unknown as Stripe.BalanceTransaction,
      links,
      syncedAt,
    )

    expect(refund).toMatchObject({
      source_id: 'fr_1',
      connected_account_id: 'acct_1U80L52MJ1TrM8Nl',
      charge_id: 'ch_3Club1',
    })
  })
})

describe('isReportUnavailableError', () => {
  it.each([
    [{ statusCode: 404, code: 'resource_missing', message: 'No such report type' }],
    [{ statusCode: 403, message: 'Forbidden' }],
    [{ type: 'StripePermissionError', message: 'Not allowed' }],
    [{ statusCode: 400, message: 'This report type requires a live mode API key.' }],
  ])('treats %j as unavailable', (error) => {
    expect(isReportUnavailableError(Object.assign(new Error(error.message), error))).toBe(true)
  })

  it('does not swallow other errors', () => {
    expect(isReportUnavailableError(Object.assign(new Error('Rate limited'), { statusCode: 429 }))).toBe(false)
    expect(isReportUnavailableError(new Error('socket hang up'))).toBe(false)
  })

  it('uses the balance-transaction pivot of the itemized fees report', () => {
    expect(ALL_FEES_REPORT_TYPE).toBe('all_fees.balance_transaction_created.itemized.2')
  })
})
