import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { finalizeCheckoutSession } from '@/lib/checkout/finalize'
import { settleStripeFee } from '@/lib/stripe-fees'
import { syncAccountStatus } from '@/lib/stripe-connect'

/**
 * 6.9 Stripe webhook endpoint: /api/webhooks/stripe
 *
 * Tar imot to strømmer:
 *  - Plattform-events (`account.updated`) med STRIPE_WEBHOOK_SECRET.
 *  - Connect-events fra klubbenes kontoer med STRIPE_CONNECT_WEBHOOK_SECRET.
 *
 * Billettsalget skjer som direct charge på klubbens konto, så
 * `checkout.session.completed` og `charge.*` kommer alltid i den andre
 * strømmen — med `event.account` satt til klubbens konto-ID. Den ID-en må
 * følge med på alle Stripe-oppslag nedstrøms, ellers leter vi på feil konto.
 */
export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    console.error('[Stripe Webhook] Request without stripe-signature header')
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET]
    .filter((secret): secret is string => Boolean(secret))

  if (secrets.length === 0) {
    // Uten secret kan ingenting verifiseres. 500 gjør at Stripe prøver igjen
    // etter at miljøvariabelen er på plass, i stedet for å forkaste eventet.
    console.error('[Stripe Webhook] No webhook secret is configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  let event: Stripe.Event | null = null
  let lastError = 'no secret matched'

  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(body, sig, secret)
      break
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Invalid signature'
    }
  }

  if (!event) {
    // Nesten alltid en secret fra feil Stripe-konto eller miljø. Uten denne
    // loggen ser det ut som at ingen kjøp skjer.
    console.error(`[Stripe Webhook] Signature verification failed: ${lastError}`)
    return NextResponse.json({ error: lastError }, { status: 400 })
  }

  // Tom for plattform-events, klubbens konto-ID for Connect-events.
  const account = event.account ?? null

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, account)
        break
      case 'charge.succeeded':
        await handleChargeSucceeded(event.data.object as Stripe.Charge, account)
        break
      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent)
        break
      case 'charge.refunded':
        await handleRefund(event.data.object as Stripe.Charge)
        break
      case 'charge.dispute.created':
        await handleDispute(event.data.object as Stripe.Dispute, account)
        break
      case 'account.updated':
        await syncAccountStatus((event.data.object as Stripe.Account).id)
        break
      default:
        // Unhandled event type — ignore
        break
    }
  } catch (err) {
    // 500 ber Stripe prøve på nytt. Handlerne er idempotente, så et nytt forsøk
    // er tryggere enn å kvittere for et kjøp vi ikke fullførte.
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[Stripe Webhook] ${event.type} (${event.id}) failed: ${message}`)
    return NextResponse.json({ error: 'Event handling failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}

// ─────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(session: Stripe.Checkout.Session, account: string | null) {
  const completion = await finalizeCheckoutSession(session, { accountId: account })

  // `finalizeCheckoutSession` returnerer utfallet i stedet for å kaste. Kaster
  // vi videre her, får Stripe 500 og prøver igjen — det er ønsket for feil som
  // kan gå over av seg selv, men ikke for utsolgt eller ukjent show.
  if (completion.result === 'failed') {
    throw new Error(`complete_checkout_order failed for session ${session.id}: ${completion.emailError ?? 'unknown error'}`)
  }

  if (completion.result === 'sold_out' || completion.result === 'missing_show') {
    console.error(`[Stripe Webhook] Paid session ${session.id} got no ticket (${completion.result}) — needs manual refund`)
  }

  if (completion.result === 'created' && !completion.emailSent) {
    console.error(`[Stripe Webhook] Ticket ${completion.ticketCode} created but email failed: ${completion.emailError ?? 'unknown error'}`)
  }
}

/**
 * Gebyr-oppgjøret. Kjøres på `charge.succeeded` fordi det er først da Stripe
 * har bokført hva betalingen faktisk kostet. Er transaksjonen ikke bokført
 * ennå, blir ordren stående `pending` og plukkes opp av cron.
 */
async function handleChargeSucceeded(charge: Stripe.Charge, account: string | null) {
  if (!account) return

  const outcome = await settleStripeFee(charge.id, account)
  if (outcome.result === 'pending') {
    console.warn(`[Fees] Charge ${charge.id} not settled yet: ${outcome.reason} — cron will retry`)
  }
}

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  const admin = createAdminClient()
  await admin
    .from('orders')
    .update({ status: 'failed' })
    .eq('stripe_payment_intent_id', paymentIntent.id)
}

async function handleRefund(charge: Stripe.Charge) {
  const admin = createAdminClient()
  const paymentIntentId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : null
  if (!paymentIntentId) return

  // Update order. Beløpene i hovedboken står — avregningen trenger dem for å
  // vise hva som ble solgt og hvor mye som gikk tilbake.
  const { data: order } = await admin
    .from('orders')
    .update({ status: 'refunded', refunded_at: new Date().toISOString() })
    .eq('stripe_payment_intent_id', paymentIntentId)
    .select('id')
    .single()

  if (order) {
    // Mark tickets as refunded
    await admin
      .from('tickets')
      .update({ status: 'refunded' })
      .eq('order_id', order.id)
  }
}

/**
 * Disputen belaster klubbens konto — klubben er selger og bærer
 * arrangementsrisikoen. Vi logger den slik at den kan følges opp.
 */
async function handleDispute(dispute: Stripe.Dispute, account: string | null) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id
  const admin = createAdminClient()

  const { data: order } = await admin
    .from('orders')
    .select('id, club_id, buyer_email')
    .eq('stripe_charge_id', chargeId)
    .maybeSingle()

  console.error(
    `[Stripe Webhook] Dispute ${dispute.id} (${dispute.reason}, ${dispute.amount}) on account ${account ?? 'platform'} ` +
      `— order=${order?.id ?? 'unknown'} club=${order?.club_id ?? 'unknown'}`,
  )
}
