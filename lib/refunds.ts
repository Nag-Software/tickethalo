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
 *
 * To veier går andre veien:
 *  - En refusjon kan feile eller kanselleres hos Stripe dager etter at den ble
 *    opprettet (stengt kort, for lav saldo). `syncRefundStatus` setter da
 *    ordren tilbake, så den blokkerer sletting og havner i køen igjen.
 *  - En tapt disputt har allerede gitt kunden pengene. `syncDisputeFromStripe`
 *    lukker ordren som refundert — en refusjon ville blitt avvist uansett.
 */

export type RefundReason = 'show_cancelled' | 'customer_request' | 'duplicate' | 'other' | 'no_ticket_issued'

export type RefundResult =
  | { ok: true; orderId: string; amount: number }
  | { ok: false; orderId: string; error: string }

// Én kolonneliste for alle veiene inn, slik at synkroniseringen etter en
// refusjon alltid har det den trenger for å ikke skrive over eldre verdier.
const ORDER_REFUND_COLUMNS =
  'id, status, amount_total, currency, platform_fee_amount, refunded_amount, application_fee_refunded_amount, refunded_at, refund_reason, stripe_payment_intent_id, stripe_charge_id, stripe_application_fee_id, stripe_connected_account_id, cancellation_reason, dispute_status, disputed_at, dispute_net_amount, refund_status, refund_attempts'

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
  | 'dispute_status'
  | 'disputed_at'
  | 'dispute_net_amount'
  | 'refund_status'
  | 'refund_attempts'
>

/**
 * Så mange feilede forsøk gjør køen før den gir opp en ordre. Et kort som er
 * stengt, blir ikke åpnet igjen av at cron prøver hver natt — og ordrer som
 * alltid feiler, skal ikke stå først i køen for alltid.
 */
export const MAX_REFUND_QUEUE_ATTEMPTS = 5

/** Avgjorte disputter. Samme liste som `open_dispute_orders` i migrasjon 047. */
export const CLOSED_DISPUTE_STATUSES: readonly string[] = ['won', 'lost', 'warning_closed', 'prevented']

export const DISPUTE_OPEN_MESSAGE =
  'The buyer has disputed this payment with their bank, so it cannot be refunded while the dispute is open. ' +
  'If the dispute is lost, the buyer already has the money back and the order is closed as refunded automatically. ' +
  'Otherwise you can refund it once the dispute is resolved.'

const LEGACY_PAYMENT_MESSAGE =
  'This payment was taken before the club’s Stripe account was connected, so it cannot be refunded from Tickethalo. ' +
  'Refund it in the Stripe dashboard, then contact support so the order can be marked as refunded.'

// ─────────────────────────────────────────────────────────────
// Rene regler — testet i tests/unit/finance/refunds.test.ts
// ─────────────────────────────────────────────────────────────

/**
 * Betalt hos Stripe, men ingen billett ble utstedt (utsolgt, ugyldig show
 * eller stengt salg). Samme definisjon som refusjonskøen i migrasjon 047 og
 * `show_sales_summary.awaiting_refund_orders`.
 */
export function isAwaitingRefund(
  order: Pick<Order, 'status' | 'stripe_payment_intent_id' | 'refunded_at'>,
): boolean {
  return order.status === 'cancelled' && Boolean(order.stripe_payment_intent_id) && !order.refunded_at
}

/** Kunden har en disputt som ikke er avgjort. */
export function isDisputeOpen(disputeStatus: string | null | undefined): boolean {
  return Boolean(disputeStatus) && !CLOSED_DISPUTE_STATUSES.includes(disputeStatus as string)
}

export type RefundEligibility =
  | { kind: 'already_refunded' }
  | { kind: 'refundable'; paymentIntentId: string; accountId: string; awaitingRefund: boolean }
  | {
      kind: 'not_refundable'
      code: 'no_payment' | 'not_paid' | 'dispute_open' | 'missing_stripe_reference'
      error: string
    }

/**
 * Kan ordren refunderes nå? Skilt ut fra `refundOrder` slik at reglene kan
 * testes uten Stripe og database.
 *
 * `already_refunded` er et vellykket utfall, ikke en feil: bookeren som
 * klikker to ganger, og avlysningen som kjøres på nytt etter et avbrudd,
 * skal begge få ja.
 */
export function refundEligibility(
  order: Pick<Order, 'status' | 'stripe_payment_intent_id' | 'stripe_connected_account_id' | 'refunded_at'> & {
    dispute_status?: string | null
  },
): RefundEligibility {
  if (order.status === 'refunded') return { kind: 'already_refunded' }

  const awaitingRefund = isAwaitingRefund(order)

  if (order.status === 'cancelled' && !awaitingRefund) {
    // `refunded_at` på en kansellert ordre betyr at pengene alt er sendt
    // tilbake. Uten payment intent ble det aldri trukket noe.
    return order.refunded_at
      ? { kind: 'already_refunded' }
      : {
          kind: 'not_refundable',
          code: 'no_payment',
          error: 'No payment was taken for this order, so there is nothing to refund.',
        }
  }

  if (order.status !== 'paid' && !awaitingRefund) {
    return { kind: 'not_refundable', code: 'not_paid', error: `The order is not paid (${order.status}).` }
  }

  // Stripe avviser refusjon av en omstridt betaling (`charge_disputed`). Å
  // spørre først ville bare gitt en dårligere feilmelding.
  if (isDisputeOpen(order.dispute_status)) {
    return { kind: 'not_refundable', code: 'dispute_open', error: DISPUTE_OPEN_MESSAGE }
  }

  if (!order.stripe_payment_intent_id || !order.stripe_connected_account_id) {
    return {
      kind: 'not_refundable',
      code: 'missing_stripe_reference',
      error: order.stripe_payment_intent_id
        ? LEGACY_PAYMENT_MESSAGE
        : 'The order is missing its payment reference in Stripe.',
    }
  }

  return {
    kind: 'refundable',
    paymentIntentId: order.stripe_payment_intent_id,
    accountId: order.stripe_connected_account_id,
    awaitingRefund,
  }
}

