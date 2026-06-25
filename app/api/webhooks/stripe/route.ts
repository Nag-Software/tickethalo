import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { finalizeCheckoutSession } from '@/lib/checkout/finalize'

/**
 * 6.9 Stripe webhook endpoint: /api/webhooks/stripe
 * Handles: checkout.session.completed, payment_intent.payment_failed, charge.refunded
 */
export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const result = await finalizeCheckoutSession(event.data.object as Stripe.Checkout.Session)
      // 'failed' means a transient backend error (e.g. DB unavailable) — return 5xx so
      // Stripe retries with backoff and the paid order is not silently lost. The RPC is
      // keyed on the session id and returns 'duplicate' on replay, so retries are safe.
      // All terminal outcomes (created/duplicate/sold_out/invalid_show/...) return 200.
      if (result.result === 'failed') {
        return NextResponse.json({ error: result.emailError ?? 'finalize failed' }, { status: 500 })
      }
      break
    }
    case 'payment_intent.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.PaymentIntent)
      break
    case 'charge.refunded':
      await handleRefund(event.data.object as Stripe.Charge)
      break
    default:
      // Unhandled event type — ignore
      break
  }

  return NextResponse.json({ received: true })
}

// ─────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────

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

  // Stripe emits charge.refunded for PARTIAL refunds too. Only void the order and its
  // tickets on a FULL refund — a partial/goodwill refund must leave the tickets valid
  // so the customer can still enter the show.
  const fullyRefunded = charge.refunded === true || charge.amount_refunded >= charge.amount
  if (!fullyRefunded) return

  // Update order
  const { data: order } = await admin
    .from('orders')
    .update({ status: 'refunded' })
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
