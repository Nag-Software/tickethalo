import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { finalizeCheckoutSession } from '@/lib/checkout/finalize'
import { syncRefundFromCharge } from '@/lib/refunds'
import { syncPayoutFromStripe } from '@/lib/payouts'
import { processFeeReportRuns } from '@/lib/stripe-fees'
import { syncAccountStatus } from '@/lib/stripe-connect'
import {
  WEBHOOK_SECRET_ENV_VARS,
  isFeeReportType,
  malformedWebhookSecretNames,
  routeFor,
} from './routing'

/**
 * 6.9 Stripe webhook endpoint: /api/webhooks/stripe
 *
 * To endepunkter i Stripe peker hit, hvert med sin signing secret. Signaturen
 * prøves mot begge, så det spiller ingen rolle hvilket som leverte.
 *
 * «Connected accounts»-endepunktet (STRIPE_CONNECT_WEBHOOK_SECRET). Events fra
 * klubbenes kontoer, med `event.account` satt til klubbens konto-ID:
 *  - checkout.session.completed, checkout.session.async_payment_succeeded
 *      → billetter utstedes (`finalizeCheckoutSession`). Utsolgt eller ugyldig
 *        show refunderes automatisk der inne.
 *  - checkout.session.async_payment_failed → logges; ingen ordre ble laget.
 *  - charge.refunded → refusjonen speiles på ordren (`lib/refunds.ts`), også
 *    delrefusjoner og refusjoner gjort i Stripe-dashbordet.
 *  - charge.dispute.created/updated/closed/funds_withdrawn/funds_reinstated
 *      → logges for oppfølging.
 *  - payment_intent.payment_failed → en ventende ordre merkes `failed`.
 *  - payout.created/updated/paid/failed/canceled → utbetalingsstatus følger
 *    Stripe (`lib/payouts.ts`).
 *  - account.updated, balance_settings.updated → klarhet og utbetalingsplan
 *    (`lib/stripe-connect.ts`).
 *
 * «Your account»-endepunktet (STRIPE_WEBHOOK_SECRET). Plattformkontoen, uten
 * `event.account`:
 *  - reporting.report_run.succeeded (`all_fees.*`) → Stripe-gebyret bokføres
 *    (`lib/stripe-fees.ts`). Gebyret trekkes fra plattformen, ikke klubben.
 *
 * Billettsalget skjer som direct charge på klubbens konto, så konto-ID-en fra
 * eventet må følge med på alle Stripe-oppslag nedstrøms — ellers leter vi på
 * feil konto. Stripe kan levere samme event flere ganger og i vilkårlig
 * rekkefølge, så alle handlere er idempotente.
 */

// Én gang når modulen lastes, ikke per forespørsel. Bare navnet logges.
for (const name of malformedWebhookSecretNames(process.env)) {
  console.warn(
    `[Stripe Webhook] ${name} does not start with "whsec_" and can never verify a Stripe signature — ` +
      'copy the signing secret from the webhook endpoint in the Stripe dashboard.',
  )
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    console.error('[Stripe Webhook] Request without stripe-signature header')
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  const secrets = WEBHOOK_SECRET_ENV_VARS.map((name) => process.env[name])
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
    switch (routeFor(event.type)) {
      case 'checkout_completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, account)
        break
      case 'checkout_async_failed':
        handleAsyncPaymentFailed(event.data.object as Stripe.Checkout.Session, account)
        break
      case 'charge_refunded':
        await syncRefundFromCharge(event.data.object as Stripe.Charge, account)
        break
      case 'dispute':
        await handleDispute(event.data.object as Stripe.Dispute, account, event.type)
        break
      case 'payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent)
        break
      case 'payout':
        await handlePayout(event.data.object as Stripe.Payout, account, event.type)
        break
      case 'account':
        await syncAccountStatus(account ?? (event.data.object as Stripe.Account).id)
        break
      case 'balance_settings':
        // Balance Settings finnes bare på tilkoblede kontoer her. Uten konto
        // er det plattformens egne innstillinger, og dem rører vi ikke.
        if (account) await syncAccountStatus(account)
        break
      case 'report_run':
        await handleReportRun(event.data.object as Stripe.Reporting.ReportRun, account)
        break
      case 'ignored':
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

  // `finalizeCheckoutSession` returnerer utfallet i stedet for å kaste. Bare
  // `failed` kastes videre: da får Stripe 500 og prøver igjen, som er ønsket
  // for feil som kan gå over av seg selv — men ikke for utsolgt eller ugyldig
  // show, der et nytt forsøk gir samme svar.
  switch (completion.result) {
    case 'failed':
      throw new Error(
        `complete_checkout_order failed for session ${session.id}: ${completion.emailError ?? 'unknown error'}`,
      )

    case 'sold_out':
    case 'invalid_show': {
      // Betalt, men ingen billett. Refusjonen er forsøkt inne i finalize; lyktes
      // den ikke, står ordren i refusjonskøen og cron prøver igjen.
      const refunded = completion.refunded === true
      const log = refunded ? console.warn : console.error
      log(
        `[Stripe Webhook] Paid session ${session.id} on ${account ?? 'platform'} got no ticket ` +
          `(${completion.result}) — order=${completion.orderId ?? 'unknown'} refunded=${refunded}` +
          (refunded ? '' : ' — left in the refund queue'),
      )
      break
    }

    case 'missing_show':
      // Uten show-ID på sesjonen finnes det ingen ordre, og dermed heller ingen
      // rad i refusjonskøen.
      console.error(
        `[Stripe Webhook] Session ${session.id} on ${account ?? 'platform'} has no show_id — ` +
          `refunded=${completion.refunded === true}. Check the payment in Stripe.`,
      )
      break

    case 'unpaid':
      // Utsatt betalingsmåte: `async_payment_succeeded` fullfører senere.
      console.info(`[Stripe Webhook] Session ${session.id} completed but not paid yet — waiting for async payment`)
      break

    case 'created':
      if (!completion.emailSent) {
        console.error(
          `[Stripe Webhook] Ticket ${completion.ticketCode} created but email failed: ${completion.emailError ?? 'unknown error'}`,
        )
      }
      break

    case 'duplicate':
      break
  }
}

/** Utsatt betaling som feilet. Ingen ordre ble laget, så det er ingenting å rydde. */
function handleAsyncPaymentFailed(session: Stripe.Checkout.Session, account: string | null) {
  console.warn(
    `[Stripe Webhook] Async payment failed for session ${session.id} on ${account ?? 'platform'} ` +
      `(show ${session.metadata?.show_id ?? 'unknown'}) — no ticket issued`,
  )
}

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  const admin = createAdminClient()

  // Bare en ventende ordre kan feile. Checkout lar kunden prøve et nytt kort i
  // samme payment intent, og Stripe garanterer ikke rekkefølgen på events — et
  // sent `payment_failed` skal ikke gjøre en betalt ordre om til `failed`.
  const { error } = await admin
    .from('orders')
    .update({ status: 'failed' })
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .eq('status', 'pending')

  if (error) {
    throw new Error(`Could not mark orders for ${paymentIntent.id} as failed: ${error.message}`)
  }
}

