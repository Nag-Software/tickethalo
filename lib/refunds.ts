import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Order } from '@/types/database'

/**
 * Refusjon.
 *
 * Klubben er selger og ansvarlig for refusjoner. Kunden får alltid hele
 * beløpet tilbake, og `refund_application_fee` fører Tickethalos provisjon
 * tilbake til klubben. Klubben fikk 90 % inn, betaler 100 % tilbake og får
 * 10 % fra oss — den ender på null.
 *
 * Stripe gir ikke tilbake sitt eget behandlingsgebyr ved refusjon. Det gjør
 * ingenting for klubben: kontoene er opprettet med `fees_collector =
 * application`, så gebyret ble aldri trukket fra klubben, men fra Tickethalos
 * plattformkonto. Det er Tickethalos kostnad, og ingenting skal overføres i
 * etterkant. (Den tidligere kompensasjonsoverføringen bygget på motsatt
 * antakelse og ga klubben gebyret én gang til.)
 *
 * En ordre kan refunderes fra fire steder: bookeren i ordrelisten, avlysning
 * av et show, refusjonskøen for betalinger som aldri ble billetter, og
 * Stripe-dashbordet (fanges av `charge.refunded` → `syncRefundFromCharge`).
 * Alle fire lander i samme tilstand på ordren.
 */

export type RefundReason = 'show_cancelled' | 'customer_request' | 'duplicate' | 'other' | 'no_ticket_issued'

export type RefundResult =
  | { ok: true; orderId: string; amount: number }
  | { ok: false; orderId: string; error: string }

// Én kolonneliste for alle veiene inn, slik at synkroniseringen etter en
// refusjon alltid har det den trenger for å ikke skrive over eldre verdier.
const ORDER_REFUND_COLUMNS =
  'id, status, amount_total, currency, platform_fee_amount, refunded_amount, application_fee_refunded_amount, refunded_at, refund_reason, stripe_payment_intent_id, stripe_charge_id, stripe_application_fee_id, stripe_connected_account_id, cancellation_reason'

type RefundOrderRow = Pick<
  Order,
  | 'id'
  | 'status'
  | 'amount_total'
  | 'currency'
  | 'platform_fee_amount'
  | 'refunded_amount'
  | 'application_fee_refunded_amount'
  | 'refunded_at'
  | 'refund_reason'
  | 'stripe_payment_intent_id'
  | 'stripe_charge_id'
  | 'stripe_application_fee_id'
  | 'stripe_connected_account_id'
  | 'cancellation_reason'
>

// ─────────────────────────────────────────────────────────────
// Rene regler — testet i tests/unit/finance/refunds.test.ts
// ─────────────────────────────────────────────────────────────

/**
 * Betalt hos Stripe, men ingen billett ble utstedt (utsolgt eller ugyldig
 * show). Samme definisjon som refusjonskøen i migrasjon 047 og
 * `show_sales_summary.awaiting_refund_orders`.
 */
export function isAwaitingRefund(
  order: Pick<Order, 'status' | 'stripe_payment_intent_id' | 'refunded_at'>,
): boolean {
  return order.status === 'cancelled' && Boolean(order.stripe_payment_intent_id) && !order.refunded_at
}

export type RefundEligibility =
  | { kind: 'already_refunded' }
  | { kind: 'refundable'; paymentIntentId: string; accountId: string; awaitingRefund: boolean }
  | { kind: 'not_refundable'; error: string }

/**
 * Kan ordren refunderes nå? Skilt ut fra `refundOrder` slik at reglene kan
 * testes uten Stripe og database.
 *
 * `already_refunded` er et vellykket utfall, ikke en feil: bookeren som
 * klikker to ganger, og avlysningen som kjøres på nytt etter et avbrudd,
 * skal begge få ja.
 */
