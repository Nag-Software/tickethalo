import { getArtistForAuthUser, getSessionProfile } from '@/lib/session'

/**
 * Hvilken portal brukeren hører hjemme i.
 *
 * Profilen hentes gjennom `getSessionProfile`, som er cachet per request — så
 * når en layout allerede har slått den opp, koster dette kallet ingenting.
 * Komikeroppslaget skjer bare når rollen ikke allerede peker til en portal.
 */
export async function getPortalDestinationForAuthUser(authUserId: string): Promise<string | null> {
  const profile = await getSessionProfile(authUserId)

  if (profile?.role === 'superadmin') return '/superadmin'
  if (profile?.role === 'owner' || profile?.role === 'admin' || profile?.role === 'staff') return '/admin-app'

  const artist = await getArtistForAuthUser(authUserId)

  if (artist) return '/artist-app'
  if (profile?.role === 'artist') return '/artist-app/signup?error=missing'

  return null
}
