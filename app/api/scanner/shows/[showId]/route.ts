import { assertShowAccess } from '@/lib/club-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ScannerApiError, scannerRoute, toScannerShow } from '@/lib/scanner-api'
import { getTicketsForShow } from '@/app/admin-app/(protected)/scanner/actions'

/** Showet og hele billettlista, til gjestelista og tellingen i appen. */
export async function GET(_request: Request, ctx: RouteContext<'/api/scanner/shows/[showId]'>) {
  const { showId } = await ctx.params
  return scannerRoute(async () => {
    await assertShowAccess(showId)
    const { data: show } = await createAdminClient()
      .from('shows')
      .select('id, title, date, start_time, venue_name, venue_address, status')
      .eq('id', showId)
      .maybeSingle()
    if (!show) throw new ScannerApiError(404, 'Show not found.')

    return { show: toScannerShow(show), tickets: await getTicketsForShow(showId) }
  })
}