export function refundEligibility(
  order: Pick<Order, 'status' | 'stripe_payment_intent_id' | 'stripe_connected_account_id' | 'refunded_at'>,
): RefundEligibility {
  if (order.status === 'refunded') return { kind: 'already_refunded' }

  const awaitingRefund = isAwaitingRefund(order)

  if (order.status === 'cancelled' && !awaitingRefund) {
    // `refunded_at` på en kansellert ordre betyr at pengene alt er sendt
    // tilbake. Uten payment intent ble det aldri trukket noe.
    return order.refunded_at
      ? { kind: 'already_refunded' }
      : { kind: 'not_refundable', error: 'No payment was taken for this order, so there is nothing to refund.' }
  }

  if (order.status !== 'paid' && !awaitingRefund) {
    return { kind: 'not_refundable', error: `The order is not paid (${order.status}).` }
  }

  if (!order.stripe_payment_intent_id || !order.stripe_connected_account_id) {
    return { kind: 'not_refundable', error: 'The order is missing its payment reference in Stripe.' }
  }

  return {
    kind: 'refundable',
    paymentIntentId: order.stripe_payment_intent_id,
    accountId: order.stripe_connected_account_id,
    awaitingRefund,
  }
}

/**
 * Hvor mye av betalingen Stripe har refundert, og om det er alt.
 *
 * `charge.refunded` er Stripes egen markering av full refusjon og vinner.
 * Beløpet klemmes til betalingen: en ordre kan ikke ha fått mer tilbake enn
 * den betalte, og utbetalingsgrunnlaget trekker `refunded_amount` fra
 * klubbens andel.
 */
export function refundStateFromCharge(charge: {
  amount: number
  amount_refunded: number
  refunded: boolean
}): { refundedAmount: number; fullyRefunded: boolean } {
  const amount = Number.isFinite(charge.amount) ? Math.max(0, charge.amount) : 0
  const amountRefunded = Number.isFinite(charge.amount_refunded) ? Math.max(0, charge.amount_refunded) : 0

  // En betaling på 0 kan ikke refunderes delvis — uten `amount > 0` ville
  // `0 >= 0` markert den som fullt refundert uten at noe har skjedd.
  const fullyRefunded = charge.refunded === true || (amount > 0 && amountRefunded >= amount)

  return {
    refundedAmount: fullyRefunded && amount > 0 ? amount : Math.min(amountRefunded, amount),
    fullyRefunded,
  }
}

/**
 * Stripe kjenner bare `duplicate`, `fraudulent` og `requested_by_customer`.
 * `fraudulent` legger kortet på Radar-blokkeringslisten og skal aldri settes
 * herfra. Vår egen årsak følger med i metadata og står på ordren.
 */
function stripeRefundReason(reason: RefundReason): Stripe.RefundCreateParams.Reason {
  return reason === 'duplicate' ? 'duplicate' : 'requested_by_customer'
}

