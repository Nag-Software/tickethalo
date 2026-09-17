import { describe, expect, it } from 'vitest'
import {
  CheckoutError,
  checkoutErrorForSalesState,
  checkoutErrorMessage,
  describeCheckoutError,
  isMissingStripeResource,
  toCheckoutError,
  type CheckoutErrorCode,
} from '@/lib/checkout/errors'
import { ticketSalesState } from '@/lib/ticket-sales'

describe('checkout errors', () => {
  it.each([
    'show_not_found', 'show_not_published', 'show_past', 'sold_out', 'sales_closed', 'sales_not_open',
    'price_missing', 'club_not_payable', 'stripe_config', 'stripe_unavailable', 'unknown',
  ] satisfies CheckoutErrorCode[])('has safe user copy for %s', (code) => {
    expect(checkoutErrorMessage(code)).toBeTruthy()
    expect(checkoutErrorMessage(code)).not.toMatch(/secret|stack|undefined/i)
  })

  it.each([
    ['price_missing', true], ['club_not_payable', true], ['stripe_config', true], ['unknown', true],
    ['sold_out', false], ['show_past', false], ['stripe_unavailable', false],
    ['sales_closed', false], ['sales_not_open', false],
  ] as const)('classifies %s operator fault as %s', (code, expected) => {
    expect(new CheckoutError(code).isOperatorFault).toBe(expected)
  })

  it('tells the buyer when sales open', () => {
    const error = new CheckoutError('sales_not_open', { openDate: '2026-09-17' })
    expect(error.message).toBe('Tickets for this show go on sale on 17 September 2026.')
    expect(error.openDate).toBe('2026-09-17')
    expect(error.isOperatorFault).toBe(false)
  })

  it('falls back to generic copy when the open date is missing or invalid', () => {
    expect(new CheckoutError('sales_not_open').message).toBe('Tickets for this show are not on sale yet.')
    expect(checkoutErrorMessage('sales_not_open', { openDate: 'soon' })).toBe('Tickets for this show are not on sale yet.')
  })

  it('ignores an open date on codes that do not use one', () => {
    expect(checkoutErrorMessage('sales_closed', { openDate: '2026-09-17' })).toBe('Ticket sales for this show are closed.')
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

  it('treats a checkout deadline that arrived too late as temporary, not as broken setup', () => {
    // Et SDK-forsøk som kom fram for sent: fristen er da under Stripes minimum.
    const error = toCheckoutError({
      type: 'StripeInvalidRequestError',
      param: 'expires_at',
      requestId: 'req_late',
      message: 'The `expires_at` timestamp must be at least 30 minutes from Checkout Session creation.',
    })
    expect(error.code).toBe('stripe_unavailable')
    expect(error.isOperatorFault).toBe(false)
    expect(error.detail).toContain('param=expires_at')
    expect(error.detail).toContain('req=req_late')
  })

  it('still treats other invalid parameters as broken setup', () => {
    const error = toCheckoutError({ type: 'StripeInvalidRequestError', param: 'line_items[0][price_data][product]', message: 'bad' })
    expect(error.code).toBe('stripe_config')
    expect(error.isOperatorFault).toBe(true)
  })

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

describe('checkout errors for the ticket sales state', () => {
  const show = (date: string, overrides: Record<string, unknown> = {}) => ({
    status: 'published',
    date,
    ticket_sales_closed_at: null,
    deleted_at: null,
    ...overrides,
  })
  const now = new Date('2026-09-16T10:00:00Z')

  it('lets an open show through', () => {
    expect(checkoutErrorForSalesState(ticketSalesState(show('2026-12-14'), now))).toBeNull()
  })

  it('refuses a show before the 90-day window opens, with the open date', () => {
    const error = checkoutErrorForSalesState(ticketSalesState(show('2026-12-15'), now), 'show=abc')
    expect(error).toMatchObject({ code: 'sales_not_open', openDate: '2026-09-17' })
    expect(error?.message).toBe('Tickets for this show go on sale on 17 September 2026.')
    expect(error?.detail).toBe('show=abc opens_at=2026-09-16T22:00:00.000Z')
  })

  it('refuses a show whose sales were stopped', () => {
    const state = ticketSalesState(show('2026-10-01', { ticket_sales_closed_at: '2026-09-15T08:00:00Z' }), now)
    const error = checkoutErrorForSalesState(state)
    expect(error).toMatchObject({ code: 'sales_closed', detail: 'closed_at=2026-09-15T08:00:00Z' })
    expect(error?.isOperatorFault).toBe(false)
  })

  it('refuses a show that has ended', () => {
    expect(checkoutErrorForSalesState(ticketSalesState(show('2026-09-15'), now))?.code).toBe('show_past')
  })

  it.each([
    [{ status: 'draft' }],
    [{ status: 'cancelled' }],
    [{ deleted_at: '2026-09-10T10:00:00Z' }],
  ])('treats an unpublished, cancelled or archived show as not published %#', (overrides) => {
    const error = checkoutErrorForSalesState(ticketSalesState(show('2026-10-01', overrides), now), 'status=x')
    expect(error).toMatchObject({ code: 'show_not_published', detail: 'status=x' })
    // Samme melding for utkast og arkiverte show — den kan ikke love at salget kommer.
    expect(error?.message).toBe('This show is not on sale.')
    expect(error?.message).not.toMatch(/\byet\b/i)
  })
})
