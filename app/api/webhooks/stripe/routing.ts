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
  | 'refund'
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
  // Selve refusjonen, ikke betalingen: en refusjon kan feile eller bli
  // kansellert etter at `charge.refunded` er levert. `charge.refund.updated`
  // bærer også et Refund-objekt.
  'refund.updated': 'refund',
  'refund.failed': 'refund',
  'charge.refund.updated': 'refund',
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

export type WebhookVerification<E> =
  | { kind: 'event'; event: E }
  /**
   * Signaturen stemte, men innholdet er ikke et snapshot-event — i praksis et
   * tynt v2-event (`v2.core.event`) fra en event destination som peker hit.
   */
  | { kind: 'unsupported_payload'; reason: string; payloadType: string | null }
  /** Ingen secret verifiserte signaturen. `reason` er en ekte signaturfeil. */
  | { kind: 'invalid_signature'; reason: string }
  /** Noe annet enn signaturen feilet for et vanlig event. Bør prøves igjen. */
  | { kind: 'failed'; reason: string }

/**
 * Prøver signaturen mot hver secret og skiller signaturfeil fra alt annet.
 *
 * `constructEvent` verifiserer signaturen først og tolker innholdet etterpå.
 * Et tynt v2-event består signaturen, men kastes i tolkningen. Ble den feilen
 * behandlet som en signaturfeil, prøvde vi neste secret, og den
 * «No signatures found»-feilen overskrev den egentlige grunnen. Endepunktet
 * svarte da 400 på hver levering til Stripe deaktiverte det, og loggen pekte
 * på secreten. Et slikt event kvitteres i stedet: ruten håndterer bare
 * snapshot-events, og å avvise det gir aldri et annet svar.
 *
 * En annen feil for et vanlig snapshot-event (`object: 'event'`) kvitteres
 * derimot ikke. Den kan komme før signaturen er sjekket — f.eks. en
 * kryptoleverandør som bare støtter async — og da skal Stripe prøve igjen
 * i stedet for at billettkjøp forsvinner i stillhet.
 *
 * Stripe-klienten sendes inn, så funksjonen kan testes uten nettverk.
 */
export function verifyWebhookEvent<E>(
  body: string,
  secrets: readonly string[],
  construct: (secret: string) => E,
  isSignatureError: (error: unknown) => boolean,
): WebhookVerification<E> {
  let signatureError = 'no secret matched'

  for (const secret of secrets) {
    try {
      return { kind: 'event', event: construct(secret) }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      if (isSignatureError(error)) {
        signatureError = reason
        continue
      }

      const payload = payloadSummary(body)
      if (payload.object === 'event') return { kind: 'failed', reason }
      return { kind: 'unsupported_payload', reason, payloadType: payload.type }
    }
  }

  return { kind: 'invalid_signature', reason: signatureError }
}

function payloadSummary(body: string): { object: string | null; type: string | null } {
  try {
    const parsed: unknown = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object') return { object: null, type: null }
    const { object, type } = parsed as { object?: unknown; type?: unknown }
    return {
      object: typeof object === 'string' ? object : null,
      type: typeof type === 'string' ? type : null,
    }
  } catch {
    return { object: null, type: null }
  }
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
