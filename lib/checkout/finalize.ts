import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTicketPurchaseEmail } from '@/lib/email/mailer'
import { refundOrder } from '@/lib/refunds'
import type { OrderCancellationReason } from '@/types/database'

type FinalizeCheckoutResult = {
  result: 'created' | 'duplicate' | 'sold_out' | 'invalid_show' | 'missing_show' | 'unpaid' | 'failed'
  orderId?: string | null
  ticketCode?: string | null
  /** Alle billettkodene i ordren. Én per plass i bestillingen. */
  ticketCodes?: string[]
  emailSent?: boolean
  emailError?: string
  /** Settes når betalingen er bokført, slik at gebyr-oppgjøret kan kjøres. */
  chargeId?: string | null
  /**
   * Betalingen ga ingen billett (utsolgt eller ugyldig show). Settes også på
   * `duplicate`, slik at suksessiden ikke sier «billetten er sendt» når
   * webhooken kom først og ordren ble kansellert.
   */
  cancellationReason?: OrderCancellationReason | null
  /** Kjøperen har fått pengene tilbake. Bare satt når ingen billett ble utstedt. */
  refunded?: boolean
}

/**
 * Betalingen ligger på klubbens Connect-konto, ikke på plattformkontoen.
 * Uten `stripeAccount` finner Stripe verken payment intent eller charge.
 */
type ChargeFacts = {
  chargeId: string | null
  applicationFeeId: string | null
  applicationFeeAmount: number | null
  paymentMethodType: string | null
}

