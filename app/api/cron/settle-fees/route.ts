import { NextResponse } from 'next/server'
import { settlePendingFees } from '@/lib/stripe-fees'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Rydder opp i gebyr-oppgjør som ikke kunne kjøres da betalingen kom inn —
 * typisk fordi Stripe ikke hadde bokført transaksjonen ennå. Uten denne
 * blir klubben stående med gebyret Tickethalo skulle dekket.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await settlePendingFees()
  console.log(
    `[cron/settle-fees] Processed ${result.processed} — done ${result.done}, capped ${result.capped}, ` +
      `still pending ${result.pending}, failed ${result.failed}`,
  )

  return NextResponse.json(result)
}
