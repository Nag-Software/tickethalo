import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAccountBalance } from '@/lib/stripe-connect'

/**
 * Utbetaling til klubbens bankkonto.
 *
 * Klubbenes Connect-kontoer står på manuell utbetaling. Pengene blir stående
 * på klubbens konto til showet er avholdt, slik at en avlysning ikke
 * etterlater en tom konto med refusjonskrav — plattformen hefter overfor
 * Stripe for negativ saldo på Express-kontoer.
 *
 * Beløpet som frigjøres regnes fra hovedboken (`orders.club_net_amount`),
 * ikke fra Stripe-saldoen alene: saldoen blander show som er avholdt med
 * show som ennå ikke er spilt.
 */

export type PayoutClub = {
  id: string
  name: string
  currency: string
  stripe_account_id: string
  payout_hold_days: number
}

export type PayoutOutcome = {
  clubId: string
  clubName: string
  released: number
  skipped?: string
}

/** Ordrer på show som er avholdt for lenge nok til at pengene kan frigis. */
export async function releasableAmount(club: PayoutClub): Promise<number> {
  const db = createAdminClient()

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - club.payout_hold_days)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  const { data: shows } = await db
    .from('shows')
    .select('id')
    .eq('club_id', club.id)
    .lte('date', cutoffDate)

  const showIds = (shows ?? []).map((show) => show.id)
  if (showIds.length === 0) return 0

  const { data: orders } = await db
    .from('orders')
    .select('club_net_amount')
    .eq('status', 'paid')
    .in('show_id', showIds)

  const earned = (orders ?? []).reduce((total, order) => total + (order.club_net_amount ?? 0), 0)

  const { data: payouts } = await db
    .from('club_payouts')
    .select('amount')
    .eq('club_id', club.id)
    .in('status', ['pending', 'paid'])

  const alreadyPaid = (payouts ?? []).reduce((total, payout) => total + payout.amount, 0)

  return Math.max(0, earned - alreadyPaid)
}

async function releaseForClub(club: PayoutClub): Promise<PayoutOutcome> {
  const db = createAdminClient()
  const base = { clubId: club.id, clubName: club.name }

  const releasable = await releasableAmount(club)
  if (releasable <= 0) return { ...base, released: 0, skipped: 'nothing due' }

  const balance = await getAccountBalance(club.stripe_account_id)
  const amount = Math.min(releasable, balance.available)

  if (amount <= 0) {
    // Pengene er opptjent, men Stripe har dem ennå ikke som tilgjengelige.
    // Neste kjøring tar dem.
    return { ...base, released: 0, skipped: `balance not available (${balance.available})` }
  }

  const { data: payoutRow, error } = await db
    .from('club_payouts')
    .insert({
      club_id: club.id,
      amount,
      currency: club.currency.toUpperCase(),
      period_end: new Date().toISOString().slice(0, 10),
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !payoutRow) {
    throw new Error(`Could not record payout for club ${club.id}: ${error?.message ?? 'no row'}`)
  }

  try {
    const payout = await stripe.payouts.create(
      {
        amount,
        currency: club.currency.toLowerCase(),
        metadata: { club_id: club.id, payout_row: payoutRow.id },
      },
      { stripeAccount: club.stripe_account_id, idempotencyKey: `payout-${payoutRow.id}` },
    )

    await db
      .from('club_payouts')
      .update({ stripe_payout_id: payout.id, status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', payoutRow.id)

    return { ...base, released: amount }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Raden må merkes feilet, ellers teller den som utbetalt neste gang og
    // klubben får aldri pengene.
    await db
      .from('club_payouts')
      .update({ status: 'failed', failure_reason: message })
      .eq('id', payoutRow.id)

    throw new Error(`Payout for club ${club.id} failed: ${message}`)
  }
}

export async function releaseDuePayouts() {
  const db = createAdminClient()

  const { data } = await db
    .from('clubs')
    .select('id, name, currency, stripe_account_id, payout_hold_days')
    .eq('payouts_enabled', true)
    .not('stripe_account_id', 'is', null)

  const clubs = (data ?? []) as PayoutClub[]
  const outcomes: PayoutOutcome[] = []

  for (const club of clubs) {
    try {
      outcomes.push(await releaseForClub(club))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[Payouts] ${message}`)
      outcomes.push({ clubId: club.id, clubName: club.name, released: 0, skipped: message })
    }
  }

  const released = outcomes.reduce((total, outcome) => total + outcome.released, 0)
  return { clubs: clubs.length, released, outcomes }
}
