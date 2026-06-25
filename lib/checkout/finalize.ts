import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPublicAppUrl } from '@/lib/app-url'
import { sendTicketPurchaseEmail } from '@/lib/email/mailer'

type FinalizeCheckoutResult = {
  result: 'created' | 'duplicate' | 'sold_out' | 'invalid_show' | 'missing_show' | 'unpaid' | 'failed'
  orderId?: string | null
  ticketCode?: string | null
  emailSent?: boolean
  emailError?: string
}

function resolveAppOrigin(session: Stripe.Checkout.Session) {
  const metadataOrigin = session.metadata?.app_origin
  if (metadataOrigin) return metadataOrigin

  return getPublicAppUrl()
}

function buildTicketVerificationUrl(origin: string, ticketCode: string) {
  return `${origin.replace(/\/$/, '')}/admin-app/tickets/verify?code=${encodeURIComponent(ticketCode)}`
}

/**
 * Refund a session whose payment succeeded but that we cannot fulfil. Only acts on
 * actually-paid sessions with a PaymentIntent (free/0-amount sessions have nothing to
 * refund). Failures are logged, not thrown, so the webhook still returns a terminal
 * status — a stuck refund should be reconciled manually rather than retried forever.
 */
async function refundPaidSession(session: Stripe.Checkout.Session) {
  if (session.payment_status !== 'paid') return
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null
  if (!paymentIntentId) return

  try {
    await stripe.refunds.create({ payment_intent: paymentIntentId })
  } catch (error) {
    console.error('[Checkout] Automatic refund failed for', session.id, error)
  }
}

export async function finalizeCheckoutSession(session: Stripe.Checkout.Session): Promise<FinalizeCheckoutResult> {
  const admin = createAdminClient()
  const showId = session.metadata?.show_id

  if (!showId) return { result: 'missing_show' }
  // 'no_payment_required' is the status for free (0-amount) Stripe checkout sessions
  if (session.payment_status && session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return { result: 'unpaid' }

  const buyerEmail = session.customer_details?.email ?? session.customer_email ?? ''
  const buyerName = session.customer_details?.name ?? ''

  const { data: completion, error: completionError } = await admin
    .rpc('complete_checkout_order', {
      p_show_id: showId,
      p_session_id: session.id,
      p_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
      p_stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
      p_amount_total: session.amount_total ?? 0,
      p_currency: (session.currency ?? 'nok').toUpperCase(),
      p_buyer_email: buyerEmail || null,
      p_buyer_name: buyerName || null,
    })
    .single()

  if (completionError || !completion) {
    console.error('[Checkout] Failed to complete checkout:', completionError?.message)
    return { result: 'failed', emailError: completionError?.message }
  }

  if (completion.result !== 'created') {
    // The customer has already paid but we cannot deliver a ticket (the show sold
    // out in the race after they paid, or the show is no longer valid). Refund the
    // payment automatically so they are never charged for nothing. 'duplicate' is a
    // legitimate idempotent replay (ticket already issued) and must NOT be refunded.
    if (completion.result === 'sold_out' || completion.result === 'invalid_show') {
      console.error(`[Checkout] Unfulfillable checkout (${completion.result}), refunding:`, session.id)
      await refundPaidSession(session)
    }
    return {
      result: completion.result,
      orderId: completion.order_id,
      ticketCode: completion.ticket_code,
      emailSent: false,
    }
  }

  let emailSent = false
  let emailError: string | undefined

  if (buyerEmail && completion.ticket_code) {
    const { data: show } = await admin
      .from('shows')
      .select('title, date, start_time, venue_name, venue_address')
      .eq('id', showId)
      .single()

    const emailResult = await sendTicketPurchaseEmail({
      email: buyerEmail,
      buyer_name: buyerName,
      show_title: show?.title ?? session.metadata?.show_title ?? 'humor.events',
      show_date: show?.date ?? session.metadata?.show_date ?? '',
      show_time: show?.start_time?.slice(0, 5),
      venue_name: show?.venue_name ?? show?.venue_address ?? '',
      venue_address: show?.venue_name ? show.venue_address : null,
      ticket_code: completion.ticket_code,
      verification_url: buildTicketVerificationUrl(resolveAppOrigin(session), completion.ticket_code),
    })

    emailSent = emailResult.success
    emailError = emailResult.error
  }
  return {
    result: completion.result,
    orderId: completion.order_id,
    ticketCode: completion.ticket_code,
    emailSent,
    emailError,
  }
}