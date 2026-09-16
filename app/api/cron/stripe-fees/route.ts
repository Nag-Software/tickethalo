import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { reconcileStripeFees } from '@/lib/stripe-fees'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Bokfører Stripe-gebyrene der Stripe faktisk trekker dem: på plattformkontoen.
 * Speiler plattformens balansetransaksjoner, henter Stripes gebyrrapport og
 * fordeler gebyret per ordre. Klubbens andel røres ikke. Se `lib/stripe-fees.ts`.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await reconcileStripeFees()
  console.log(
    `[cron/stripe-fees] ${result.balanceTransactions} balance transactions, ` +
      `${result.reportsProcessed} reports processed, ${result.ordersReconciled} orders reconciled, ` +
      `report requested: ${result.reportRequested}${result.note ? ` — ${result.note}` : ''}`,
  )

  return NextResponse.json(result)
}
