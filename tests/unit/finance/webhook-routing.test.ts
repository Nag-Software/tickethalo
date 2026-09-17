// @vitest-environment node
import Stripe from 'stripe'
import { describe, expect, it } from 'vitest'
import {
  WEBHOOK_SECRET_ENV_VARS,
  isFeeReportType,
  malformedWebhookSecretNames,
  routeFor,
  verifyWebhookEvent,
} from '@/app/api/webhooks/stripe/routing'

describe('stripe webhook routing', () => {
  it.each([
    ['checkout.session.completed', 'checkout_completed'],
    ['checkout.session.async_payment_succeeded', 'checkout_completed'],
    ['checkout.session.async_payment_failed', 'checkout_async_failed'],
    ['charge.refunded', 'charge_refunded'],
    ['refund.updated', 'refund'],
    ['refund.failed', 'refund'],
    ['charge.refund.updated', 'refund'],
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
    // Opprettelsen dekkes av `charge.refunded`; bare statusendringer følges.
    'refund.created',
    '',
    'constructor',
    'toString',
    '__proto__',
  ])('ignores %j', (eventType) => {
    expect(routeFor(eventType)).toBe('ignored')
  })
})

describe('webhook signature verification', () => {
  // Ekte SDK, uten nettverk: signering og verifisering er ren HMAC.
  const stripe = new Stripe('sk_test_offline')
  const PLATFORM_SECRET = 'whsec_platform'
  const CONNECT_SECRET = 'whsec_connect'

  const isSignatureError = (error: unknown) => error instanceof Stripe.errors.StripeSignatureVerificationError

  const verify = (body: string, signedWith: string, secrets: readonly string[]) => {
    const header = stripe.webhooks.generateTestHeaderString({ payload: body, secret: signedWith })
    return verifyWebhookEvent(
      body,
      secrets,
      (secret) => stripe.webhooks.constructEvent(body, header, secret),
      isSignatureError,
    )
  }

  const snapshotEvent = JSON.stringify({
    id: 'evt_snapshot',
    object: 'event',
    type: 'checkout.session.completed',
    account: 'acct_club',
    data: { object: { id: 'cs_123', object: 'checkout.session' } },
  })

  const thinEvent = JSON.stringify({
    id: 'evt_thin',
    object: 'v2.core.event',
    type: 'v2.core.account[requirements].updated',
    related_object: { id: 'acct_club', type: 'v2.core.account', url: '/v2/core/accounts/acct_club' },
  })

  it('accepts a snapshot event signed with either secret', () => {
    const secrets = [PLATFORM_SECRET, CONNECT_SECRET]
    for (const signedWith of secrets) {
      const result = verify(snapshotEvent, signedWith, secrets)
      expect(result.kind).toBe('event')
      if (result.kind === 'event') expect(result.event.id).toBe('evt_snapshot')
    }
  })

  it.each([
    ['the first', PLATFORM_SECRET],
    ['the last', CONNECT_SECRET],
  ])('acknowledges a verified thin v2 event signed with %s secret instead of reporting a bad signature', (_, signedWith) => {
    const result = verify(thinEvent, signedWith, [PLATFORM_SECRET, CONNECT_SECRET])

    expect(result).toEqual({
      kind: 'unsupported_payload',
      reason: expect.stringContaining('thin event'),
      payloadType: 'v2.core.account[requirements].updated',
    })
  })

  it('rejects a payload no secret can verify with the real signature error', () => {
    const result = verify(snapshotEvent, 'whsec_someone_else', [PLATFORM_SECRET, CONNECT_SECRET])

    expect(result.kind).toBe('invalid_signature')
    if (result.kind === 'invalid_signature') expect(result.reason).toContain('No signatures found')
  })

  it('rejects an unverifiable thin event too — the payload type is no excuse for a bad signature', () => {
    expect(verify(thinEvent, 'whsec_someone_else', [PLATFORM_SECRET, CONNECT_SECRET]).kind).toBe('invalid_signature')
  })

  it('reports that no secret matched when none are configured', () => {
    expect(verify(snapshotEvent, PLATFORM_SECRET, [])).toEqual({ kind: 'invalid_signature', reason: 'no secret matched' })
  })

  it('never lets a non-signature error overwrite the signature error, nor try the next secret', () => {
    const tried: string[] = []
    const result = verifyWebhookEvent(
      thinEvent,
      ['whsec_a', 'whsec_b', 'whsec_c'],
      (secret) => {
        tried.push(secret)
        if (secret === 'whsec_a') {
          throw new Stripe.errors.StripeSignatureVerificationError('t=1,v1=x', thinEvent, { message: 'No signatures found' })
        }
        throw new Error('You passed a thin event notification')
      },
      isSignatureError,
    )

    expect(tried).toEqual(['whsec_a', 'whsec_b'])
    expect(result).toMatchObject({ kind: 'unsupported_payload', reason: 'You passed a thin event notification' })
  })

  it('does not acknowledge a snapshot event that failed for another reason, so Stripe retries it', () => {
    const result = verifyWebhookEvent(
      snapshotEvent,
      [PLATFORM_SECRET],
      () => {
        throw new Error('Use `await constructEventAsync(...)` instead of `constructEvent(...)`')
      },
      isSignatureError,
    )

    expect(result).toEqual({ kind: 'failed', reason: expect.stringContaining('constructEventAsync') })
  })

  it('treats a verified body that is not JSON as an unsupported payload of unknown type', () => {
    const result = verifyWebhookEvent(
      'not json',
      [PLATFORM_SECRET],
      () => {
        throw new SyntaxError('Unexpected token')
      },
      isSignatureError,
    )

    expect(result).toEqual({ kind: 'unsupported_payload', reason: 'Unexpected token', payloadType: null })
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
