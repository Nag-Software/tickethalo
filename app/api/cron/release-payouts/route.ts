import { NextResponse } from 'next/server'
import { releaseDuePayouts } from '@/lib/payouts'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Frigir billettinntekten til klubbens bankkonto etter at showet er avholdt.
 * Se `lib/payouts.ts` for hvorfor pengene holdes til da.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await releaseDuePayouts()
  console.log(`[cron/release-payouts] ${result.clubs} clubs, released ${result.released}`)

  return NextResponse.json(result)
}
