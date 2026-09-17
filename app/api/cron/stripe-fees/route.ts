import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { reconcileStripeFees } from '@/lib/stripe-fees'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Bokfører Stripe-gebyrene der Stripe faktisk trekker dem: på plattformkontoen.
 * Speiler plattformens balansetransaksjoner, henter Stripes gebyrrapport og
 * fordeler gebyret per ordre. Klubbens andel røres ikke. Se `lib/stripe-fees.ts`.
 *
 * Svarer 500 når noe stopper bokføringen (feilede rapportkjøringer, en
 * intervallkjede som står fast, ordrer som ikke lar seg avstemme). Ellers ville
 * en stille stans bare synes som `reportsProcessed: 0` i et 200-svar, og
 * Vercels cron-overvåking ville aldri slått ut.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await reconcileStripeFees()
  const line =
    `[cron/stripe-fees] ${result.balanceTransactions} balance transactions ` +
    `(${result.balanceSyncComplete ? 'complete' : `through ${result.balanceSyncedThrough ?? 'nothing'}`}), ` +
    `${result.reportsProcessed} reports processed, ${result.reportsFailed} failed, ` +
    `${result.ordersReconciled} orders reconciled, ${result.ordersHeld} held, ` +
    `report requested: ${result.reportRequested}${result.note ? ` — ${result.note}` : ''}`

  if (result.failed) console.error(line)
  else console.log(line)

  return NextResponse.json(result, { status: result.failed ? 500 : 200 })
}
