// @vitest-environment node
import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import {
  PAYOUT_FAILURE_HOLD_DAYS,
  availablePayoutBalance,
  canAdvancePayoutStatus,
  isDefinitivePayoutError,
  mapStripePayoutStatus,
  payoutFailureHoldReason,
  payoutIdempotencyKey,
  payoutRowPatch,
  payoutScheduleSkipReason,
  type LatestPayout,
  type StripePayoutFacts,
} from '@/lib/payouts'

const NOW = new Date('2026-09-16T06:30:00.000Z')
const EARLIER = '2026-09-10T08:00:00.000Z'

/** 18. september 2026 00:00 UTC, slik Stripe setter `arrival_date`. */
const ARRIVAL = Date.UTC(2026, 8, 18) / 1000

const payout = (overrides: Partial<StripePayoutFacts> = {}): StripePayoutFacts => ({
  id: 'po_123',
  status: 'pending',
  arrival_date: ARRIVAL,
  failure_code: null,
  failure_message: null,
  ...overrides,
})

const stripeError = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  message: 'Stripe said no',
  ...extra,
})

describe('mapStripePayoutStatus', () => {
  it.each([
    ['pending', 'pending'],
    ['in_transit', 'in_transit'],
    ['paid', 'paid'],
    ['failed', 'failed'],
    ['canceled', 'cancelled'],
  ] as const)('maps Stripe %s to %s', (stripeStatus, expected) => {
    expect(mapStripePayoutStatus(stripeStatus)).toBe(expected)
  })

  it.each(['cancelled', 'reversed', 'something_new', '', null, undefined])(
    'treats unknown status %s as pending, never paid',
    (status) => {
      expect(mapStripePayoutStatus(status)).toBe('pending')
    },
  )
})

describe('isDefinitivePayoutError', () => {
  it.each(['StripeInvalidRequestError', 'StripePermissionError', 'StripeAuthenticationError'])(
    'releases the reservation when Stripe rejects with %s',
    (type) => {
      expect(isDefinitivePayoutError(stripeError(type, { code: 'balance_insufficient', statusCode: 400 }))).toBe(true)
    },
  )

  it.each(['idempotency_key_in_use', 'rate_limit', 'lock_timeout'])(
    'keeps the reservation for an invalid request with retryable code %s',
    (code) => {
      expect(isDefinitivePayoutError(stripeError('StripeInvalidRequestError', { code }))).toBe(false)
    },
  )

  it.each([409, 429])('keeps the reservation for HTTP %i', (statusCode) => {
    expect(isDefinitivePayoutError(stripeError('StripeInvalidRequestError', { statusCode }))).toBe(false)
  })

  it.each([
    'StripeConnectionError',
    'StripeAPIError',
    'StripeRateLimitError',
    'StripeIdempotencyError',
    'StripeCardError',
  ])('keeps the reservation when the outcome is unknown (%s)', (type) => {
    expect(isDefinitivePayoutError(stripeError(type))).toBe(false)
  })

  it.each([new Error('socket hang up'), 'boom', null, undefined, 42, {}])(
    'keeps the reservation for non-Stripe error %s',
    (error) => {
      expect(isDefinitivePayoutError(error)).toBe(false)
    },
  )

  it('classifies the SDK error classes the same way as the duck-typed shape', () => {
    const rejected = new Stripe.errors.StripeInvalidRequestError({
      message: 'You have insufficient funds in your Stripe account.',
      code: 'balance_insufficient',
    })
    const inUse = new Stripe.errors.StripeInvalidRequestError({ message: 'In use', code: 'idempotency_key_in_use' })
    const offline = new Stripe.errors.StripeConnectionError({ message: 'Network down' })

    expect(isDefinitivePayoutError(rejected)).toBe(true)
    expect(isDefinitivePayoutError(inUse)).toBe(false)
    expect(isDefinitivePayoutError(offline)).toBe(false)
  })
})

