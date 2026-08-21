/**
 * Error handling for the purchase flow.
 *
 * The code is the contract between server and UI — the copy can change without
 * anything else changing. The module deliberately avoids importing Stripe
 * (Stripe errors are recognised by shape), so client code can use it too.
 */

export type CheckoutErrorCode =
  | 'show_not_found'
  | 'show_not_published'
  | 'show_past'
  | 'sold_out'
  | 'price_missing'
  | 'stripe_config'
  | 'stripe_unavailable'
  | 'unknown'

const MESSAGES: Record<CheckoutErrorCode, string> = {
  show_not_found: 'We could not find this show. Reload the page and try again.',
  show_not_published: 'This show is not on sale yet.',
  show_past: 'This show has already happened, so tickets can no longer be bought.',
  sold_out: 'This show is sold out.',
  price_missing: 'The ticket price is missing for this show. We have been notified — please try again later.',
  stripe_config: 'Payments are not set up correctly for this show. We have been notified — please try again later.',
  stripe_unavailable: 'We cannot reach the payment provider right now. Please try again in a moment.',
  unknown: 'Checkout could not be opened right now. Please try again in a moment.',
}

/**
 * Errors caused by our own setup, not by the show or the user. These are logged
 * as `error` even though the user gets a calm message — they need someone to
 * act on them.
 */
const OPERATOR_FAULT = new Set<CheckoutErrorCode>([
  'price_missing',
  'stripe_config',
  'unknown',
])

export class CheckoutError extends Error {
  readonly code: CheckoutErrorCode
  /** Technical context for the log — never shown to the user. */
  readonly detail?: string

  constructor(code: CheckoutErrorCode, options?: { detail?: string; cause?: unknown }) {
    super(MESSAGES[code], options?.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'CheckoutError'
    this.code = code
    this.detail = options?.detail
  }

  get isOperatorFault() {
    return OPERATOR_FAULT.has(this.code)
  }
}

export function checkoutErrorMessage(code: CheckoutErrorCode) {
  return MESSAGES[code]
}

type StripeErrorShape = {
  type: string
  code?: string
  param?: string
  statusCode?: number
  requestId?: string
  message?: string
}

/** Stripe errors are plain objects with a `type` field — no reason to load the SDK to recognise them. */
function asStripeError(error: unknown): StripeErrorShape | null {
  if (typeof error !== 'object' || error === null) return null
  const type = (error as { type?: unknown }).type
  if (typeof type !== 'string' || !type.startsWith('Stripe')) return null
  return error as StripeErrorShape
}

/** True when Stripe does not recognise `resourceId` — typically a cached ID from another account. */
export function isMissingStripeResource(error: unknown, resourceId: string) {
  const stripeError = asStripeError(error)
  if (!stripeError || stripeError.code !== 'resource_missing') return false
  return (stripeError.message ?? '').includes(resourceId)
}

/**
 * Translates anything into a `CheckoutError`. Stripe does not distinguish
 * between "we sent something wrong" and "Stripe is down", but the user should
 * get a very different message in the two cases.
 */
export function toCheckoutError(error: unknown): CheckoutError {
  if (error instanceof CheckoutError) return error

  const stripeError = asStripeError(error)
  if (stripeError) {
    const detail = [
      stripeError.type,
      stripeError.code,
      stripeError.param && `param=${stripeError.param}`,
      stripeError.requestId && `req=${stripeError.requestId}`,
      stripeError.message,
    ]
      .filter(Boolean)
      .join(' | ')

    switch (stripeError.type) {
      // A 4xx from Stripe means our request was wrong: a missing key, the wrong
      // account, or a resource that does not exist. Always our fault.
      case 'StripeAuthenticationError':
      case 'StripePermissionError':
      case 'StripeInvalidRequestError':
        return new CheckoutError('stripe_config', { detail, cause: error })
      case 'StripeConnectionError':
      case 'StripeRateLimitError':
      case 'StripeAPIError':
        return new CheckoutError('stripe_unavailable', { detail, cause: error })
      default:
        return new CheckoutError('unknown', { detail, cause: error })
    }
  }

  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return new CheckoutError('unknown', { detail, cause: error })
}

/** One loggable line with everything needed to find the error again in Stripe. */
export function describeCheckoutError(error: CheckoutError, context: Record<string, string | undefined> = {}) {
  const parts = Object.entries(context)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)

  return [`[${error.code}]`, ...parts, error.detail ?? error.message].join(' ')
}
