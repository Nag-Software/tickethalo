import { scannerRoute, ScannerApiError } from '@/lib/scanner-api'
import { checkInByCode } from '@/app/admin-app/(protected)/scanner/actions'

/**
 * Sjekker inn én billett. Svaret er det samme `CheckInResult` som
 * webscanneren får, så døra ser de samme utfallene i begge.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/scanner/shows/[showId]/check-in'>) {
  const { showId } = await ctx.params
  return scannerRoute(async () => {
    const body = (await request.json().catch(() => null)) as { code?: unknown } | null
    if (typeof body?.code !== 'string') throw new ScannerApiError(400, 'Missing code.')
    return checkInByCode(showId, body.code)
  })
}