/** Stripe-feil gjenkjennes på formen — se `lib/checkout/errors.ts`. */
function stripeErrorInfo(error: unknown): { type?: string; rawType?: string; code?: string } | null {
  if (typeof error !== 'object' || error === null) return null
  const { type, rawType, code } = error as { type?: unknown; rawType?: unknown; code?: unknown }
  if (typeof type !== 'string' || !type.startsWith('Stripe')) return null
  return {
    type,
    rawType: typeof rawType === 'string' ? rawType : undefined,
    code: typeof code === 'string' ? code : undefined,
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// ─────────────────────────────────────────────────────────────
// Refusjon av én ordre
// ─────────────────────────────────────────────────────────────

export async function refundOrder(orderId: string, reason: RefundReason): Promise<RefundResult> {
  if (!orderId) return { ok: false, orderId, error: 'Missing order id.' }

  const db = createAdminClient()

  const { data: order, error: readError } = await db
    .from('orders')
    .select(ORDER_REFUND_COLUMNS)
    .eq('id', orderId)
    .maybeSingle()

  // Ingenting er gjort hos Stripe ennå, så en lesefeil er trygg å returnere.
  if (readError) return { ok: false, orderId, error: `Could not read the order: ${readError.message}` }
  if (!order) return { ok: false, orderId, error: 'The order was not found.' }

  const eligibility = refundEligibility(order)
  if (eligibility.kind === 'already_refunded') return { ok: true, orderId, amount: 0 }
  if (eligibility.kind === 'not_refundable') return { ok: false, orderId, error: eligibility.error }

  const { paymentIntentId, accountId } = eligibility

  let refund: Stripe.Refund
  try {
    // Uten `amount` refunderer Stripe det som gjenstår — også etter en
    // delrefusjon i dashbordet. Idempotency-nøkkelen er ordren, slik at et
    // nytt klikk eller en ny kjøring av køen aldri gir to refusjoner.
    refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        refund_application_fee: true,
        reason: stripeRefundReason(reason),
        metadata: { order_id: order.id, refund_reason: reason },
      },
      { stripeAccount: accountId, idempotencyKey: `refund-${order.id}` },
    )
  } catch (error) {
    return recoverFromRefundError(order, { paymentIntentId, accountId, reason }, error)
  }

  // En refusjon kan avvises med en gang (typisk for lav saldo på klubbens
  // konto for enkelte betalingsmetoder). Da er ingenting sendt tilbake.
  if (refund.status === 'failed' || refund.status === 'canceled') {
    console.error(`[Refund] Stripe refund ${refund.id} for order ${order.id} is ${refund.status}`)
    return {
      ok: false,
      orderId: order.id,
      error: `Stripe could not refund the payment (refund ${refund.id} is ${refund.status}). Refund it in the Stripe dashboard or contact support.`,
    }
  }

  const refundedTotal = order.amount_total ?? (order.refunded_amount ?? 0) + refund.amount

  // Beløpene på ordren står, de nullstilles ikke. Hovedboken skal vise hva
  // salget var; `refunded_amount` og `application_fee_refunded_amount` sier
  // hvor mye som gikk tilbake. Webhooken `charge.refunded` retter opp
  // provisjonsbeløpet fra Stripe dersom det avviker.
  const { error: orderError } = await db
    .from('orders')
    .update({
      status: 'refunded',
      refunded_at: order.refunded_at ?? new Date().toISOString(),
      refund_reason: reason,
      refunded_amount: Math.max(order.refunded_amount ?? 0, refundedTotal),
      application_fee_refunded_amount: Math.max(
        order.application_fee_refunded_amount ?? 0,
        order.platform_fee_amount ?? 0,
      ),
    })
    .eq('id', order.id)

  if (orderError) {
    // Pengene er allerede sendt tilbake — dette må ikke se ut som en refusjon
    // som feilet, ellers prøver noen igjen eller refunderer manuelt.
    console.error(`[Refund] Order ${order.id} refunded in Stripe (${refund.id}) but not updated: ${orderError.message}`)
    throw new Error(
      `The refund went through in Stripe, but order ${order.id} could not be updated (${orderError.message}). ` +
        'The charge.refunded webhook will correct the order.',
    )
  }

  await markTicketsRefunded(order.id, `refund ${refund.id}`)

  console.log(`[Refund] Order ${order.id}: refunded ${refund.amount} (${reason}, ${refund.id})`)
  return { ok: true, orderId: order.id, amount: refund.amount }
}

/**
 * Stripe sier nei, men pengene kan likevel være sendt tilbake:
 *
 *  - `charge_already_refunded`: refundert i dashbordet, eller av et tidligere
 *    forsøk som krasjet før ordren ble oppdatert, og idempotency-nøkkelen er
 *    utløpt (24 t).
 *  - `idempotency_error`: samme nøkkel med andre parametere (bookeren valgte
 *    en annen årsak ved nytt forsøk) eller et parallelt kall som ikke er
 *    ferdig.
 *
 * I begge tilfeller er betalingen selv fasiten. Er den fullt refundert,
 * synkroniseres ordren slik `charge.refunded` ville gjort det.
 */
