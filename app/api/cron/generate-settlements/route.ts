import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { generateSettlements, parseMonthPeriod, previousMonthPeriod } from '@/lib/settlements'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Månedlig avregningsnota per klubb. Kjøres tidlig i måneden og gjelder
 * måneden før. Se `lib/settlements.ts`.
 *
 * Vercel prøver ikke en cron på nytt. Feiler kjøringen den 1., kan måneden
 * kjøres for hånd med `?period=YYYY-MM` (og samme hemmelighet i
 * Authorization-headeren). Kjøringen er idempotent.
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
