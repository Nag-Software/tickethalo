import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Refusjon.
 *
 * Klubben er selger og ansvarlig for refusjoner. Regelen er at kunden får
 * 100 % tilbake og Tickethalo tilbakefører sin formidlingsprovisjon — klubben
 * skal ikke sitte igjen med en kostnad når pengene går tilbake.
 *
 * Stripe refunderer aldri sitt eget behandlingsgebyr. Siden gebyret etter
 * avtalen er Tickethalos, kompenseres det med en egen overføring, slik at
 * klubben lander på null og Tickethalo bærer tapet.
 */

export type RefundReason = 'show_cancelled' | 'customer_request' | 'duplicate' | 'other'

type RefundResult =
  | { ok: true; orderId: string; amount: number; feeCompensated: number }
  | { ok: false; orderId: string; error: string }

type RefundableOrder = {
  id: string
  status: string
  amount_total: number | null
  currency: string
  stripe_payment_intent_id: string | null
  stripe_connected_account_id: string | null
  stripe_fee_amount: number | null
  club_id: string | null
}

const REFUND_FIELDS =
  'id, status, amount_total, currency, stripe_payment_intent_id, ' +
  'stripe_connected_account_id, stripe_fee_amount, club_id'

export async function refundOrder(orderId: string, reason: RefundReason): Promise<RefundResult> {
  const db = createAdminClient()

  const { data } = await db.from('orders').select(REFUND_FIELDS).eq('id', orderId).maybeSingle()
  const order = data as RefundableOrder | null

  if (!order) return { ok: false, orderId, error: 'Fant ikke ordren.' }
  if (order.status === 'refunded') return { ok: true, orderId, amount: 0, feeCompensated: 0 }
  if (order.status !== 'paid') {
    return { ok: false, orderId, error: `Ordren er ikke betalt (${order.status}).` }
  }
  if (!order.stripe_payment_intent_id || !order.stripe_connected_account_id) {
    return { ok: false, orderId, error: 'Ordren mangler betalingsreferanse i Stripe.' }
  }

  const account = order.stripe_connected_account_id

  // Kunden får hele beløpet. `refund_application_fee` sender den delen av
  // provisjonen Tickethalo fortsatt sitter på tilbake til klubben.
  const refund = await stripe.refunds.create(
    {
      payment_intent: order.stripe_payment_intent_id,
      refund_application_fee: true,
    },
    { stripeAccount: account, idempotencyKey: `refund-${order.id}` },
  )

  const feeCompensated = await compensateStripeFee(order, account)

  // Beløpene står, de nullstilles ikke. Hovedboken skal vise hva salget var,
  // og avregningen trenger klubbens opprinnelige andel for å vite hvor mye
  // som går tilbake — også når refusjonen kommer i en senere periode.
  await db
    .from('orders')
    .update({
      status: 'refunded',
      refunded_at: new Date().toISOString(),
      refund_reason: reason,
    })
    .eq('id', order.id)

  await db.from('tickets').update({ status: 'refunded' }).eq('order_id', order.id)

  return { ok: true, orderId: order.id, amount: refund.amount, feeCompensated }
}

/**
 * Stripes behandlingsgebyr følger ikke med refusjonen tilbake. Uten dette
 * steget ville klubben stått igjen med gebyret som tap på et salg som er
 * annullert — og gebyret er Tickethalos etter avtalen.
 *
 * Feiler overføringen (typisk for lav saldo på plattformkontoen), er kunden
 * fortsatt refundert. Da logges det i stedet for å rulle tilbake noe som
 * allerede har skjedd hos Stripe.
 */
async function compensateStripeFee(order: RefundableOrder, account: string): Promise<number> {
  const fee = order.stripe_fee_amount ?? 0
  if (fee <= 0) return 0

  if (order.club_id) {
    const { data: club } = await createAdminClient()
      .from('clubs')
      .select('absorb_stripe_fee')
      .eq('id', order.club_id)
      .single()

    if (club && club.absorb_stripe_fee === false) return 0
  }

  try {
    await stripe.transfers.create(
      {
        amount: fee,
        currency: (order.currency ?? 'NOK').toLowerCase(),
        destination: account,
        description: `Dekning av betalingsgebyr ved refusjon (ordre ${order.id})`,
        metadata: { order_id: order.id, kind: 'refund_fee_compensation' },
      },
      { idempotencyKey: `refund-fee-${order.id}` },
    )
    return fee
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `[Refund] Could not compensate the ${fee} payment fee to ${account} for order ${order.id}: ${message}. ` +
        'The customer is refunded — the club is short the fee until this is settled manually.',
    )
    return 0
  }
}

/**
 * Avlyst show: alle betalte ordrer refunderes. Per-ordre-idempotens gjør at
 * jobben trygt kan kjøres på nytt om den stopper halvveis.
 */
export async function refundShow(showId: string) {
  const db = createAdminClient()

  const { data: orders } = await db
    .from('orders')
    .select('id')
    .eq('show_id', showId)
    .eq('status', 'paid')

  const results: RefundResult[] = []
  for (const order of orders ?? []) {
    try {
      results.push(await refundOrder(order.id, 'show_cancelled'))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[Refund] Order ${order.id} failed: ${message}`)
      results.push({ ok: false, orderId: order.id, error: message })
    }
  }

  const refunded = results.filter((result) => result.ok).length
  console.log(`[Refund] Show ${showId}: refunded ${refunded}/${results.length} orders`)

  return { total: results.length, refunded, failed: results.length - refunded }
}