async function recoverFromRefundError(
  order: RefundOrderRow,
  context: { paymentIntentId: string; accountId: string; reason: RefundReason },
  error: unknown,
): Promise<RefundResult> {
  const info = stripeErrorInfo(error)
  const message = errorMessage(error)
  const alreadyRefunded = info?.code === 'charge_already_refunded'
  const idempotencyConflict = info?.rawType === 'idempotency_error' || info?.type === 'StripeIdempotencyError'

  if (!alreadyRefunded && !idempotencyConflict) {
    console.error(`[Refund] Stripe refused to refund order ${order.id}: ${message}`)
    return { ok: false, orderId: order.id, error: `Stripe could not refund the payment: ${message}` }
  }

  let charge: Stripe.Charge | null
  try {
    const intent = await stripe.paymentIntents.retrieve(
      context.paymentIntentId,
      { expand: ['latest_charge'] },
      { stripeAccount: context.accountId },
    )
    charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
  } catch (retrieveError) {
    const retrieveMessage = errorMessage(retrieveError)
    console.error(`[Refund] Could not read the charge for order ${order.id} after "${message}": ${retrieveMessage}`)
    return {
      ok: false,
      orderId: order.id,
      error: `Stripe reports the payment as already refunded, but the payment could not be read: ${retrieveMessage}`,
    }
  }

  if (!charge) {
    console.error(`[Refund] Order ${order.id}: "${message}", and payment ${context.paymentIntentId} has no charge`)
    return { ok: false, orderId: order.id, error: `Stripe could not refund the payment: ${message}` }
  }

  if (!refundStateFromCharge(charge).fullyRefunded) {
    console.warn(`[Refund] Order ${order.id}: "${message}", but charge ${charge.id} is not fully refunded yet`)
    return {
      ok: false,
      orderId: order.id,
      error: idempotencyConflict
        ? 'A refund for this order is already being processed. Reload the page in a moment.'
        : `Stripe could not refund the payment: ${message}`,
    }
  }

  await applyChargeRefund(order, charge, context.reason)
  console.log(`[Refund] Order ${order.id} was already refunded in Stripe (${charge.id}) — order synced`)
  return { ok: true, orderId: order.id, amount: 0 }
}

// ─────────────────────────────────────────────────────────────
// Synkronisering fra Stripe (charge.refunded)
// ─────────────────────────────────────────────────────────────

/**
 * Speiler refusjonstilstanden på en betaling over på ordren.
 *
 * Kalles av `charge.refunded`, som også kommer for delrefusjoner og for
 * refusjoner gjort i Stripe-dashbordet. Kaster ved databasefeil, slik at
 * webhooken svarer 500 og Stripe prøver igjen.
 */
export async function syncRefundFromCharge(charge: Stripe.Charge, accountId: string | null): Promise<void> {
  const order = await findOrderForCharge(charge)

  if (!order) {
    // Betalinger som ikke er billettsalg (eller testdata) har ingen ordre.
    // Et nytt forsøk fra Stripe ville ikke funnet den heller.
    console.warn(`[Refund] charge.refunded for ${charge.id} on ${accountId ?? 'platform'} matches no order — ignored`)
    return
  }

  if (accountId && order.stripe_connected_account_id && order.stripe_connected_account_id !== accountId) {
    console.error(
      `[Refund] charge.refunded for ${charge.id} came from ${accountId}, but order ${order.id} ` +
        `belongs to ${order.stripe_connected_account_id} — not synced`,
    )
    return
  }

  // En kansellert ordre har aldri hatt billetter, så årsaken er kjent selv
  // når refusjonen ble gjort utenfor Tickethalo.
  const fallbackReason: RefundReason = order.status === 'cancelled' ? 'no_ticket_issued' : 'other'
  await applyChargeRefund(order, charge, fallbackReason)
}

async function findOrderForCharge(charge: Stripe.Charge): Promise<RefundOrderRow | null> {
  const db = createAdminClient()

  const { data: byCharge, error: chargeError } = await db
    .from('orders')
    .select(ORDER_REFUND_COLUMNS)
    .eq('stripe_charge_id', charge.id)
    .maybeSingle()

  if (chargeError) throw new Error(`Could not look up the order for charge ${charge.id}: ${chargeError.message}`)
  if (byCharge) return byCharge

  // `stripe_charge_id` mangler når betalingen ikke kunne leses ved kjøpet
  // (se `readChargeFacts`). Payment intent er alltid lagret.
  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null
  if (!paymentIntentId) return null

  const { data: byIntent, error: intentError } = await db
    .from('orders')
    .select(ORDER_REFUND_COLUMNS)
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle()

  if (intentError) {
    throw new Error(`Could not look up the order for payment ${paymentIntentId}: ${intentError.message}`)
  }
  return byIntent
}

