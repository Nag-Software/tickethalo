import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { runAutomaticBookingForClub } from '@/lib/actions/booking'
import { runAfterResponse } from '@/lib/background'
import { recalculateClubArtistScore } from '@/lib/artist-reviews'
import type { ArtistType } from '@/types/database'

type Db = ReturnType<typeof createAdminClient>

/** Koblingen vises to steder — begge må tegnes på nytt. */
export const ROSTER_PATHS = ['/admin-app/discover', '/admin-app/artists']

/**
 * Legger komikeren på klubbens liste (`club_artists`).
 *
 * Én vei inn, enten klubben kobler komikeren i «Discover comedians» eller
 * komikeren kommer via klubbens invitasjonslenke. Begge skal gi samme liste,
 * samme score og samme runde i bookingmotoren.
 *
 * `keepExisting`: står komikeren alt på lista, rører vi ikke raden. Lenken
 * skal ikke kunne overskrive rollene klubben selv har satt, eller merke en
 * komiker klubben hentet fra katalogen som «kom via lenken». Fra katalogen
 * er det klubben som velger roller, så der oppdateres de.
 *
 * Returnerer om raden ble lagt til nå.
 */
export async function addArtistToClub(
  db: Db,
  input: {
    clubId: string
    artistId: string
    category: ArtistType[]
    joinedViaInvite?: boolean
    keepExisting?: boolean
  },
): Promise<{ added: boolean }> {
  const { clubId, artistId, category } = input

  // `upsert` framfor `insert`: to raske klikk skal ikke gi en unik-feil i
  // ansiktet på en handling som allerede har gjort det den skulle.
  const { data, error } = await db
    .from('club_artists')
    .upsert(
      { club_id: clubId, artist_id: artistId, category, joined_via_invite: input.joinedViaInvite ?? false },
      { onConflict: 'club_id,artist_id', ignoreDuplicates: input.keepExisting ?? false },
    )
    .select('id')

  if (error) throw new Error(error.message)
  // Med `ignoreDuplicates` kommer en rad som fantes fra før ikke tilbake.
  const added = (data ?? []).length > 0
  if (!added) return { added }

  // Har komikeren vært på lista før, finnes klubbens vurderinger ennå. Den
  // nye koblingen står på 5,0 til scoren er regnet ut fra dem. Komikeren er
  // lagt til uansett, så en feil her skal ikke melde at det ikke gikk.
  await recalculateClubArtistScore(db, clubId, artistId).catch((scoreError) => {
    console.error('[Roster] Could not recalculate club score:', scoreError)
  })

  for (const path of ROSTER_PATHS) revalidatePath(path)

  // En ny komiker på listen kan være den som mangler på et show som står
  // fast akkurat nå. Bare klubbens egne show — komikeren er ikke kandidat
  // noe annet sted.
  runAfterResponse(`club-roster-added-${artistId}`, async () => {
    await runAutomaticBookingForClub(clubId)
    for (const path of ROSTER_PATHS) revalidatePath(path)
  })

  return { added }
}