async function readChargeFacts(
  paymentIntentId: string | null,
  accountId: string | null,
): Promise<ChargeFacts> {
  const empty: ChargeFacts = {
    chargeId: null,
    applicationFeeId: null,
    applicationFeeAmount: null,
    paymentMethodType: null,
  }
  if (!paymentIntentId || !accountId) return empty

  try {
    const intent = await stripe.paymentIntents.retrieve(
      paymentIntentId,
      { expand: ['latest_charge'] },
      { stripeAccount: accountId },
    )

    const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
    if (!charge) return empty

    const applicationFee = charge.application_fee
    return {
      chargeId: charge.id,
      applicationFeeId:
        typeof applicationFee === 'string' ? applicationFee : applicationFee?.id ?? null,
      applicationFeeAmount: charge.application_fee_amount ?? intent.application_fee_amount ?? null,
      paymentMethodType: charge.payment_method_details?.type ?? null,
    }
  } catch (error) {
    // Hovedboken er verdt et forsøk, men den skal aldri stoppe en billett.
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[Checkout] Could not read charge for ${paymentIntentId} on ${accountId}: ${message}`)
    return empty
  }
}

function resolveAppOrigin(session: Stripe.Checkout.Session) {
  const metadataOrigin = session.metadata?.app_origin
  if (metadataOrigin) return metadataOrigin

  if (process.env.APP_URL) return process.env.APP_URL
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  // Her, i motsetning til e-postlenkene, er VERCEL_URL brukbar: brukeren står
  // i nettleseren på samme deploy og sendes rett tilbake dit.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

function buildTicketVerificationUrl(origin: string, ticketCode: string) {
  return `${origin.replace(/\/$/, '')}/admin-app/tickets/verify?code=${encodeURIComponent(ticketCode)}`
}

/**
 * Kjøperen har betalt, men fikk ingen billett. Pengene sendes tilbake med én
 * gang i stedet for at noen må oppdage ordren og refundere manuelt.
 *
 * Feiler det, står ordren i refusjonskøen (`processRefundQueue`) og prøves
 * igjen — derfor logges feilen i stedet for å kastes. En kastet feil ville
 * gitt webhooken 500 og suksessiden en feilside for en ordre som allerede er
 * bokført.
 */
async function refundOrderWithoutTicket(orderId: string, sessionId: string): Promise<boolean> {
  try {
    const result = await refundOrder(orderId, 'no_ticket_issued')
    if (result.ok) return true

    console.error(
      `[Checkout] Automatic refund of order ${orderId} (session ${sessionId}) failed: ${result.error} — the refund queue will retry`,
    )
    return false
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `[Checkout] Automatic refund of order ${orderId} (session ${sessionId}) failed: ${message} — the refund queue will retry`,
    )
    return false
  }
}

async function readOrderWithoutTicket(
  orderId: string | null,
): Promise<{ cancellationReason: OrderCancellationReason | null; refunded: boolean }> {
  if (!orderId) return { cancellationReason: null, refunded: false }

  const { data: order, error } = await createAdminClient()
    .from('orders')
    .select('status, cancellation_reason, refunded_at')
    .eq('id', orderId)
    .maybeSingle()

  if (error) {
    console.warn(`[Checkout] Could not read order ${orderId} without tickets: ${error.message}`)
    return { cancellationReason: null, refunded: false }
  }

  return {
    cancellationReason: order?.cancellation_reason ?? null,
    refunded: order?.status === 'refunded' || Boolean(order?.refunded_at),
  }
}

export async function finalizeCheckoutSession(
  session: Stripe.Checkout.Session,
  options?: { accountId?: string | null },
): Promise<FinalizeCheckoutResult> {
  const admin = createAdminClient()
  const showId = session.metadata?.show_id

  if (!showId) return { result: 'missing_show' }
  if (session.payment_status && session.payment_status !== 'paid') return { result: 'unpaid' }

  const buyerEmail = session.customer_details?.email ?? session.customer_email ?? ''
  const buyerName = session.customer_details?.name ?? ''

  // Antall og navn ble lagt på sesjonen da den ble opprettet — se
  // `createCheckoutSession`. Uten dem er det én navnløs billett, som før.
  const quantity = Math.max(1, Number(session.metadata?.quantity ?? 1) || 1)
  const holderNames = Array.from(
    { length: quantity },
    (_, index) => session.metadata?.[`ticket_name_${index + 1}`]?.trim() || '',
  )

  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null
  const accountId = options?.accountId ?? session.metadata?.connected_account_id ?? null
  const charge = await readChargeFacts(paymentIntentId, accountId)

  const { data: completion, error: completionError } = await admin
    .rpc('complete_checkout_order', {
      p_show_id: showId,
      p_session_id: session.id,
      p_payment_intent_id: paymentIntentId,
      p_stripe_customer_id: typeof session.customer === 'string' ? session.customer : null,
      p_amount_total: session.amount_total ?? 0,
      p_currency: (session.currency ?? 'nok').toUpperCase(),
      p_buyer_email: buyerEmail || null,
      p_buyer_name: buyerName || null,
      p_club_id: session.metadata?.club_id ?? null,
      p_connected_account_id: accountId,
      p_charge_id: charge.chargeId,
      p_application_fee_id: charge.applicationFeeId,
      p_platform_fee_amount: charge.applicationFeeAmount,
      p_payment_method_type: charge.paymentMethodType,
      p_quantity: quantity,
      p_ticket_names: holderNames,
    })
    .single()

  if (completionError || !completion) {
    console.error('[Checkout] Failed to complete checkout:', completionError?.message)
    return { result: 'failed', emailError: completionError?.message }
  }

  if (completion.result !== 'created') {
    let cancellationReason: OrderCancellationReason | null = null
    let refunded: boolean | undefined

    if (completion.result === 'sold_out' || completion.result === 'invalid_show') {
      console.error(`[Checkout] Paid session ${session.id} got no ticket (${completion.result}) — refunding`)
      cancellationReason = completion.result
      refunded = completion.order_id
        ? await refundOrderWithoutTicket(completion.order_id, session.id)
        : false
    } else if (
      completion.result === 'duplicate' &&
      !completion.ticket_code &&
      !(completion.ticket_codes?.length ?? 0)
    ) {
      // Den andre av webhooken og suksessiden får `duplicate`. Uten billetter
      // er ordren kansellert, og kjøperen må få vite det — ikke at billetten
      // «allerede er sendt». Refusjonen er den førstes ansvar, og køens.
      const state = await readOrderWithoutTicket(completion.order_id)
      cancellationReason = state.cancellationReason
      refunded = state.refunded
    }

    return {
      result: completion.result,
      orderId: completion.order_id,
      ticketCode: completion.ticket_code,
      ticketCodes: completion.ticket_codes ?? [],
      emailSent: false,
      chargeId: charge.chargeId,
      cancellationReason,
      refunded,
    }
  }

  let emailSent = false
  let emailError: string | undefined

  const ticketCodes = completion.ticket_codes?.length
    ? completion.ticket_codes
    : completion.ticket_code
      ? [completion.ticket_code]
      : []

  if (buyerEmail && ticketCodes.length > 0) {
    const { data: show } = await admin
      .from('shows')
      .select('title, date, start_time, venue_name, venue_address, club_id')
      .eq('id', showId)
      .single()

    // Klubben er selger av billetten og må navngis på den.
    const clubId = session.metadata?.club_id ?? show?.club_id ?? null
    const { data: club } = clubId
      ? await admin
          .from('clubs')
          .select('name, legal_name, org_number, support_email')
          .eq('id', clubId)
          .maybeSingle()
      : { data: null }

    // Navnene leses fra billettene selv, ikke fra metadataen: der er de
    // allerede falt tilbake på kjøperens navn der kjøperen ikke oppga noe.
    const { data: ticketRows } = await admin
      .from('tickets')
      .select('ticket_code, holder_name')
      .in('ticket_code', ticketCodes)

    const holderByCode = new Map((ticketRows ?? []).map((row) => [row.ticket_code, row.holder_name]))
    const origin = resolveAppOrigin(session)

    const emailResult = await sendTicketPurchaseEmail({
      email: buyerEmail,
      buyer_name: buyerName,
      show_title: show?.title ?? session.metadata?.show_title ?? 'Tickethalo',
      show_date: show?.date ?? session.metadata?.show_date ?? '',
      show_time: show?.start_time?.slice(0, 5),
      venue_name: show?.venue_name ?? show?.venue_address ?? '',
      venue_address: show?.venue_name ? show.venue_address : null,
      tickets: ticketCodes.map((code) => ({
        code,
        holderName: holderByCode.get(code) ?? null,
        verificationUrl: buildTicketVerificationUrl(origin, code),
      })),
      seller: club,
    })

    emailSent = emailResult.success
    emailError = emailResult.error
  }
  return {
    result: completion.result,
    orderId: completion.order_id,
    ticketCode: completion.ticket_code,
    ticketCodes,
    emailSent,
    emailError,
    chargeId: charge.chargeId,
  }
}
