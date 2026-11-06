import { getScannerShows, scannerRoute } from '@/lib/scanner-api'

export async function GET() {
  return scannerRoute(async () => ({ shows: await getScannerShows() }))
}
