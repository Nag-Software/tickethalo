import { NextResponse } from 'next/server'
import { settleFinishedShows } from '@/lib/artist-fees'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Gjør opp honorarene dagen etter at showet er spilt: regner ut hva hver
 * komiker skal ha av billettinntekten, og sender eposten som sier beløpet og
 * kontoen det går til. Se `lib/artist-fees.ts` for fordelingen.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await settleFinishedShows()
  console.log(`[cron/artist-fees] ${result.shows} shows, ${result.emailed} emails, ${result.paid} in fees`)

  return NextResponse.json(result)
}
