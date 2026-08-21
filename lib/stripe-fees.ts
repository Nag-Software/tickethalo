import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Gebyr-oppgjør.
 *
 * Kunden bærer ikke betalingsgebyret — det er integrert i Tickethalos
 * formidlingsprovisjon. Men på en direct charge trekker Stripe gebyret fra
 * klubbens konto, ikke fra vår. Uten dette oppgjøret ville klubben fått
 * 90 % minus gebyr.
 *
 * Løsningen er å delrefundere provisjonen med nøyaktig gebyrbeløpet, slik at
 * klubben lander på sin fulle andel og Tickethalo sitter igjen med
 * provisjonen minus gebyret. Beløpet kan ikke estimeres på forhånd —
 * kort, Vipps og Klarna har ulike satser — så det gjøres i etterkant, når
 * Stripe har bokført transaksjonen.
 */

type SettlementOutcome =
  | { result: 'done'; stripeFee: number; refunded: number }
  | { result: 'capped'; stripeFee: number; refunded: number }
  | { result: 'not_needed' }
  | { result: 'pending'; reason: string }
  | { result: 'skipped'; reason: string }

type OrderLedgerRow = {
  id: string
  club_id: string | null
  gross_amount: number | null
  platform_fee_amount: number | null
  stripe_application_fee_id: string | null
  stripe_connected_account_id: string | null
  fee_trueup_status: string
}

const LEDGER_FIELDS =
  'id, club_id, gross_amount, platform_fee_amount, stripe_application_fee_id, ' +
  'stripe_connected_account_id, fee_trueup_status'

/**
 * Stripes eget behandlingsgebyr på transaksjonen.
 *
 * `balance_transaction.fee` kan ikke brukes: på en direct charge med
 * application fee inneholder den både Stripes gebyr og vår provisjon. Bare
 * `fee_details` skiller dem.
 */
function stripeFeeFrom(balanceTransaction: Stripe.BalanceTransaction): number {
  return balanceTransaction.fee_details
    .filter((detail) => detail.type === 'stripe_fee')
    .reduce((total, detail) => total + detail.amount, 0)
}

/**
 * Kjører oppgjøret for én betaling. Idempotent: en ordre som allerede er
 * gjort opp røres ikke, og selve refusjonen har en idempotency key.
 */
export async function settleStripeFee(chargeId: string, accountId: string): Promise<SettlementOutcome> {
  const db = createAdminClient()

  const { data } = await db
    .from('orders')
    .select(LEDGER_FIELDS)
    .eq('stripe_charge_id', chargeId)
    .maybeSingle()

  const order = data as OrderLedgerRow | null
  if (!order) return { result: 'skipped', reason: `no order for charge ${chargeId}` }
  if (order.fee_trueup_status !== 'pending') {
    return { result: 'skipped', reason: `status=${order.fee_trueup_status}` }
  }

  const commission = order.platform_fee_amount ?? 0
  if (commission <= 0) {
    await db.from('orders').update({ fee_trueup_status: 'not_needed' }).eq('id', order.id)
    return { result: 'not_needed' }
  }

  // Avtalen kan slås av per klubb. Da beholder Tickethalo hele provisjonen og
  // klubben bærer gebyret selv.
  if (order.club_id) {
    const { data: club } = await db
      .from('clubs')
      .select('absorb_stripe_fee')
      .eq('id', order.club_id)
      .single()

    if (club && club.absorb_stripe_fee === false) {
      await db.from('orders').update({ fee_trueup_status: 'not_needed' }).eq('id', order.id)
      return { result: 'not_needed' }
    }
  }

  const charge = await stripe.charges.retrieve(
    chargeId,
    { expand: ['balance_transaction'] },
    { stripeAccount: accountId },
  )

  const balanceTransaction = charge.balance_transaction
  if (!balanceTransaction || typeof balanceTransaction === 'string') {
    // Stripe har ikke bokført transaksjonen ennå. Raden blir stående
    // `pending` og plukkes opp av cron-jobben.
    return { result: 'pending', reason: 'balance_transaction not available yet' }
  }

  const stripeFee = stripeFeeFrom(balanceTransaction)
  if (stripeFee <= 0) {
    await db
      .from('orders')
      .update({ stripe_fee_amount: 0, fee_trueup_amount: 0, fee_trueup_status: 'done' })
      .eq('id', order.id)
    return { result: 'done', stripeFee: 0, refunded: 0 }
  }

  const applicationFeeId =
    order.stripe_application_fee_id ??
    (typeof charge.application_fee === 'string' ? charge.application_fee : charge.application_fee?.id ?? null)

  if (!applicationFeeId) {
    await db
      .from('orders')
      .update({ stripe_fee_amount: stripeFee, fee_trueup_status: 'failed' })
      .eq('id', order.id)
    return { result: 'skipped', reason: `charge ${chargeId} has no application fee` }
  }

  // Provisjonen er taket: vi kan ikke refundere mer enn vi tok. Slår taket
  // inn er billetten priset for lavt til å bære betalingsgebyret — det er en
  // prisbeslutning, ikke en feil, så det logges tydelig i stedet for å kastes.
  const refundAmount = Math.min(stripeFee, commission)
  const capped = refundAmount < stripeFee

  await stripe.applicationFees.createRefund(
    applicationFeeId,
    { amount: refundAmount },
    { idempotencyKey: `fee-trueup-${chargeId}` },
  )

  await db
    .from('orders')
    .update({
      stripe_fee_amount: stripeFee,
      fee_trueup_amount: refundAmount,
      fee_trueup_status: capped ? 'capped' : 'done',
      stripe_application_fee_id: applicationFeeId,
      club_net_amount: (order.gross_amount ?? 0) - commission,
    })
    .eq('id', order.id)

  if (capped) {
    console.warn(
      `[Fees] Stripe fee ${stripeFee} exceeds commission ${commission} on order ${order.id} — ` +
        'the club carries the difference. Raise the ticket price or the commission.',
    )
  }

  return { result: capped ? 'capped' : 'done', stripeFee, refunded: refundAmount }
}

/**
 * Rydder opp i ordrer der `balance_transaction` ikke var klar da betalingen
 * kom inn. Kjøres av `app/api/cron/settle-fees`.
 */
export async function settlePendingFees(limit = 100) {
  const db = createAdminClient()

  const { data } = await db
    .from('orders')
    .select('stripe_charge_id, stripe_connected_account_id')
    .eq('fee_trueup_status', 'pending')
    .not('stripe_charge_id', 'is', null)
    .not('stripe_connected_account_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit)

  const rows = (data ?? []) as Array<{ stripe_charge_id: string; stripe_connected_account_id: string }>
  const outcomes = { done: 0, capped: 0, pending: 0, failed: 0 }

  for (const row of rows) {
    try {
      const outcome = await settleStripeFee(row.stripe_charge_id, row.stripe_connected_account_id)
      if (outcome.result === 'done') outcomes.done += 1
      else if (outcome.result === 'capped') outcomes.capped += 1
      else if (outcome.result === 'pending') outcomes.pending += 1
    } catch (error) {
      outcomes.failed += 1
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[Fees] Settlement failed for charge ${row.stripe_charge_id}: ${message}`)
    }
  }

  return { processed: rows.length, ...outcomes }
}