/**
 * Utbetalingsstatus følger Stripe. Plattformens egne utbetalinger (uten
 * `event.account`) er Tickethalos og hører ikke hjemme i `club_payouts`.
 */
async function handlePayout(payout: Stripe.Payout, account: string | null, eventType: string) {
  if (!account) return

  await syncPayoutFromStripe(payout.id, account)

  // En automatisk utbetaling betyr at klubbens plan ikke står på `manual` —
  // billettpengene går ut før showet. Synken setter planen tilbake, eller
  // markerer klubben som ikke klar hvis Stripe ikke godtar det.
  if (eventType === 'payout.created' && payout.automatic) {
    console.error(
      `[Stripe Webhook] Automatic payout ${payout.id} (${payout.amount} ${payout.currency}) on ${account} — ` +
        'the payout schedule is not manual. Re-applying it.',
    )
    await syncAccountStatus(account)
  }
}

/**
 * Stripes gebyrrapport er klar. Rapportene bestilles på plattformkontoen, så
 * kjøringer fra en tilkoblet konto eller av en annen type ignoreres.
 * `processFeeReportRuns` plukker opp alle ferdige kjøringer, ikke bare denne,
 * og er trygg å kjøre flere ganger.
 */
async function handleReportRun(run: Stripe.Reporting.ReportRun, account: string | null) {
  if (account || !isFeeReportType(run.report_type)) return

  const result = await processFeeReportRuns()
  console.info(
    `[Stripe Webhook] Fee report ${run.id} (${run.report_type}) processed — runs=${result.processed} ` +
      `entries=${result.entries} orders=${result.ordersReconciled}`,
  )
}

/**
 * Disputen trekkes fra klubbens saldo (direct charge), men Tickethalo hefter
 * hvis saldoen går negativ (`losses_collector = application`). Den logges
 * slik at den kan følges opp — hele livsløpet, ikke bare opprettelsen.
 */
async function handleDispute(dispute: Stripe.Dispute, account: string | null, eventType: string) {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id
  const admin = createAdminClient()

  const { data: order, error } = await admin
    .from('orders')
    .select('id, club_id')
    .eq('stripe_charge_id', chargeId)
    .maybeSingle()

  if (error) {
    // Bare logging står på spill, så eventet kvitteres likevel.
    console.error(`[Stripe Webhook] Could not look up the order for dispute ${dispute.id}: ${error.message}`)
  }

  const log = eventType === 'charge.dispute.created' || eventType === 'charge.dispute.funds_withdrawn'
    ? console.error
    : console.warn

  log(
    `[Stripe Webhook] ${eventType}: dispute ${dispute.id} (${dispute.reason}, ${dispute.amount} ${dispute.currency}, ` +
      `status=${dispute.status}) on account ${account ?? 'platform'} — ` +
      `order=${order?.id ?? 'unknown'} club=${order?.club_id ?? 'unknown'}`,
  )
}
