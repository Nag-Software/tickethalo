import { createAdminClient } from '@/lib/supabase/admin'
import { hasScheduleConflict, type ArtistBooking } from '@/lib/booking-rules'
import { loadBookingSettings } from '@/lib/booking-settings-store'

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
 * Her ligger også de to kravene som handler om kvelden og ikke om listen:
 * komikeren har markert dagen som opptatt, eller er allerede booket på et
 * show som kolliderer. Bookeren kan gå foran systemet på kravene til
 * *plassen* — rolle, energi, kjønn — men ikke på disse to. Den ene er
 * komikerens eget nei, den andre er fysisk umulig.
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

/** Dagene komikerne har markert som opptatt på en gitt dato. */
export async function unavailableArtistIdsOnDate(db: Db, date: string, artistIds?: string[]): Promise<Set<string>> {
  if (!date) return new Set()

  let query = db.from('artist_unavailable_dates').select('artist_id').eq('unavailable_date', date)
  if (artistIds && artistIds.length > 0) query = query.in('artist_id', artistIds)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return new Set((data ?? []).map((row) => row.artist_id))
}

/**
 * De bekreftede plassene komikerne har på en gitt dato, uansett klubb.
 *
 * Kollisjonssjekken trenger starttiden på det andre showet, ikke bare at det
 * finnes. Ett oppslag for hele listen, så motoren ikke gjør ett per komiker.
 */
export async function bookingsOnDate(
  db: Db,
  date: string,
  artistIds: string[],
): Promise<Map<string, ArtistBooking[]>> {
  const bookings = new Map<string, ArtistBooking[]>()
  if (!date || artistIds.length === 0) return bookings

  const { data: shows, error: showError } = await db
    .from('shows')
    .select('id, date, start_time')
    .eq('date', date)
    .is('deleted_at', null)

  if (showError) throw new Error(showError.message)
  if (!shows?.length) return bookings

  const showById = new Map(shows.map((show) => [show.id, show]))

  const { data: spots, error: spotError } = await db
    .from('confirmed_spots')
    .select('artist_id, show_id')
    .in('show_id', [...showById.keys()])
    .in('artist_id', artistIds)
    .in('status', ['confirmed', 'completed', 'paid'])

  if (spotError) throw new Error(spotError.message)

  for (const spot of spots ?? []) {
    const show = showById.get(spot.show_id)
    if (!show) continue
    const list = bookings.get(spot.artist_id) ?? []
    list.push({ show_id: show.id, date: show.date, start_time: show.start_time })
    bookings.set(spot.artist_id, list)
  }

  return bookings
}

/**
 * Hvorfor komikeren ikke kan ta akkurat denne kvelden. Null = hen kan.
 *
 * Gjelder kravene som handler om kvelden, ikke om plassen. Bookeren kan
 * sende et tilbud til en komiker som ikke matcher rollen — men ikke til en
 * som har sagt at hen ikke kan den dagen, og ikke til en som allerede står
 * på en annen scene.
 */
export async function eveningBlockerForArtist(
  db: Db,
  show: { id: string; date: string; start_time: string | null },
  artistId: string,
): Promise<string | null> {
  const [unavailable, bookings, settings] = await Promise.all([
    unavailableArtistIdsOnDate(db, show.date, [artistId]),
    bookingsOnDate(db, show.date, [artistId]),
    loadBookingSettings(db),
  ])

  if (unavailable.has(artistId)) {
    return 'This comedian has marked that date as unavailable.'
  }

  const conflict = hasScheduleConflict({
    showId: show.id,
    date: show.date,
    startTime: show.start_time,
    bookings: bookings.get(artistId) ?? [],
    conflictWindowHours: settings.conflict_window_hours,
  })

  if (conflict) {
    return 'This comedian is already booked for another show that evening.'
  }

  return null
}

/** Samme sjekk som `assertArtistBookableByClub`, men når man bare har showet. */
export async function assertArtistBookableForShow(db: Db, showId: string, artistId: string) {
  const { data: show, error } = await db
    .from('shows')
    .select('id, club_id, date, start_time')
    .eq('id', showId)
    .maybeSingle()

  if (error) throw new Error(error.message)

  await assertArtistBookableByClub(db, show?.club_id ?? null, artistId)

  if (show) {
    const blocker = await eveningBlockerForArtist(db, show, artistId)
    if (blocker) throw new Error(blocker)
  }
}
