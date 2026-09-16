/**
 * Error handling for the purchase flow.
 *
 * The code is the contract between server and UI — the copy can change without
 * anything else changing. The module deliberately avoids importing Stripe
 * (Stripe errors are recognised by shape), so client code can use it too.
 */

import type { TicketSalesState } from '@/lib/ticket-sales'
import { formatSalesOpenDate } from '@/lib/ticket-sales-display'

export type CheckoutErrorCode =
  | 'show_not_found'
  | 'show_not_published'
  | 'show_past'
  | 'sold_out'
  | 'sales_closed'
  | 'sales_not_open'
  | 'price_missing'
  | 'club_not_payable'
  | 'stripe_config'
  | 'stripe_unavailable'
  | 'unknown'

const MESSAGES: Record<CheckoutErrorCode, string> = {
  show_not_found: 'We could not find this show. Reload the page and try again.',
  show_not_published: 'This show is not on sale yet.',
  show_past: 'This show has already happened, so tickets can no longer be bought.',
  sold_out: 'This show is sold out.',
  sales_closed: 'Ticket sales for this show are closed.',
  // Reserveteksten når datoen mangler — se `checkoutErrorMessage`.
  sales_not_open: 'Tickets for this show are not on sale yet.',
  price_missing: 'The ticket price is missing for this show. We have been notified — please try again later.',
  club_not_payable: 'Tickets for this show are not on sale yet. We have been notified — please try again later.',
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
  // Klubben har ikke fullført Stripe-onboarding, så det finnes ingen konto å
  // selge på vegne av. Kjøperen kan ikke gjøre noe med det — vi må.
  'club_not_payable',
  'stripe_config',
  'unknown',
  // `sales_closed` og `sales_not_open` hører ikke hjemme her: showet er satt
  // opp riktig, og kjøperen får en melding hun kan handle på.
])

/** Values some messages need. Everything here is safe to show the buyer. */
export type CheckoutErrorParams = {
  /** `YYYY-MM-DD` in Norwegian time — the day ticket sales open (`sales_not_open`). */
  openDate?: string
}

export class CheckoutError extends Error {
  readonly code: CheckoutErrorCode
  /** Technical context for the log — never shown to the user. */
  readonly detail?: string
  readonly openDate?: string

  constructor(code: CheckoutErrorCode, options?: { detail?: string; cause?: unknown } & CheckoutErrorParams) {
    super(
      checkoutErrorMessage(code, { openDate: options?.openDate }),
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    )
    this.name = 'CheckoutError'
    this.code = code
    this.detail = options?.detail
    this.openDate = options?.openDate
  }

  get isOperatorFault() {
    return OPERATOR_FAULT.has(this.code)
  }
}

export function checkoutErrorMessage(code: CheckoutErrorCode, params: CheckoutErrorParams = {}) {
  if (code === 'sales_not_open' && params.openDate) {
    // Meldingen bygges i konstruktøren. En ugyldig dato skal gi den generelle
    // teksten, ikke en ny feil midt i feilhåndteringen.
    try {
      return `Tickets for this show go on sale on ${formatSalesOpenDate(params.openDate)}.`
    } catch {
      return MESSAGES[code]
    }
  }

  return MESSAGES[code]
}

/**
 * Salgsstatusen som checkout-feil, eller null når salget er åpent.
 *
 * Reglene bor i `ticketSalesState`; her bestemmes bare hva kjøperen får høre.
 * Et arkivert eller kansellert show er «ikke publisert» for kjøperen — at det
 * finnes salgshistorikk bak, er ikke noe å fortelle.
 */
export function checkoutErrorForSalesState(state: TicketSalesState, detail?: string): CheckoutError | null {
  switch (state.kind) {
    case 'open':
      return null
    case 'unavailable':
      return new CheckoutError('show_not_published', { detail })
    case 'ended':
      return new CheckoutError('show_past', { detail })
    case 'closed':
      return new CheckoutError('sales_closed', { detail: joinDetail(detail, `closed_at=${state.closedAt}`) })
    case 'not_yet_open':
      return new CheckoutError('sales_not_open', {
        detail: joinDetail(detail, `opens_at=${state.opensAt.toISOString()}`),
        openDate: state.openDate,
      })
  }
}

function joinDetail(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(' ')
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
