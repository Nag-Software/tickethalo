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
    console.error('[Stripe Webhook] Request without stripe-signature header')
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    // Uten secret kan ingenting verifiseres. 500 gjør at Stripe prøver igjen
    // etter at miljøvariabelen er på plass, i stedet for å forkaste eventet.
    console.error('[Stripe Webhook] STRIPE_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature'
    // Nesten alltid en secret fra feil Stripe-konto eller miljø. Uten denne
    // loggen ser det ut som at ingen kjøp skjer.
    console.error(`[Stripe Webhook] Signature verification failed: ${message}`)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break
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

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const completion = await finalizeCheckoutSession(session)

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