/**
 * Skriver betalingens refusjonstilstand til ordren. Felles for webhooken og
 * for `refundOrder` når Stripe melder at betalingen alt er refundert.
 *
 * Status og billetter endres bare ved full refusjon. En delrefusjon er gjort
 * i Stripe-dashbordet — Tickethalo tilbyr den ikke — og da er det bookerens
 * beslutning at billettene fortsatt gjelder.
 */
async function applyChargeRefund(order: RefundOrderRow, charge: Stripe.Charge, fallbackReason: RefundReason) {
  const db = createAdminClient()
  const state = refundStateFromCharge(charge)
  const feeRefunded = await readApplicationFeeRefunded(charge, order)

  // Aldri nedover: webhooks kan komme i feil rekkefølge, og en eldre
  // `charge.refunded` skal ikke viske ut en senere refusjon.
  const update: Partial<Order> = {
    refunded_amount: Math.max(order.refunded_amount ?? 0, state.refundedAmount),
    application_fee_refunded_amount: Math.max(order.application_fee_refunded_amount ?? 0, feeRefunded ?? 0),
  }

  if (state.fullyRefunded) {
    if (order.status === 'paid' || order.status === 'cancelled') update.status = 'refunded'
    update.refunded_at = order.refunded_at ?? new Date().toISOString()
    update.refund_reason = order.refund_reason ?? fallbackReason
  }

  const { error } = await db.from('orders').update(update).eq('id', order.id)
  if (error) {
    throw new Error(`Could not record the refund of charge ${charge.id} on order ${order.id}: ${error.message}`)
  }

  if (!state.fullyRefunded) {
    if (state.refundedAmount > 0) {
      console.warn(
        `[Refund] Charge ${charge.id} (order ${order.id}) is partially refunded in Stripe: ` +
          `${state.refundedAmount} of ${charge.amount}. The order stays ${order.status} and its tickets remain valid.`,
      )
    }
    return
  }

  await markTicketsRefunded(order.id, `charge ${charge.id}`)
  console.log(`[Refund] Order ${order.id} synced as refunded from charge ${charge.id}`)
}

/**
 * Tilbakeført provisjon står på plattformens application fee, ikke på
 * betalingen i klubbens konto — derfor hentes den uten `stripeAccount`.
 * `null` betyr ukjent, og da beholdes verdien ordren allerede har.
 */
async function readApplicationFeeRefunded(charge: Stripe.Charge, order: RefundOrderRow): Promise<number | null> {
  const applicationFee = charge.application_fee
  if (applicationFee && typeof applicationFee === 'object') return applicationFee.amount_refunded

  const feeId = typeof applicationFee === 'string' ? applicationFee : order.stripe_application_fee_id
  if (!feeId) return null

  try {
    const fee = await stripe.applicationFees.retrieve(feeId)
    return fee.amount_refunded
  } catch (error) {
    console.warn(`[Refund] Could not read application fee ${feeId} for order ${order.id}: ${errorMessage(error)}`)
    return null
  }
}

async function markTicketsRefunded(orderId: string, source: string) {
  const { error } = await createAdminClient()
    .from('tickets')
    .update({ status: 'refunded' })
    .eq('order_id', orderId)
    .neq('status', 'refunded')

  if (error) {
    // Ordren er refundert, men billettene slipper fortsatt inn i døra.
    // Kastes slik at webhooken prøver igjen og bookeren får vite det.
    console.error(`[Refund] Order ${orderId} (${source}) refunded, but tickets not invalidated: ${error.message}`)
    throw new Error(
      `The refund went through in Stripe, but the tickets for order ${orderId} could not be invalidated (${error.message}). ` +
        'The charge.refunded webhook will correct the tickets.',
    )
  }
}

// ─────────────────────────────────────────────────────────────
// Flere ordrer
// ─────────────────────────────────────────────────────────────

const SHOW_ORDER_PAGE_SIZE = 500

