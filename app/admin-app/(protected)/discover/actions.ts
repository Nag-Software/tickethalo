'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { canonicalRoleValues } from '@/lib/artist-roles'
import { runAutomaticBookingForClub } from '@/lib/actions/booking'
import { runAfterResponse } from '@/lib/background'
import { addArtistToClub, ROSTER_PATHS } from '@/lib/club-roster'

/**
 * Katalogen skriver bare én ting: koblingen mellom klubben og komikeren.
 *
 * Klubben leses av innloggingen, aldri av skjemaet — en klubb-ID i en POST
 * ville latt hvem som helst legge komikere inn i en annen klubbs liste.
 */

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
    await addArtistToClub(createAdminClient(), { clubId, artistId, category })
  } catch (error) {
    console.error('[Discover] Could not connect artist:', error)
    return { error: 'Could not add the comedian right now. Try again in a moment.' }
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

    for (const path of ROSTER_PATHS) revalidatePath(path)

    // Komikeren er ikke lenger klubbens, så ubesvarte tilbud skal trekkes og
    // plassene tilbys videre. Motoren gjør begge deler — se
    // `pendingOffersToWithdraw`.
    runAfterResponse(`club-roster-removed-${artistId}`, async () => {
      await runAutomaticBookingForClub(clubId)
      for (const path of ROSTER_PATHS) revalidatePath(path)
    })
  } catch (error) {
    console.error('[Discover]', error)
    return { error: 'Could not remove the comedian right now.' }
  }
}
