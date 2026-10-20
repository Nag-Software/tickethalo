import { getArtistForAuthUser, getAuthUser } from '@/lib/session'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'
import type { OpenCallViewer } from '@/lib/open-spots'
import type { OpenCallsViewer } from '@/components/public/club-open-calls'

/**
 * Hvem som ser på klubbsidens «Apply for a spot», uten å sende noen videre.
 *
 * `getCurrentArtist` redirecter når det ikke finnes en komiker, og det
 * duger ikke på en offentlig side: utlogget publikum skal bare se kortet.
 * Ligger for seg, så lib/open-spots.ts kan testes uten sesjon og cookies.
 *
 * Komiker er den portalen selv regner som komiker. En klubbadmin eller
 * superadmin kan ha en komikerrad også, men slipper ikke inn i
 * komikerportalen — da skal klubbsiden heller ikke by på knapper som ender
 * der.
 */
export async function getOpenCallViewer(): Promise<{ kind: OpenCallsViewer; viewer: OpenCallViewer }> {
  const user = await getAuthUser()
  if (!user) return { kind: 'guest', viewer: null }

  const destination = await getPortalDestinationForAuthUser(user.id)
  if (destination !== '/artist-app') return { kind: 'other', viewer: null }

  const artist = await getArtistForAuthUser(user.id)
  if (!artist) return { kind: 'other', viewer: null }

  return { kind: 'artist', viewer: { artistId: artist.id, status: artist.status } }
}
