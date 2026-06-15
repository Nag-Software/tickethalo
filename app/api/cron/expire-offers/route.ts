import { NextResponse } from 'next/server'
import { expireStaleBookingOffers } from '@/lib/actions/booking'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await expireStaleBookingOffers()
    console.log(`[cron/expire-offers] Expired ${result.expired} offers across ${result.showsProcessed} shows`)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[cron/expire-offers] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