/**
 * Avlyst show: alle betalte ordrer, og betalinger som ikke ble billetter,
 * refunderes. Idempotens per ordre gjør at jobben trygt kan kjøres på nytt om
 * den stopper halvveis.
 *
 * Kaster hvis ordrene ikke kan leses — en tom liste ville sett ut som «alt er
 * refundert».
 */
export async function refundShow(
  showId: string,
): Promise<{ total: number; refunded: number; failed: number; errors: string[] }> {
  const db = createAdminClient()

  // Hele listen leses før noe refunderes. Refusjonene endrer status og ville
  // ellers flyttet rader mellom sidene.
  const targets: Array<{ id: string; reason: RefundReason }> = []
  for (let from = 0; ; from += SHOW_ORDER_PAGE_SIZE) {
    const { data, error } = await db
      .from('orders')
      .select('id, status, stripe_payment_intent_id, refunded_at')
      .eq('show_id', showId)
      .in('status', ['paid', 'cancelled'])
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + SHOW_ORDER_PAGE_SIZE - 1)

    if (error) throw new Error(`Could not read the orders for show ${showId}: ${error.message}`)

    for (const order of data ?? []) {
      if (order.status === 'paid') targets.push({ id: order.id, reason: 'show_cancelled' })
      else if (isAwaitingRefund(order)) targets.push({ id: order.id, reason: 'no_ticket_issued' })
    }

    if ((data ?? []).length < SHOW_ORDER_PAGE_SIZE) break
  }

  let refunded = 0
  const errors: string[] = []

  // Én og én: parallelle refusjoner mot samme konto gir rate limits, og
  // rekkefølgen gjør loggen lesbar når noe feiler.
  for (const target of targets) {
    try {
      const result = await refundOrder(target.id, target.reason)
      if (result.ok) {
        refunded += 1
      } else {
        errors.push(`Order ${target.id}: ${result.error}`)
      }
    } catch (error) {
      const message = errorMessage(error)
      console.error(`[Refund] Order ${target.id} failed: ${message}`)
      errors.push(`Order ${target.id}: ${message}`)
    }
  }

  const failed = targets.length - refunded
  console.log(`[Refund] Show ${showId}: refunded ${refunded}/${targets.length} orders`)

  return { total: targets.length, refunded, failed, errors }
}

/**
 * Refusjonskøen: betalinger som ble til kansellerte ordrer uten billett.
 *
 * Checkout refunderer dem med en gang (`finalizeCheckoutSession`). Dette er
 * sikkerhetsnettet når det umiddelbare forsøket feilet — Stripe var nede,
 * funksjonen ble avbrutt, eller databasen svarte ikke. `minAgeMinutes` holder
 * køen unna ordrer som checkout fortsatt holder på å refundere.
 */
export async function processRefundQueue(
  options?: { minAgeMinutes?: number; limit?: number },
): Promise<{ processed: number; refunded: number; failed: number }> {
  const minAgeMinutes = Math.max(0, options?.minAgeMinutes ?? 5)
  const limit = Math.max(1, options?.limit ?? 50)
  const cutoff = new Date(Date.now() - minAgeMinutes * 60_000).toISOString()

  const { data: orders, error } = await createAdminClient()
    .from('orders')
    .select('id')
    .eq('status', 'cancelled')
    .not('stripe_payment_intent_id', 'is', null)
    .is('refunded_at', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Could not read the refund queue: ${error.message}`)

  let refunded = 0
  let failed = 0

  for (const order of orders ?? []) {
    try {
      const result = await refundOrder(order.id, 'no_ticket_issued')
      if (result.ok) {
        refunded += 1
      } else {
        failed += 1
        console.error(`[Refund queue] Order ${order.id}: ${result.error}`)
      }
    } catch (refundError) {
      failed += 1
      console.error(`[Refund queue] Order ${order.id} failed: ${errorMessage(refundError)}`)
    }
  }

  const processed = orders?.length ?? 0
  if (processed > 0) {
    console.log(`[Refund queue] Processed ${processed}: ${refunded} refunded, ${failed} failed`)
  }

  return { processed, refunded, failed }
}
