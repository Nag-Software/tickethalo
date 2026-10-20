import { getArtistForAuthUser, getAuthUser } from '@/lib/session'
import type { OpenCallViewer } from '@/lib/open-spots'
import type { OpenCallsViewer } from '@/components/public/club-open-calls'

/**
 * Hvem som ser på klubbsidens «Apply for a spot», uten å sende noen videre.
 *
 * `getCurrentArtist` redirecter når det ikke finnes en komiker, og det
 * duger ikke på en offentlig side: utlogget publikum skal bare se kortet.
 * Ligger for seg, så lib/open-spots.ts kan testes uten sesjon og cookies.
 */
export async function getOpenCallViewer(): Promise<{ kind: OpenCallsViewer; viewer: OpenCallViewer }> {
  const user = await getAuthUser()
  if (!user) return { kind: 'guest', viewer: null }

  const artist = await getArtistForAuthUser(user.id)
  if (!artist) return { kind: 'other', viewer: null }

  return { kind: 'artist', viewer: { artistId: artist.id, status: artist.status } }
}
