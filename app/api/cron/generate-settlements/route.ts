import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { generateSettlements, parseMonthPeriod, previousMonthPeriod } from '@/lib/settlements'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Månedlig avregningsnota per klubb. Kjøres tidlig i måneden og gjelder
 * måneden før. Se `lib/settlements.ts`.
 *
 * Kjøres fra GitHub Actions (.github/workflows/run-automation.yml), ikke fra
 * Vercel: Hobby-planen tillater to cron-jobber. Feiler kjøringen den 1., kan
 * måneden kjøres for hånd fra Actions («Run workflow» med period=YYYY-MM),
 * som sender `?period=` hit med samme hemmelighet. Kjøringen er idempotent.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requested = new URL(request.url).searchParams.get('period')
  const period = requested ? parseMonthPeriod(requested) : previousMonthPeriod()
  if (!period) {
    return NextResponse.json({ error: 'period must be YYYY-MM' }, { status: 400 })
  }

  const result = await generateSettlements(period)
  console.log(`[cron/generate-settlements] ${result.period}: ${result.settlements} settlements`)

  return NextResponse.json(result)
}
