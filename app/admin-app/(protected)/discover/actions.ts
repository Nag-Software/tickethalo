'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { canonicalRoleValues } from '@/lib/artist-roles'

/**
 * Katalogen skriver bare én ting: koblingen mellom klubben og komikeren.
 *
 * Klubben leses av innloggingen, aldri av skjemaet — en klubb-ID i en POST
 * ville latt hvem som helst legge komikere inn i en annen klubbs liste.
 */

/** Koblingen vises to steder — begge må tegnes på nytt. */
const PATHS = ['/admin-app/discover', '/admin-app/artists']

export async function connectArtistAction(formData: FormData): Promise<{ error?: string } | void> {
  const artistId = String(formData.get('artist_id') ?? '')
  if (!artistId) return { error: 'The comedian is missing.' }

  // Rollene er klubbens egne, ikke komikerens beskrivelse av seg selv, så de
  // settes her og ikke arves. Uten minst én rolle matcher komikeren ingen
  // show-krav og ville blitt stående usynlig i booking.
  const category = canonicalRoleValues(formData.getAll('category').map((value) => String(value)))
  if (category.length === 0) return { error: 'Pick at least one role for the comedian.' }

  try {
    const clubId = await getDefaultClubIdForAdmin()
    const db = createAdminClient()

    // `upsert` framfor `insert`: to raske klikk skal ikke gi en unik-feil i
    // ansiktet på en handling som allerede har gjort det den skulle.
    const { error } = await db
      .from('club_artists')
      .upsert({ club_id: clubId, artist_id: artistId, category }, { onConflict: 'club_id,artist_id' })

    if (error) {
      console.error(`[Discover] Could not connect artist: ${error.message}`)
      return { error: 'Could not add the comedian right now. Try again in a moment.' }
    }

    for (const path of PATHS) revalidatePath(path)
  } catch (error) {
    console.error('[Discover]', error)
    return { error: 'Could not add the comedian right now.' }
  }
}

export async function disconnectArtistAction(formData: FormData): Promise<{ error?: string } | void> {
  const artistId = String(formData.get('artist_id') ?? '')
  if (!artistId) return { error: 'The comedian is missing.' }

  try {
    const clubId = await getDefaultClubIdForAdmin()
    const db = createAdminClient()

    const { error } = await db
      .from('club_artists')
      .delete()
      .eq('club_id', clubId)
      .eq('artist_id', artistId)

    if (error) {
      console.error(`[Discover] Could not disconnect artist: ${error.message}`)
      return { error: 'Could not remove the comedian right now. Try again in a moment.' }
    }

    for (const path of PATHS) revalidatePath(path)
  } catch (error) {
    console.error('[Discover]', error)
    return { error: 'Could not remove the comedian right now.' }
  }
}
