'use server'

import { revalidatePath } from 'next/cache'
import { getCurrentArtist } from '@/lib/artist-portal'
import { markThreadRead } from '@/lib/lineup-messages'

/**
 * Merker meldingene om ett show som lest. Kalles fra nettleseren når tråden
 * vises — ikke når siden rendres, for en `<Link>` som forhåndslaster siden
 * ville ellers merket den som lest før komikeren så den.
 */
export async function markLineupThreadReadAction(showId: string) {
  const { artist, db } = await getCurrentArtist()
  const marked = await markThreadRead(db, artist.id, showId)
  if (marked > 0) revalidatePath('/artist-app', 'layout')
  return { marked }
}
