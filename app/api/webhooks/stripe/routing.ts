/**
 * Ren ruting for Stripe-webhooken, skilt ut fra `route.ts`.
 *
 * Next godtar bare HTTP-metoder og segmentkonfig som eksporter fra en
 * route-fil, så det som skal testes bor her. Ingen imports: testene skal
 * kunne kjøre uten Stripe-klient og database.
 */

export type WebhookRoute =
  | 'checkout_completed'
  | 'checkout_async_failed'
  | 'charge_refunded'
  | 'payout'
  | 'account'
  | 'balance_settings'
  | 'report_run'
  | 'dispute'
  | 'payment_failed'
  | 'ignored'

/**
 * Hvilke events som håndteres, og hvor. Alt som ikke står her kvitteres og
 * ignoreres — også `charge.succeeded`: plattformen betaler Stripe-gebyret, så
 * det finnes ikke noe oppgjør per betaling.
 */
const ROUTES: Readonly<Record<string, WebhookRoute>> = {
  // Connected accounts-endepunktet (`event.account` = klubbens konto)
  'checkout.session.completed': 'checkout_completed',
  'checkout.session.async_payment_succeeded': 'checkout_completed',
  'checkout.session.async_payment_failed': 'checkout_async_failed',
  'charge.refunded': 'charge_refunded',
  'charge.dispute.created': 'dispute',
  'charge.dispute.updated': 'dispute',
  'charge.dispute.closed': 'dispute',
  'charge.dispute.funds_withdrawn': 'dispute',
  'charge.dispute.funds_reinstated': 'dispute',
  'payment_intent.payment_failed': 'payment_failed',
  'payout.created': 'payout',
  'payout.updated': 'payout',
  'payout.paid': 'payout',
  'payout.failed': 'payout',
  'payout.canceled': 'payout',
  'account.updated': 'account',
  'balance_settings.updated': 'balance_settings',
  // Your account-endepunktet (plattformkontoen, uten `event.account`)
  'reporting.report_run.succeeded': 'report_run',
}

export function routeFor(eventType: string): WebhookRoute {
  // `hasOwn`, ikke `in`: `constructor` og andre prototypenavn er ikke events.
  return Object.hasOwn(ROUTES, eventType) ? ROUTES[eventType] : 'ignored'
}

/**
 * Gebyrrapportene fra Stripe (`all_fees.*`) er de eneste rapportkjøringene
 * som bokfører noe. Andre rapporter noen har bestilt i dashbordet, skal ikke
 * starte gebyrbokføringen.
 */
export function isFeeReportType(reportType: string | null | undefined): boolean {
  return typeof reportType === 'string' && reportType.startsWith('all_fees.')
}

/** Miljøvariablene webhooken verifiserer signaturen mot, i prøverekkefølge. */
export const WEBHOOK_SECRET_ENV_VARS = ['STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET'] as const

/**
 * Navnene på konfigurerte secrets som aldri kan verifisere en signatur.
 *
 * En signing secret fra Stripe begynner alltid med `whsec_`. Noe annet er
 * nesten alltid en API-nøkkel limt inn i feil felt, og gir 400 på hver
 * levering — det ser ut som at ingen kjøper billetter. Bare navnet returneres,
 * aldri verdien.
 */
export function malformedWebhookSecretNames(env: Readonly<Record<string, string | undefined>>): string[] {
  return WEBHOOK_SECRET_ENV_VARS.filter((name) => {
    const value = env[name]?.trim()
    return value ? !value.startsWith('whsec_') : false
  })
}
