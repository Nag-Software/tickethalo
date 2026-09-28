import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/cron-auth'
import { settleFinishedShows } from '@/lib/artist-fees'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Gjør opp honorarene dagen etter at showet er spilt: regner ut hva hver
 * komiker skal ha av billettinntekten, og sender eposten som sier beløpet og
 * kontoen det går til. Se `lib/artist-fees.ts` for fordelingen.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Vercel dreper funksjonen ved `maxDuration`, og da kommer verken loggen
  // eller svaret. Kjøringen slutter å starte nye show ti sekunder før.
  const result = await settleFinishedShows(new Date(), { deadline: Date.now() + 50_000 })
  console.log(
    `[cron/artist-fees] ${result.shows} shows, ${result.emailed} emails, ${result.paid} in fees, ${result.deferred} deferred`,
  )

  return NextResponse.json(result)
}
