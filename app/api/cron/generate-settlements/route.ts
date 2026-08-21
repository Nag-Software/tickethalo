import { NextResponse } from 'next/server'
import { generateSettlements } from '@/lib/settlements'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Månedlig avregningsnota per klubb. Kjøres tidlig i måneden og gjelder
 * måneden før. Se `lib/settlements.ts`.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await generateSettlements()
  console.log(`[cron/generate-settlements] ${result.period}: ${result.settlements} settlements`)

  return NextResponse.json(result)
}
