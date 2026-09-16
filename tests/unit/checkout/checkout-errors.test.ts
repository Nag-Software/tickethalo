import { describe, expect, it } from 'vitest'
import {
  CheckoutError,
  checkoutErrorMessage,
  describeCheckoutError,
  isMissingStripeResource,
  toCheckoutError,
  type CheckoutErrorCode,
} from '@/lib/checkout/errors'

describe('checkout errors', () => {
  it.each([
    'show_not_found', 'show_not_published', 'show_past', 'sold_out', 'price_missing',
    'club_not_payable', 'stripe_config', 'stripe_unavailable', 'unknown',
  ] satisfies CheckoutErrorCode[])('has safe user copy for %s', (code) => {
    expect(checkoutErrorMessage(code)).toBeTruthy()
    expect(checkoutErrorMessage(code)).not.toMatch(/secret|stack|undefined/i)
  })

  it.each([
    ['price_missing', true], ['club_not_payable', true], ['stripe_config', true], ['unknown', true],
    ['sold_out', false], ['show_past', false], ['stripe_unavailable', false],
  ] as const)('classifies %s operator fault as %s', (code, expected) => {
    expect(new CheckoutError(code).isOperatorFault).toBe(expected)
  })

  it('preserves an existing checkout error', () => {
    const error = new CheckoutError('sold_out')
    expect(toCheckoutError(error)).toBe(error)
  })

  it.each(['StripeAuthenticationError', 'StripePermissionError', 'StripeInvalidRequestError'])(
    'maps %s to configuration failure',
    (type) => expect(toCheckoutError({ type, message: 'bad request' }).code).toBe('stripe_config'),
  )

  it.each(['StripeConnectionError', 'StripeRateLimitError', 'StripeAPIError'])(
    'maps %s to temporary unavailability',
    (type) => expect(toCheckoutError({ type, message: 'try later' }).code).toBe('stripe_unavailable'),
  )

  it('maps unknown Stripe error types without exposing their message', () => {
    const error = toCheckoutError({ type: 'StripeSomethingNewError', message: 'internal detail' })
    expect(error.code).toBe('unknown')
    expect(error.message).not.toContain('internal detail')
    expect(error.detail).toContain('internal detail')
  })

  it('maps ordinary errors to an unknown checkout error with a log detail', () => {
    const error = toCheckoutError(new TypeError('broken'))
    expect(error).toMatchObject({ code: 'unknown', detail: 'TypeError: broken' })
  })

  it('recognizes a missing Stripe resource only for the named ID', () => {
    const error = { type: 'StripeInvalidRequestError', code: 'resource_missing', message: 'No such price: price_123' }
    expect(isMissingStripeResource(error, 'price_123')).toBe(true)
    expect(isMissingStripeResource(error, 'price_456')).toBe(false)
  })

  it('builds a concise contextual log line and drops empty context', () => {
    const error = new CheckoutError('stripe_config', { detail: 'req=req_123' })
    expect(describeCheckoutError(error, { showId: 'show-1', slug: undefined })).toBe(
      '[stripe_config] showId=show-1 req=req_123',
    )
  })
})