export type RefundQueueSkipReason = 'missing_connected_account' | 'attempts_exhausted' | 'dispute_open'

/**
 * Hvorfor køen lar en ordre ligge. Speiler filteret i `processRefundQueue`.
 *
 *  - Uten klubbkonto er betalingen fra før Connect og kan ikke refunderes
 *    herfra. Den blokkerer fortsatt sletting av showet — med vilje — men skal
 *    ikke ta plass i køen hver natt.
 *  - Etter `MAX_REFUND_QUEUE_ATTEMPTS` feil må et menneske se på den.
 *  - En åpen disputt avgjøres av banken, ikke av et nytt forsøk.
 */
export function refundQueueSkipReason(
  order: Pick<Order, 'stripe_connected_account_id' | 'refund_attempts' | 'dispute_status'>,
): RefundQueueSkipReason | null {
  if (!order.stripe_connected_account_id) return 'missing_connected_account'
  if ((order.refund_attempts ?? 0) >= MAX_REFUND_QUEUE_ATTEMPTS) return 'attempts_exhausted'
  if (isDisputeOpen(order.dispute_status)) return 'dispute_open'
  return null
}

/**
 * Idempotency-nøkkelen er per forsøk, ikke per ordre. Med én nøkkel per ordre
 * svarer Stripe i 24 timer med det lagrede svaret fra et forsøk som feilet —
 * også etter at `syncRefundStatus` har satt ordren tilbake. Telleren øker bare
 * når et forsøk har feilet, så to samtidige kall på samme forsøk deler nøkkel.
 */
