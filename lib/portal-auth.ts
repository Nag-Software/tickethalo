import { getArtistForAuthUser, getSessionProfile } from '@/lib/session'
import type { PortalSide } from '@/lib/portal-side'
import type { Role } from '@/types/database'

const CLUB_ROLES: readonly Role[] = ['owner', 'admin', 'staff']

export function isClubRole(role: Role | null | undefined) {
  return Boolean(role && CLUB_ROLES.includes(role))
}

export type PortalAccess = {
  superadmin: boolean
  club: boolean
  comedian: boolean
}

/**
 * Hvilke portaler innloggingen slipper inn i.
 *
 * En klubbeier som også står på scenen eier begge sidene med samme
 * innlogging: klubben gjennom profilrollen, komikeren gjennom
 * `artists.auth_user_id`. Superadmin holdes utenfor komikerportalen som før,
 * også om innloggingen har en komikerrad.
 */
export async function getPortalAccessForAuthUser(authUserId: string): Promise<PortalAccess> {
  const [profile, artist] = await Promise.all([
    getSessionProfile(authUserId),
    getArtistForAuthUser(authUserId),
  ])
  const superadmin = profile?.role === 'superadmin'

  return {
    superadmin,
    club: isClubRole(profile?.role),
    comedian: Boolean(artist) && !superadmin,
  }
}

/**
 * Hvilken portal brukeren hører hjemme i.
 *
 * Profilen hentes gjennom `getSessionProfile`, som er cachet per request — så
 * når en layout allerede har slått den opp, koster dette kallet ingenting.
 * Komikeroppslaget skjer bare når rollen ikke allerede peker til en portal,
 * eller når en klubbinnlogging sist var i komikerportalen (`prefer`) — da
 * lander hen der igjen, men bare om komikerprofilen fortsatt er der.
 */
export async function getPortalDestinationForAuthUser(
  authUserId: string,
  prefer?: PortalSide
): Promise<string | null> {
  const profile = await getSessionProfile(authUserId)

  if (profile?.role === 'superadmin') return '/superadmin'
  if (isClubRole(profile?.role)) {
    if (prefer === 'artist' && (await getArtistForAuthUser(authUserId))) return '/artist-app'
    return '/admin-app'
  }

  const artist = await getArtistForAuthUser(authUserId)

  if (artist) return '/artist-app'
  if (profile?.role === 'artist') return '/artist-app/signup?error=missing'

  return null
}
