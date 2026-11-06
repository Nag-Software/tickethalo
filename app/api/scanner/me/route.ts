import { getClubAccess } from '@/lib/club-auth'
import { requireScannerUser, scannerRoute } from '@/lib/scanner-api'

/** Hvem som er logget inn, og hvilke klubber de kan skanne for. */
export async function GET() {
  return scannerRoute(async () => {
    const profile = await requireScannerUser()
    const access = await getClubAccess()
    return {
      name: profile.full_name,
      email: profile.email,
      role: profile.role,
      clubs: access.clubs.map(({ id, name, city }) => ({ id, name, city })),
      selectedClubId: access.selectedClubId,
    }
  })
}