describe('payoutIdempotencyKey', () => {
  it('is derived only from the payout row', () => {
    const rowId = '0b3f0e0e-5a3c-4d8e-9d59-1f1f1f1f1f1f'
    expect(payoutIdempotencyKey(rowId)).toBe(`club-payout-${rowId}`)
    expect(payoutIdempotencyKey(rowId)).toBe(payoutIdempotencyKey(rowId))
  })

  it('differs between rows', () => {
    expect(payoutIdempotencyKey('row-a')).not.toBe(payoutIdempotencyKey('row-b'))
  })
})

describe('payoutRowPatch', () => {
  it('records a pending payout without marking it paid', () => {
    expect(payoutRowPatch(payout(), NOW)).toEqual({
      status: 'pending',
      stripe_payout_id: 'po_123',
      arrival_date: '2026-09-18',
      failure_code: null,
      failure_reason: null,
      status_synced_at: NOW.toISOString(),
    })
  })

  it('records an in-transit payout with its expected arrival', () => {
    const patch = payoutRowPatch(payout({ status: 'in_transit' }), NOW)
    expect(patch).toMatchObject({ status: 'in_transit', arrival_date: '2026-09-18' })
    expect(patch).not.toHaveProperty('paid_at')
  })

  it('converts arrival dates in UTC, not local time', () => {
    const lastSecondOfDay = Date.UTC(2026, 8, 18, 23, 59, 59) / 1000
    expect(payoutRowPatch(payout({ arrival_date: lastSecondOfDay }), NOW).arrival_date).toBe('2026-09-18')
  })

  it('leaves the arrival date empty when Stripe has none', () => {
    expect(payoutRowPatch(payout({ arrival_date: 0 }), NOW).arrival_date).toBeNull()
  })

  it('stamps paid_at the first time Stripe reports paid', () => {
    const patch = payoutRowPatch(payout({ status: 'paid' }), NOW, { paid_at: null, failed_at: null, cancelled_at: null })
    expect(patch).toMatchObject({ status: 'paid', paid_at: NOW.toISOString() })
  })

  it('keeps an existing paid_at when the same status arrives again', () => {
    const patch = payoutRowPatch(payout({ status: 'paid' }), NOW, { paid_at: EARLIER, failed_at: null, cancelled_at: null })
    expect(patch.paid_at).toBe(EARLIER)
    expect(patch.status_synced_at).toBe(NOW.toISOString())
  })

  it('records a paid payout that later failed, without touching paid_at', () => {
    const patch = payoutRowPatch(
      payout({ status: 'failed', failure_code: 'account_closed', failure_message: 'The bank account has been closed.' }),
      NOW,
      { paid_at: EARLIER, failed_at: null, cancelled_at: null },
    )

    expect(patch).toMatchObject({
      status: 'failed',
      failure_code: 'account_closed',
      failure_reason: 'The bank account has been closed.',
      failed_at: NOW.toISOString(),
    })
    // Utelatt = databasen beholder verdien.
    expect(patch).not.toHaveProperty('paid_at')
  })

  it('keeps the first failed_at on repeated failure events', () => {
    const patch = payoutRowPatch(payout({ status: 'failed' }), NOW, { paid_at: null, failed_at: EARLIER, cancelled_at: null })
    expect(patch.failed_at).toBe(EARLIER)
  })

  it('maps a canceled payout to cancelled with cancelled_at', () => {
    const patch = payoutRowPatch(payout({ status: 'canceled' }), NOW)
    expect(patch).toMatchObject({ status: 'cancelled', cancelled_at: NOW.toISOString() })
    expect(patch).not.toHaveProperty('paid_at')
    expect(patch).not.toHaveProperty('failed_at')
  })
})

describe('canAdvancePayoutStatus', () => {
  it.each([
    ['creating', 'pending'],
    ['creating', 'failed'],
    ['pending', 'in_transit'],
    ['pending', 'cancelled'],
    ['in_transit', 'paid'],
    ['paid', 'failed'],
    ['paid', 'paid'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canAdvancePayoutStatus(from, to)).toBe(true)
  })

  it.each([
    ['in_transit', 'pending'],
    ['paid', 'in_transit'],
    ['paid', 'pending'],
    ['failed', 'paid'],
    ['cancelled', 'pending'],
    ['pending', 'creating'],
  ] as const)('blocks a stale %s → %s', (from, to) => {
    expect(canAdvancePayoutStatus(from, to)).toBe(false)
  })
})

