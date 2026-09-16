// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  WEBHOOK_SECRET_ENV_VARS,
  isFeeReportType,
  malformedWebhookSecretNames,
  routeFor,
} from '@/app/api/webhooks/stripe/routing'

describe('stripe webhook routing', () => {
  it.each([
    ['checkout.session.completed', 'checkout_completed'],
    ['checkout.session.async_payment_succeeded', 'checkout_completed'],
    ['checkout.session.async_payment_failed', 'checkout_async_failed'],
    ['charge.refunded', 'charge_refunded'],
    ['charge.dispute.created', 'dispute'],
    ['charge.dispute.updated', 'dispute'],
    ['charge.dispute.closed', 'dispute'],
    ['charge.dispute.funds_withdrawn', 'dispute'],
    ['charge.dispute.funds_reinstated', 'dispute'],
    ['payment_intent.payment_failed', 'payment_failed'],
    ['payout.created', 'payout'],
    ['payout.updated', 'payout'],
    ['payout.paid', 'payout'],
    ['payout.failed', 'payout'],
    ['payout.canceled', 'payout'],
    ['account.updated', 'account'],
    ['balance_settings.updated', 'balance_settings'],
    ['reporting.report_run.succeeded', 'report_run'],
  ] as const)('routes %s to %s', (eventType, route) => {
    expect(routeFor(eventType)).toBe(route)
  })

  it('no longer settles fees per charge', () => {
    // Plattformen betaler Stripe-gebyret; true-up-oppgjøret er fjernet.
    expect(routeFor('charge.succeeded')).toBe('ignored')
  })

  it.each([
    'checkout.session.expired',
    'payout.reconciliation_completed',
    'reporting.report_run.failed',
    'application_fee.refunded',
    'payment_intent.succeeded',
    'v2.core.account.updated',
    '',
    'constructor',
    'toString',
    '__proto__',
  ])('ignores %j', (eventType) => {
    expect(routeFor(eventType)).toBe('ignored')
  })
})

describe('fee report detection', () => {
  it.each(['all_fees.itemized.1', 'all_fees.summary.1'])('accepts %s', (reportType) => {
    expect(isFeeReportType(reportType)).toBe(true)
  })

  it.each(['balance.summary.1', 'balance_change_from_activity.itemized.3', 'all_fees', 'xall_fees.itemized.1', '', null, undefined])(
    'rejects %j',
    (reportType) => {
      expect(isFeeReportType(reportType)).toBe(false)
    },
  )
})

describe('webhook secret sanity check', () => {
  it('checks both endpoints', () => {
    expect(WEBHOOK_SECRET_ENV_VARS).toEqual(['STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET'])
  })

  it('accepts signing secrets and missing values', () => {
    expect(malformedWebhookSecretNames({})).toEqual([])
    expect(
      malformedWebhookSecretNames({ STRIPE_WEBHOOK_SECRET: 'whsec_abc', STRIPE_CONNECT_WEBHOOK_SECRET: '' }),
    ).toEqual([])
    expect(malformedWebhookSecretNames({ STRIPE_CONNECT_WEBHOOK_SECRET: '  whsec_abc  ' })).toEqual([])
  })

  it('names secrets that can never verify a signature, without their values', () => {
    const names = malformedWebhookSecretNames({
      STRIPE_WEBHOOK_SECRET: 'sk_test_123',
      STRIPE_CONNECT_WEBHOOK_SECRET: 'rk_live_secret',
      UNRELATED: 'nope',
    })
    expect(names).toEqual(['STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET'])
    expect(names.join(' ')).not.toContain('sk_test_123')
  })

  it('treats whitespace-only values as unset', () => {
    expect(malformedWebhookSecretNames({ STRIPE_WEBHOOK_SECRET: '   ' })).toEqual([])
  })
})
