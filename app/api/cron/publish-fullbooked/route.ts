import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { automateFullbookedShow, expireStaleOffers } from '@/lib/actions/booking'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rydder tilbud som har gått ut, slik at lineupen ikke viser «Offer sent»
  // for e-poster ingen kommer til å svare på.
  const expired = await expireStaleOffers()

  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  // Find shows that should be published: fullbooked or booking with all slots (the
  // automateFullbookedShow call validates slots are actually filled before publishing).
  const { data: shows, error } = await admin
    .from('shows')
    .select('id')
    .in('status', ['booking', 'fullbooked'])
    .gte('date', today)
    .is('published_at', null)

  if (error) {
    console.error('[cron/publish-fullbooked] DB error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results = await Promise.allSettled(
    (shows ?? []).map((show) => automateFullbookedShow(show.id))
  )

  const published = results.filter(
    (r) => r.status === 'fulfilled' && r.value.fullbooked
  ).length

  console.log(
    `[cron/publish-fullbooked] Processed ${shows?.length ?? 0} shows, published ${published}, expired ${expired} offers`,
  )

  return NextResponse.json({ processed: shows?.length ?? 0, published, expired })
}
