import { scannerRoute, ScannerApiError } from '@/lib/scanner-api'
import { uncheckIn } from '@/app/admin-app/(protected)/scanner/actions'

/** Angrer en innsjekking — gjesten ble sluppet inn ved en feil. */
export async function POST(request: Request, ctx: RouteContext<'/api/scanner/shows/[showId]/undo'>) {
  const { showId } = await ctx.params
  return scannerRoute(async () => {
    const body = (await request.json().catch(() => null)) as { ticketId?: unknown } | null
    if (typeof body?.ticketId !== 'string') throw new ScannerApiError(400, 'Missing ticketId.')
    return uncheckIn(body.ticketId, showId)
  })
}
