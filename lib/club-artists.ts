import { createAdminClient } from '@/lib/supabase/admin'

type Db = ReturnType<typeof createAdminClient>

/**
 * Hvem klubben har lov til å booke.
 *
 * `club_artists` (migrasjon 035) er klubbens egen liste over komikere den
 * jobber med. Tabellkommentaren sier at koblingen «sier ingenting om
 * booking» — det stemte ikke lenger: både den manuelle lista og
 * bookingmotoren plukket fra *alle* godkjente komikere på Tickethalo, så en
 * klubb kunne sende tilbud til folk den aldri har knyttet til seg.
 *
 * Grensen håndheves derfor her, ett sted, og brukes både til å bygge listene
 * bookeren ser og til å avvise kall som prøver seg utenom dem.
 *
 * Alt feiler lukket: mangler showet en klubb, er svaret ingen komikere — ikke
 * alle.
 */

/** Komikerne klubben har knyttet til seg. Tom liste = ingen kan bookes. */
export async function clubArtistIds(db: Db, clubId: string | null): Promise<string[]> {
  if (!clubId) return []

  const { data, error } = await db
    .from('club_artists')
    .select('artist_id')
    .eq('club_id', clubId)

  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => row.artist_id)
}

/** Klubben showet tilhører. Null når showet ikke er knyttet til noen. */
export async function clubIdForShow(db: Db, showId: string): Promise<string | null> {
  const { data, error } = await db
    .from('shows')
    .select('club_id')
    .eq('id', showId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data?.club_id ?? null
}

/**
 * Kaster hvis komikeren ikke er knyttet til klubben.
 *
 * Listene i grensesnittet er ikke nok: handlingene under `shows/actions.ts`
 * er kallbare endepunkter, så en artist-id kan sendes inn uten å ha vært
 * innom en nedtrekksliste.
 */
export async function assertArtistBookableByClub(db: Db, clubId: string | null, artistId: string) {
  if (!artistId) throw new Error('Mangler komiker.')

  if (!clubId) {
    throw new Error('This show is not connected to a club, so no comedians can be booked for it.')
  }

  const { data, error } = await db
    .from('club_artists')
    .select('artist_id')
    .eq('club_id', clubId)
    .eq('artist_id', artistId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) {
    throw new Error('This comedian is not connected to your club. Add them from Discover first.')
  }
}

/** Samme sjekk, men når man bare har showet. */
export async function assertArtistBookableForShow(db: Db, showId: string, artistId: string) {
  await assertArtistBookableByClub(db, await clubIdForShow(db, showId), artistId)
}