export function refundIdempotencyKey(orderId: string, refundAttempts: number | null | undefined): string {
  const attempt = typeof refundAttempts === 'number' && Number.isInteger(refundAttempts) && refundAttempts > 0
    ? refundAttempts
    : 0
  return `refund-${orderId}-${attempt}`
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
 * Refundert beløp etter en ny refusjon: det som alt var registrert pluss
 * refusjonen, aldri over betalingen og aldri under det som står.
 */
export function refundedAmountAfterRefund(
  order: Pick<Order, 'amount_total' | 'refunded_amount'>,
  refundAmount: number,
): number {
  const existing = Math.max(0, order.refunded_amount ?? 0)
  const total = existing + (Number.isFinite(refundAmount) ? Math.max(0, refundAmount) : 0)
  if (order.amount_total === null || order.amount_total === undefined) return total
  return Math.max(existing, Math.min(total, order.amount_total))
}

// Refusjoner som fortsatt teller hos Stripe. `requires_action` er ikke
// avgjort, men er heller ikke feilet — en ny refusjon ved siden av ville
// konkurrert om det samme beløpet.
const ACTIVE_REFUND_STATUSES: readonly string[] = ['pending', 'requires_action', 'succeeded']

/** Dekker refusjonene som ikke har feilet, hele betalingen? */
export function refundsCoverPayment(
  refunds: ReadonlyArray<{ amount: number; status: string | null }>,
  paymentAmount: number | null,
): boolean {
  if (paymentAmount === null || paymentAmount <= 0) return false
  const active = refunds
    .filter((refund) => refund.status !== null && ACTIVE_REFUND_STATUSES.includes(refund.status))
    .reduce((sum, refund) => sum + Math.max(0, refund.amount), 0)
  return active >= paymentAmount
}

/**
 * Ordren etter at Stripe har meldt at en refusjon feilet eller ble kansellert.
 *
 * Den eneste veien `refunded_amount` går ned: Stripe har gitt pengene tilbake
 * til klubbens saldo, og kunden har ikke fått dem. Står betalingen fortsatt
 * som fullt refundert (en annen refusjon dekker den), er det ingenting å
 * rette. `null` = ordren stemmer allerede med Stripe.
 *
 * Billettene røres ikke. På et avlyst show skal de ikke bli gyldige igjen —
 * det er den urefunderte ordren som skal synes, og den blokkerer sletting.
 */
export function refundReversalUpdate(
  order: Pick<
    Order,
    'status' | 'refunded_amount' | 'application_fee_refunded_amount' | 'refunded_at' | 'cancellation_reason' | 'refund_attempts'
  >,
  state: { refundedAmount: number; fullyRefunded: boolean },
  feeRefunded: number | null,
  context: { error: string; now: string },
): Partial<Order> | null {
  if (state.fullyRefunded) return null

  const markedRefunded = order.status === 'refunded' || Boolean(order.refunded_at)
  const amountAhead = (order.refunded_amount ?? 0) > state.refundedAmount
  if (!markedRefunded && !amountAhead) return null

  const update: Partial<Order> = {
    refunded_amount: state.refundedAmount,
    application_fee_refunded_amount: feeRefunded ?? order.application_fee_refunded_amount ?? 0,
  }

  if (markedRefunded) {
    // En ordre uten billett går tilbake i refusjonskøen; en betalt ordre
    // blir betalt igjen og kan refunderes på nytt fra ordrelisten.
    if (order.status === 'refunded') update.status = order.cancellation_reason ? 'cancelled' : 'paid'
    update.refunded_at = null
    update.refund_reason = null
    update.refund_attempts = (order.refund_attempts ?? 0) + 1
    update.last_refund_attempt_at = context.now
    update.last_refund_error = context.error
  }

  return update
}

/**
 * Klubbens netto tap på en disputt: det Stripe trakk (beløp og gebyr) minus
 * det som ble ført tilbake. Leses fra disputtens egne balance transactions,
 * så gebyr og tilbakeføring alltid stemmer med saldoen.
 */
export function disputeNetLoss(dispute: { balance_transactions?: Array<{ net: number }> | null }): number {
  const net = (dispute.balance_transactions ?? []).reduce(
    (sum, transaction) => sum + (Number.isFinite(transaction.net) ? transaction.net : 0),
    0,
  )
  return Math.max(0, -net)
}

/**
 * Ordren etter et disputt-event. Status, tidspunkt og klubbens netto tap
 * speiles alltid; tapet trekkes fra utbetalingen i club_releasable_amount.
 *
 * En tapt disputt som dekker hele det som ikke alt er refundert, lukker
 * ordren som refundert — kunden har pengene tilbake, og billettene skal ikke
 * slippe inn. En tapt delvis disputt lar ordren og billettene stå: resten av
 * betalingen er fortsatt klubbens. Snur Stripe en tapt disputt til vunnet,
 * åpnes ordren igjen.
 */
export function disputeOrderUpdate(
  order: Pick<
    Order,
    'status' | 'amount_total' | 'refunded_amount' | 'refunded_at' | 'refund_reason' | 'disputed_at' | 'cancellation_reason'
  >,
  dispute: { status: string; amount: number; created: number; balance_transactions?: Array<{ net: number }> | null },
  now: string,
): { update: Partial<Order>; invalidateTickets: boolean } {
  const update: Partial<Order> = { dispute_status: dispute.status, dispute_net_amount: disputeNetLoss(dispute) }

  if (!order.disputed_at) {
    update.disputed_at =
      Number.isFinite(dispute.created) && dispute.created > 0 ? new Date(dispute.created * 1000).toISOString() : now
  }

  const closedByDispute = order.status === 'refunded' && order.refund_reason === 'dispute_lost'

  if (dispute.status === 'lost') {
    const alreadyRefunded = order.status === 'refunded' || Boolean(order.refunded_at)
    const outstanding = Math.max(0, (order.amount_total ?? 0) - (order.refunded_amount ?? 0))
    const coversPayment = dispute.amount >= outstanding

    if (coversPayment && !alreadyRefunded && (order.status === 'paid' || order.status === 'cancelled')) {
      // `refunded_amount` endres ikke: pengene gikk tilbake gjennom disputten
      // og står i `dispute_net_amount`. Begge steder ville trukket dem to ganger.
      update.status = 'refunded'
      update.refunded_at = now
      update.refund_reason = 'dispute_lost'
    }

    // Også når ordren alt var lukket: et nytt forsøk fra Stripe etter at
    // billettene ikke kunne oppdateres, skal rette dem.
    return { update, invalidateTickets: coversPayment }
  }

  if (dispute.status === 'won' && closedByDispute) {
    // Sjelden, men dokumentert: en tapt disputt kan bli vunnet senere, og
    // pengene kommer tilbake til klubben. Billettene står som refundert —
    // showet er som regel over — men pengene frigis igjen. En ordre uten
    // billetter går tilbake i refusjonskøen, for da har kunden ikke fått noe.
    update.status = order.cancellation_reason ? 'cancelled' : 'paid'
    update.refunded_at = null
    update.refund_reason = null
  }

  return { update, invalidateTickets: false }
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

function stripeId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

function pastDeadline(deadline: number | undefined) {
  return typeof deadline === 'number' && Date.now() > deadline
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
  if (eligibility.kind === 'not_refundable') {
    // En betaling uten Stripe-referanse kommer aldri gjennom. Forsøket
    // registreres, så det synes på ordren hvorfor den står urefundert.
    if (eligibility.code === 'missing_stripe_reference') {
      await recordRefundFailure(order, eligibility.error, { countAttempt: true })
    }
    return { ok: false, orderId, error: eligibility.error }
  }

  const context = { paymentIntentId: eligibility.paymentIntentId, accountId: eligibility.accountId, reason }

  // Etter et feilet forsøk er nøkkelen ny, og Stripe beskytter ikke lenger
  // mot en refusjon til ved siden av en som fortsatt er underveis. Da sjekkes
  // refusjonene på betalingen først.
  if ((order.refund_attempts ?? 0) > 0) {
    const synced = await syncIfAlreadyRefunded(order, context)
    if (synced) return synced
  }

  let refund: Stripe.Refund
  try {
    // Uten `amount` refunderer Stripe det som gjenstår — også etter en
    // delrefusjon i dashbordet — og aldri mer enn betalingen.
    refund = await stripe.refunds.create(
      {
        payment_intent: context.paymentIntentId,
        refund_application_fee: true,
        reason: stripeRefundReason(reason),
        metadata: { order_id: order.id, refund_reason: reason },
      },
      { stripeAccount: context.accountId, idempotencyKey: refundIdempotencyKey(order.id, order.refund_attempts) },
    )
  } catch (error) {
    return recoverFromRefundError(order, context, error)
  }

  // En refusjon kan avvises med en gang (typisk for lav saldo på klubbens
  // konto for enkelte betalingsmetoder). Da er ingenting sendt tilbake.
  if (refund.status === 'failed' || refund.status === 'canceled') {
    const error =
      `Stripe could not refund the payment (refund ${refund.id} is ${refund.status}` +
      `${refund.failure_reason ? `: ${refund.failure_reason}` : ''}). Refund it in the Stripe dashboard or contact support.`
    console.error(`[Refund] Stripe refund ${refund.id} for order ${order.id} is ${refund.status}`)
    await recordRefundFailure(order, error, { countAttempt: true })
    return { ok: false, orderId: order.id, error }
  }

  // `pending` og `requires_action` regnes som refundert nå. Feiler de senere,
  // setter `syncRefundStatus` ordren tilbake (refund.failed / refund.updated).
  if (refund.status !== 'succeeded') {
    console.warn(
      `[Refund] Stripe refund ${refund.id} for order ${order.id} is ${refund.status}` +
        `${refund.pending_reason ? ` (${refund.pending_reason})` : ''} — marked refunded; reverted if Stripe fails it`,
    )
  }

  // Provisjonen leses fra Stripe i stedet for å antas. Etter en delrefusjon
  // uten provisjon gir Stripe bare en forholdsmessig del tilbake.
  const feeRefunded = await readApplicationFeeRefundedById(order.stripe_application_fee_id, order.id)

  // Beløpene på ordren står, de nullstilles ikke. Hovedboken skal vise hva
  // salget var; `refunded_amount` og `application_fee_refunded_amount` sier
  // hvor mye som gikk tilbake.
  const { error: orderError } = await db
    .from('orders')
    .update({
      status: 'refunded',
      refunded_at: order.refunded_at ?? new Date().toISOString(),
      refund_reason: reason,
      refunded_amount: refundedAmountAfterRefund(order, refund.amount),
      application_fee_refunded_amount: feeRefunded ?? order.application_fee_refunded_amount ?? 0,
      // `pending` / `requires_action` blokkerer sletting av showet til Stripe
      // melder `succeeded` (refund.updated) eller feil (syncRefundStatus).
      refund_status: refund.status,
      last_refund_error: null,
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
 * Et tidligere forsøk feilet, men kan likevel ha lagt igjen en refusjon som
 * er underveis (et tidsavbrudd etter at Stripe tok imot kallet). Dekker
 * refusjonene som ikke har feilet hele betalingen, synkroniseres ordren i
 * stedet for å lage en ny. `null` = lag refusjonen.
 */
async function syncIfAlreadyRefunded(
  order: RefundOrderRow,
  context: { paymentIntentId: string; accountId: string; reason: RefundReason },
): Promise<RefundResult | null> {
  try {
    const refunds = await stripe.refunds.list(
      { payment_intent: context.paymentIntentId, limit: 100 },
      { stripeAccount: context.accountId },
    )
    if (!refundsCoverPayment(refunds.data, order.amount_total)) return null

    const charge = await readLatestCharge(context.paymentIntentId, context.accountId)
    if (!charge || !refundStateFromCharge(charge).fullyRefunded) return null

    await applyChargeRefund(order, charge, context.reason)
    console.log(`[Refund] Order ${order.id} is already covered by refunds in Stripe (${charge.id}) — order synced`)
    return { ok: true, orderId: order.id, amount: 0 }
  } catch (error) {
    // Sjekken er et ekstra vern. Stripe refunderer aldri mer enn betalingen,
    // og `charge_already_refunded` fanges under — forsøket kan gå videre.
    console.warn(`[Refund] Could not check earlier refunds for order ${order.id}: ${errorMessage(error)}`)
    return null
  }
}

/**
 * Stripe sier nei, men pengene kan likevel være sendt tilbake:
 *
 *  - `charge_already_refunded`: refundert i dashbordet, eller av et tidligere
 *    forsøk som krasjet før ordren ble oppdatert.
 *  - `idempotency_error`: samme nøkkel med andre parametere (bookeren valgte
 *    en annen årsak ved nytt forsøk) eller et parallelt kall som ikke er
 *    ferdig.
 *
 * I begge tilfeller er betalingen selv fasiten. Er den fullt refundert,
 * synkroniseres ordren slik `charge.refunded` ville gjort det.
 *
 * Alt annet er et feilet forsøk og registreres på ordren. Neste forsøk får da
 * en ny idempotency-nøkkel i stedet for Stripes lagrede svar.
 */
async function recoverFromRefundError(
  order: RefundOrderRow,
  context: { paymentIntentId: string; accountId: string; reason: RefundReason },
  error: unknown,
): Promise<RefundResult> {
  const info = stripeErrorInfo(error)
  const message = errorMessage(error)

  if (info?.code === 'charge_disputed') {
    // Disputten er ikke registrert hos oss ennå (webhooken kommer). Det er
    // ikke et feilet forsøk: banken avgjør, og køen skal ikke gi opp ordren
    // mens saken pågår. Ingen feilmelding lagres heller — den ville stått
    // igjen på ordren etter at disputten er avgjort.
    console.warn(`[Refund] Order ${order.id} cannot be refunded: the payment is disputed`)
    await recordRefundFailure(order, null, { countAttempt: false })
    return { ok: false, orderId: order.id, error: DISPUTE_OPEN_MESSAGE }
  }

  const alreadyRefunded = info?.code === 'charge_already_refunded'
  const idempotencyConflict = info?.rawType === 'idempotency_error' || info?.type === 'StripeIdempotencyError'

  if (!alreadyRefunded && !idempotencyConflict) {
    const text =
      info?.code === 'resource_missing'
        ? `The payment was not found on the club’s Stripe account (${message}). Refund it in the Stripe dashboard.`
        : `Stripe could not refund the payment: ${message}`
    console.error(`[Refund] Stripe refused to refund order ${order.id}: ${message}`)
    // Rate limit er ikke et forsøk Stripe har lagret — det skal ikke telle
    // mot grensen i køen.
    await recordRefundFailure(order, text, { countAttempt: info?.type !== 'StripeRateLimitError' })
    return { ok: false, orderId: order.id, error: text }
  }

  let charge: Stripe.Charge | null
  try {
    charge = await readLatestCharge(context.paymentIntentId, context.accountId)
  } catch (retrieveError) {
    const retrieveMessage = errorMessage(retrieveError)
    console.error(`[Refund] Could not read the charge for order ${order.id} after "${message}": ${retrieveMessage}`)
    const text = `Stripe reports the payment as already refunded, but the payment could not be read: ${retrieveMessage}`
    await recordRefundFailure(order, text, { countAttempt: false })
    return { ok: false, orderId: order.id, error: text }
  }

  if (!charge) {
    console.error(`[Refund] Order ${order.id}: "${message}", and payment ${context.paymentIntentId} has no charge`)
    const text = `Stripe could not refund the payment: ${message}`
    await recordRefundFailure(order, text, { countAttempt: true })
    return { ok: false, orderId: order.id, error: text }
  }

  if (!refundStateFromCharge(charge).fullyRefunded) {
    console.warn(`[Refund] Order ${order.id}: "${message}", but charge ${charge.id} is not fully refunded`)
    // Et idempotency-avvik beviser ikke at noe er underveis: nøkkelen kan
    // like gjerne ha et lagret svar fra et forsøk som feilet.
    const text = idempotencyConflict
      ? 'An earlier refund attempt for this order has not completed in Stripe. Try again in a few minutes, or check the payment in the Stripe dashboard.'
      : `Stripe could not refund the payment: ${message}`
    await recordRefundFailure(order, text, { countAttempt: true })
    return { ok: false, orderId: order.id, error: text }
  }

  await applyChargeRefund(order, charge, context.reason)
  console.log(`[Refund] Order ${order.id} was already refunded in Stripe (${charge.id}) — order synced`)
  return { ok: true, orderId: order.id, amount: 0 }
}

/**
 * Et forsøk som ikke ga refusjon. Tidspunktet flytter ordren bakerst i køen.
 * `countAttempt` øker telleren som gir ny idempotency-nøkkel og slipper køen
 * videre. Kaster ikke: refusjonen har allerede feilet, og det er det kalleren
 * skal få vite.
 */
async function recordRefundFailure(
  order: Pick<RefundOrderRow, 'id' | 'refund_attempts'>,
  message: string | null,
  options: { countAttempt: boolean },
) {
  const update: Partial<Order> = { last_refund_attempt_at: new Date().toISOString() }
  if (message) update.last_refund_error = message.slice(0, 1000)
  if (options.countAttempt) update.refund_attempts = (order.refund_attempts ?? 0) + 1

  const { error } = await createAdminClient().from('orders').update(update).eq('id', order.id)
  if (error) {
    console.error(`[Refund] Could not record the failed refund attempt on order ${order.id}: ${error.message}`)
  }
}

// ─────────────────────────────────────────────────────────────
// Synkronisering fra Stripe (charge.refunded, refund.*, disputter)
// ─────────────────────────────────────────────────────────────

/**
 * Speiler refusjonstilstanden på en betaling over på ordren.
 *
 * Kalles av `charge.refunded`, som også kommer for delrefusjoner og for
 * refusjoner gjort i Stripe-dashbordet. Kaster ved database- og Stripe-feil,
 * slik at webhooken svarer 500 og Stripe prøver igjen.
 */
export async function syncRefundFromCharge(charge: Stripe.Charge, accountId: string | null): Promise<void> {
  const order = await findOrder({ chargeId: charge.id, paymentIntentId: stripeId(charge.payment_intent) })

  if (!order) {
    // Betalinger som ikke er billettsalg (eller testdata) har ingen ordre.
    // Et nytt forsøk fra Stripe ville ikke funnet den heller.
    console.warn(`[Refund] charge.refunded for ${charge.id} on ${accountId ?? 'platform'} matches no order — ignored`)
    return
  }

  if (belongsToOtherAccount(order, accountId)) {
    console.error(
      `[Refund] charge.refunded for ${charge.id} came from ${accountId}, but order ${order.id} ` +
        `belongs to ${order.stripe_connected_account_id} — not synced`,
    )
    return
  }

  // Eventet er et øyeblikksbilde. Stripe leverer på nytt i opptil tre døgn, og
  // en refusjon kan ha feilet i mellomtiden — da skal ordren ikke merkes
  // refundert igjen etter at `syncRefundStatus` satte den tilbake.
  const current = await retrieveCharge(charge.id, accountId ?? order.stripe_connected_account_id)

  // En kansellert ordre har aldri hatt billetter, så årsaken er kjent selv
  // når refusjonen ble gjort utenfor Tickethalo.
  const fallbackReason: RefundReason = order.status === 'cancelled' ? 'no_ticket_issued' : 'other'
  await applyChargeRefund(order, current, fallbackReason)
}

/**
 * En refusjon har feilet eller blitt kansellert hos Stripe (`refund.failed`,
 * `refund.updated`, `charge.refund.updated`). Pengene er tilbake på klubbens
 * saldo, og kunden har ikke fått dem.
 *
 * Betalingen leses på nytt fra Stripe: dekker andre refusjoner den fortsatt,
 * er ingenting feil. Ellers settes ordren tilbake til betalt (eller til
 * refusjonskøen), slik at den blokkerer sletting av showet og kan refunderes
 * igjen med en ny idempotency-nøkkel. Kaster ved database- og Stripe-feil.
 */
export async function syncRefundStatus(refund: Stripe.Refund, accountId: string | null): Promise<void> {
  if (refund.status === 'succeeded') {
    await markRefundSettled(refund, accountId)
    return
  }
  if (refund.status !== 'failed' && refund.status !== 'canceled') return

  const chargeId = stripeId(refund.charge)
  const paymentIntentId = stripeId(refund.payment_intent)
  const order = await findOrder({ orderId: refund.metadata?.order_id ?? null, chargeId, paymentIntentId })

  if (!order) {
    console.warn(`[Refund] Refund ${refund.id} (${refund.status}) on ${accountId ?? 'platform'} matches no order — ignored`)
    return
  }

  if (belongsToOtherAccount(order, accountId)) {
    console.error(
      `[Refund] Refund ${refund.id} came from ${accountId}, but order ${order.id} ` +
        `belongs to ${order.stripe_connected_account_id} — not synced`,
    )
    return
  }

  const failure = `Stripe refund ${refund.id} ${refund.status}${refund.failure_reason ? ` (${refund.failure_reason})` : ''}`

  if (order.dispute_status === 'lost') {
    // Refusjonen feilet fordi kunden gikk til banken (typisk
    // `charge_for_pending_refund_disputed`). Pengene kom tilbake gjennom
    // disputten, så ordren er fortsatt refundert.
    console.warn(`[Refund] ${failure} for order ${order.id}, but the dispute was lost and the buyer has the money back — order stays refunded`)
    return
  }

  const account = accountId ?? order.stripe_connected_account_id
  const charge = chargeId
    ? await retrieveCharge(chargeId, account)
    : paymentIntentId
      ? await readLatestCharge(paymentIntentId, account)
      : null

  if (!charge) {
    console.error(`[Refund] ${failure} for order ${order.id}, but its payment could not be found — check it in Stripe`)
    return
  }

  const state = refundStateFromCharge(charge)
  const feeRefunded = await readApplicationFeeRefunded(charge, order)
  const update = refundReversalUpdate(order, state, feeRefunded, {
    error: `${failure}. The buyer has not received the money.`,
    now: new Date().toISOString(),
  })

  if (!update) {
    await clearUnsettledRefundStatus(order.id, refund.status)
    console.log(`[Refund] ${failure} for order ${order.id} — the order already matches Stripe`)
    return
  }
  update.refund_status = refund.status

  // Vaktene gjør at `refund.failed`, `refund.updated` og
  // `charge.refund.updated` for samme refusjon bare teller ett forsøk, også
  // når de kommer samtidig.
  let query = createAdminClient().from('orders').update(update).eq('id', order.id).eq('status', order.status)
  if (order.refunded_at) query = query.not('refunded_at', 'is', null)

  const { error } = await query
  if (error) {
    throw new Error(`Could not record the failed refund ${refund.id} on order ${order.id}: ${error.message}`)
  }

  if (update.refunded_at === null) {
    console.error(
      `[Refund] ALERT: ${failure}. Order ${order.id} is no longer refunded — Stripe shows ` +
        `${state.refundedAmount} of ${charge.amount} refunded. ` +
        (order.cancellation_reason
          ? 'It is back in the refund queue.'
          : 'It is paid again and must be refunded from the orders list.'),
    )
  } else {
    console.warn(`[Refund] ${failure}: order ${order.id} now shows ${state.refundedAmount} refunded`)
  }
}

/**
 * En refusjon som var `pending` eller `requires_action` er fullført. Da
 * blokkerer den ikke lenger sletting av showet.
 */
async function markRefundSettled(refund: Stripe.Refund, accountId: string | null): Promise<void> {
  const order = await findOrder({
    orderId: refund.metadata?.order_id ?? null,
    chargeId: stripeId(refund.charge),
    paymentIntentId: stripeId(refund.payment_intent),
  })
  if (!order || belongsToOtherAccount(order, accountId)) return
  await clearUnsettledRefundStatus(order.id, 'succeeded')
}

async function clearUnsettledRefundStatus(orderId: string, status: string): Promise<void> {
  const { error } = await createAdminClient()
    .from('orders')
    .update({ refund_status: status })
    .eq('id', orderId)
    .in('refund_status', ['pending', 'requires_action'])
  if (error) throw new Error(`Could not update the refund status on order ${orderId}: ${error.message}`)
}

/**
 * Speiler en disputt på ordren (`charge.dispute.*`).
 *
 * Disputten leses på nytt fra Stripe, fordi eventene kan komme i feil
 * rekkefølge: en sen `charge.dispute.created` skal ikke åpne en avgjort sak
 * igjen. En tapt disputt lukker ordren som refundert. Kaster ved database- og
 * Stripe-feil, slik at Stripe prøver igjen.
 */
export async function syncDisputeFromStripe(dispute: Stripe.Dispute, accountId: string | null): Promise<void> {
  const order = await findOrder({ chargeId: stripeId(dispute.charge), paymentIntentId: stripeId(dispute.payment_intent) })

  if (!order) {
    console.warn(`[Dispute] Dispute ${dispute.id} on ${accountId ?? 'platform'} matches no order — ignored`)
    return
  }

  if (belongsToOtherAccount(order, accountId)) {
    console.error(
      `[Dispute] Dispute ${dispute.id} came from ${accountId}, but order ${order.id} ` +
        `belongs to ${order.stripe_connected_account_id} — not synced`,
    )
    return
  }

  const account = accountId ?? order.stripe_connected_account_id
  let current: Stripe.Dispute
  try {
    current = await stripe.disputes.retrieve(dispute.id, {}, account ? { stripeAccount: account } : undefined)
  } catch (error) {
    throw new Error(`Could not read dispute ${dispute.id} in Stripe: ${errorMessage(error)}`)
  }

  const { update, invalidateTickets } = disputeOrderUpdate(order, current, new Date().toISOString())

  const { error } = await createAdminClient().from('orders').update(update).eq('id', order.id)
  if (error) {
    throw new Error(`Could not record dispute ${current.id} on order ${order.id}: ${error.message}`)
  }

  if (invalidateTickets) await markTicketsRefunded(order.id, `lost dispute ${current.id}`)

  const summary =
    `dispute ${current.id} (${current.reason}, ${current.amount} ${current.currency}) on order ${order.id} ` +
    `is ${current.status}`

  if (update.refund_reason === 'dispute_lost') {
    console.warn(`[Dispute] ${summary} — the buyer has the money back; order closed as refunded`)
  } else if (isDisputeOpen(current.status)) {
    console.warn(`[Dispute] ${summary} — the order cannot be refunded and the show cannot be deleted until it is resolved`)
  } else {
    console.log(`[Dispute] ${summary}`)
  }
}

function belongsToOtherAccount(order: RefundOrderRow, accountId: string | null) {
  return Boolean(accountId && order.stripe_connected_account_id && order.stripe_connected_account_id !== accountId)
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function findOrder(refs: {
  orderId?: string | null
  chargeId?: string | null
  paymentIntentId?: string | null
}): Promise<RefundOrderRow | null> {
  const db = createAdminClient()

  // Refusjoner fra Tickethalo har ordren i metadata. Den må likevel høre til
  // samme betaling — ellers slås den opp på vanlig måte.
  if (refs.orderId && UUID_PATTERN.test(refs.orderId)) {
    const { data, error } = await db.from('orders').select(ORDER_REFUND_COLUMNS).eq('id', refs.orderId).maybeSingle()
    if (error) throw new Error(`Could not look up order ${refs.orderId}: ${error.message}`)
    if (data && (!refs.paymentIntentId || data.stripe_payment_intent_id === refs.paymentIntentId)) return data
  }

  if (refs.chargeId) {
    const { data, error } = await db
      .from('orders')
      .select(ORDER_REFUND_COLUMNS)
      .eq('stripe_charge_id', refs.chargeId)
      .maybeSingle()

    if (error) throw new Error(`Could not look up the order for charge ${refs.chargeId}: ${error.message}`)
    if (data) return data
  }

  // `stripe_charge_id` mangler når betalingen ikke kunne leses ved kjøpet
  // (se `readChargeFacts`). Payment intent er alltid lagret.
  if (!refs.paymentIntentId) return null

  const { data, error } = await db
    .from('orders')
    .select(ORDER_REFUND_COLUMNS)
    .eq('stripe_payment_intent_id', refs.paymentIntentId)
    .maybeSingle()

  if (error) {
    throw new Error(`Could not look up the order for payment ${refs.paymentIntentId}: ${error.message}`)
  }
  return data
}

/** Betalingen ligger på klubbens konto. Uten konto er den en eldre plattformbetaling. */
async function retrieveCharge(chargeId: string, accountId: string | null): Promise<Stripe.Charge> {
  try {
    return await stripe.charges.retrieve(chargeId, {}, accountId ? { stripeAccount: accountId } : undefined)
  } catch (error) {
    throw new Error(`Could not read charge ${chargeId} in Stripe: ${errorMessage(error)}`)
  }
}

/** Siste charge på en payment intent, eller `null` når den ikke har noen. Kaster ved Stripe-feil. */
async function readLatestCharge(paymentIntentId: string, accountId: string | null): Promise<Stripe.Charge | null> {
  const intent = await stripe.paymentIntents.retrieve(
    paymentIntentId,
    { expand: ['latest_charge'] },
    accountId ? { stripeAccount: accountId } : undefined,
  )
  return typeof intent.latest_charge === 'object' ? intent.latest_charge : null
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

  // Refundert beløp går aldri ned her: bare `syncRefundStatus` vet at en
  // refusjon faktisk feilet. Provisjonen leses alltid live fra Stripe og
  // skrives som den er — en for høy verdi fra et tidligere anslag rettes.
  const update: Partial<Order> = {
    refunded_amount: Math.max(order.refunded_amount ?? 0, state.refundedAmount),
    application_fee_refunded_amount: feeRefunded ?? order.application_fee_refunded_amount ?? 0,
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
  return readApplicationFeeRefundedById(feeId, order.id)
}

async function readApplicationFeeRefundedById(feeId: string | null, orderId: string): Promise<number | null> {
  if (!feeId) return null

  try {
    const fee = await stripe.applicationFees.retrieve(feeId)
    return fee.amount_refunded
  } catch (error) {
    console.warn(`[Refund] Could not read application fee ${feeId} for order ${orderId}: ${errorMessage(error)}`)
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
      `The money is back with the buyer (${source}), but the tickets for order ${orderId} could not be invalidated ` +
        `(${error.message}). The Stripe webhook retries and will correct the tickets.`,
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
 * `deadline` (epoch ms) lar kalleren holde seg innenfor funksjonens tidsgrense.
 * Ordrer som ikke ble startet, rapporteres som `remaining` og tas ved neste
 * kall — de som er refundert, er ute av listen da.
 *
 * Kaster hvis ordrene ikke kan leses — en tom liste ville sett ut som «alt er
 * refundert».
 */
export async function refundShow(
  showId: string,
  options?: { deadline?: number },
): Promise<{ total: number; refunded: number; failed: number; errors: string[]; remaining: number }> {
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

  let attempted = 0
  let refunded = 0
  let remaining = 0
  const errors: string[] = []

  // Én og én: parallelle refusjoner mot samme konto gir rate limits, og
  // rekkefølgen gjør loggen lesbar når noe feiler.
  for (const [index, target] of targets.entries()) {
    if (pastDeadline(options?.deadline)) {
      remaining = targets.length - index
      break
    }

    attempted += 1
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

  const failed = attempted - refunded
  console.log(
    `[Refund] Show ${showId}: refunded ${refunded}/${targets.length} orders` +
      (remaining > 0 ? `, ${remaining} left for the next run` : ''),
  )

  return { total: targets.length, refunded, failed, errors, remaining }
}

/**
 * Refusjonskøen: betalinger som ble til kansellerte ordrer uten billett.
 *
 * Checkout refunderer dem med en gang (`finalizeCheckoutSession`). Dette er
 * sikkerhetsnettet når det umiddelbare forsøket feilet — Stripe var nede,
 * funksjonen ble avbrutt, eller databasen svarte ikke. `minAgeMinutes` holder
 * køen unna ordrer som checkout fortsatt holder på å refundere.
 *
 * Ordrer som aldri har vært forsøkt, går først, deretter den som ble forsøkt
 * for lengst siden. Ordrer som alltid feiler, kan dermed ikke holde plassen
 * foran nyere ordrer. Se `refundQueueSkipReason` for hva som holdes utenfor.
 */
export async function processRefundQueue(
  options?: { minAgeMinutes?: number; limit?: number; deadline?: number },
): Promise<{ processed: number; refunded: number; failed: number; deferred: number }> {
  const minAgeMinutes = Math.max(0, options?.minAgeMinutes ?? 5)
  const limit = Math.max(1, options?.limit ?? 50)
  const cutoff = new Date(Date.now() - minAgeMinutes * 60_000).toISOString()
  const db = createAdminClient()

  const { data: orders, error } = await db
    .from('orders')
    .select('id, stripe_connected_account_id, refund_attempts, dispute_status')
    .eq('status', 'cancelled')
    .not('stripe_payment_intent_id', 'is', null)
    .not('stripe_connected_account_id', 'is', null)
    .is('refunded_at', null)
    .lt('refund_attempts', MAX_REFUND_QUEUE_ATTEMPTS)
    .or(`dispute_status.is.null,dispute_status.in.(${CLOSED_DISPUTE_STATUSES.join(',')})`)
    .lt('created_at', cutoff)
    .order('last_refund_attempt_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Could not read the refund queue: ${error.message}`)

  const queue = (orders ?? []).filter((order) => refundQueueSkipReason(order) === null)

  let processed = 0
  let refunded = 0
  let failed = 0
  let deferred = 0

  for (const [index, order] of queue.entries()) {
    if (pastDeadline(options?.deadline)) {
      deferred = queue.length - index
      break
    }

    processed += 1
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

  if (processed > 0 || deferred > 0) {
    console.log(
      `[Refund queue] Processed ${processed}: ${refunded} refunded, ${failed} failed` +
        (deferred > 0 ? `, ${deferred} deferred to the next run` : ''),
    )
  }

  await reportAbandonedRefunds()

  return { processed, refunded, failed, deferred }
}

/**
 * Ordrer køen har gitt opp, sies høyt hver kjøring. Kunden venter fortsatt på
 * pengene, og ingen andre deler av systemet vil prøve igjen.
 */
async function reportAbandonedRefunds() {
  const { count, error } = await createAdminClient()
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'cancelled')
    .not('stripe_payment_intent_id', 'is', null)
    .not('stripe_connected_account_id', 'is', null)
    .is('refunded_at', null)
    .gte('refund_attempts', MAX_REFUND_QUEUE_ATTEMPTS)

  if (error) {
    console.warn(`[Refund queue] Could not count abandoned refunds: ${error.message}`)
    return
  }

  if (count) {
    console.error(
      `[Refund queue] ALERT: ${count} paid orders without tickets failed ${MAX_REFUND_QUEUE_ATTEMPTS} refund attempts ` +
        'and are no longer retried. Refund them manually — see last_refund_error on each order.',
    )
  }
}