describe('availablePayoutBalance', () => {
  it('uses only the club currency', () => {
    const balance = {
      available: [
        { amount: 50_000, currency: 'eur' },
        { amount: 120_000, currency: 'nok' },
      ],
    }
    expect(availablePayoutBalance(balance, 'NOK')).toBe(120_000)
  })

  it('returns zero when the currency has no balance', () => {
    expect(availablePayoutBalance({ available: [{ amount: 50_000, currency: 'eur' }] }, 'nok')).toBe(0)
  })

  it('uses the card balance manual payouts draw from', () => {
    const balance = {
      available: [{ amount: 120_000, currency: 'nok', source_types: { card: 100_000, bank_account: 20_000 } }],
    }
    expect(availablePayoutBalance(balance, 'nok')).toBe(100_000)
  })

  it('never returns a negative amount', () => {
    expect(availablePayoutBalance({ available: [{ amount: -5_000, currency: 'nok' }] }, 'nok')).toBe(0)
  })
})

describe('payoutScheduleSkipReason', () => {
  it('releases clubs on a manual schedule', () => {
    expect(payoutScheduleSkipReason('manual')).toBeNull()
  })

  it.each(['daily', 'weekly', 'monthly'])('skips clubs Stripe pays out automatically (%s)', (interval) => {
    expect(payoutScheduleSkipReason(interval)).toContain(interval)
  })

  it('skips clubs whose schedule has not been confirmed', () => {
    expect(payoutScheduleSkipReason(null)).toMatch(/not confirmed/)
  })
})

describe('payoutFailureHoldReason', () => {
  const failed = (overrides: Partial<LatestPayout> = {}): LatestPayout => ({
    status: 'failed',
    stripe_payout_id: 'po_123',
    failure_code: 'account_closed',
    failure_reason: 'The bank account has been closed.',
    failed_at: '2026-09-15T06:30:00.000Z',
    updated_at: '2026-09-15T06:30:00.000Z',
    ...overrides,
  })

  it('does not hold a club without payouts', () => {
    expect(payoutFailureHoldReason(null, NOW)).toBeNull()
  })

  it.each(['creating', 'pending', 'in_transit', 'paid', 'cancelled'] as const)(
    'does not hold when the latest payout is %s',
    (status) => {
      expect(payoutFailureHoldReason(failed({ status }), NOW)).toBeNull()
    },
  )

  it('holds a club whose latest payout failed at the bank recently', () => {
    const reason = payoutFailureHoldReason(failed(), NOW)
    expect(reason).toContain('The bank account has been closed.')
    expect(reason).toContain('bank details')
    expect(reason).toContain('2026-09-18')
  })

  it('explains a rejected request differently from a bank failure', () => {
    const reason = payoutFailureHoldReason(
      failed({ stripe_payout_id: null, failure_reason: 'Insufficient funds', failure_code: 'balance_insufficient' }),
      NOW,
    )
    expect(reason).toMatch(/rejected the last payout request/)
  })

  it(`releases the hold after ${PAYOUT_FAILURE_HOLD_DAYS} days`, () => {
    const failedAt = new Date(NOW.getTime() - PAYOUT_FAILURE_HOLD_DAYS * 24 * 60 * 60 * 1000).toISOString()
    expect(payoutFailureHoldReason(failed({ failed_at: failedAt }), NOW)).toBeNull()
  })

  it('falls back to updated_at when failed_at is missing', () => {
    expect(payoutFailureHoldReason(failed({ failed_at: null, updated_at: '2026-09-16T00:00:00.000Z' }), NOW)).not.toBeNull()
    expect(payoutFailureHoldReason(failed({ failed_at: null, updated_at: '2026-09-01T00:00:00.000Z' }), NOW)).toBeNull()
  })
})
