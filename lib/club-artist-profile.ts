import { createAdminClient } from '@/lib/supabase/admin'
import type { Artist, ArtistType, ClubArtist, EnergyLevel } from '@/types/database'

type Db = ReturnType<typeof createAdminClient>

/**
 * Klubbens vurdering av en komiker.
 *
 * Roller, energi, notater og flagg er klubbens mening og ligger på
 * `club_artists` (migrasjon 043). De samme kolonnene står fortsatt på
 * `artists`, men de er komikerens egen beskrivelse — leser man dem for å
 * avgjøre hva klubben mener, er man tilbake til én delt sannhet for alle.
 *
 * Derfor går alle klubbflater gjennom denne modulen.
 */

const REVIEW_FIELDS = 'artist_id, category, admin_energy_level, admin_notes, is_flagged, flag_reason, flagged_at'

export type ClubArtistReview = Pick<
  ClubArtist,
  'category' | 'admin_energy_level' | 'admin_notes' | 'is_flagged' | 'flag_reason' | 'flagged_at'
>

/** Det en komiker har før klubben har vurdert hen. */
export const EMPTY_REVIEW: ClubArtistReview = {
  category: null,
  admin_energy_level: null,
  admin_notes: null,
  is_flagged: false,
  flag_reason: null,
  flagged_at: null,
}

/** Klubbens vurdering av én komiker. Null = ikke knyttet til klubben. */
export async function clubArtistReview(
  db: Db,
  clubId: string | null,
  artistId: string,
): Promise<ClubArtistReview | null> {
  if (!clubId || !artistId) return null

  const { data, error } = await db
    .from('club_artists')
    .select(REVIEW_FIELDS)
    .eq('club_id', clubId)
    .eq('artist_id', artistId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data ? toReview(data) : null
}

/**
 * Vurderingene for hele klubbens liste, slått opp på artist-id.
 *
 * Ett oppslag for alle: sidene her viser opptil et par hundre komikere, og
 * én spørring per rad ville blitt like mange rundturer.
 */
export async function clubArtistReviews(
  db: Db,
  clubId: string | null,
): Promise<Map<string, ClubArtistReview>> {
  if (!clubId) return new Map()

  const { data, error } = await db
    .from('club_artists')
    .select(REVIEW_FIELDS)
    .eq('club_id', clubId)

  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((row) => [row.artist_id as string, toReview(row)]))
}

const ROSTER_ARTIST_FIELDS = 'id, full_name, stage_name, email, profile_image_url, status, created_at'

export type ClubRosterArtist = Pick<
  Artist,
  'id' | 'full_name' | 'stage_name' | 'email' | 'profile_image_url' | 'status' | 'created_at'
>

export type ClubRosterEntry = { artist: ClubRosterArtist; review: ClubArtistReview }

/**
 * Klubbens komikerliste: komikeren og klubbens vurdering av hen, nyeste først.
 *
 * Én spørring. Lista var før to rundturer etter hverandre — vurderingene for å
 * finne hvem som er med, så komikerne med alle ID-ene i en `in()`. Databasen
 * svarer på under et millisekund; det er rundturene fra serveren som koster,
 * så komikeren bakes inn i koblingen og søket gjøres i samme runde.
 */
export async function clubArtistRoster(
  db: Db,
  clubId: string | null,
  { search = '', limit = 200 }: { search?: string; limit?: number } = {},
): Promise<ClubRosterEntry[]> {
  if (!clubId) return []

  // `!inner` gjør søket på komikeren til et filter på koblingen — ellers ble
  // koblinger uten treff stående med `artists: null`. Å sortere på en innbakt
  // kolonne krever at kolonnen også er valgt, derfor `created_at` over.
  let query = db
    .from('club_artists')
    .select(`${REVIEW_FIELDS}, artists!inner(${ROSTER_ARTIST_FIELDS})`)
    .eq('club_id', clubId)
    .order('artists(created_at)', { ascending: false })
    .limit(limit)

  // `%` er jokertegn i `ilike`. Resten av søket står i anførselstegn, så komma
  // og parenteser er tekst å lete etter og ikke en del av filtersyntaksen.
  const term = search.replace(/%/g, ' ').trim()
  if (term) {
    const pattern = `"%${term.replace(/[\\"]/g, (char) => `\\${char}`)}%"`
    query = query.or(
      `full_name.ilike.${pattern},stage_name.ilike.${pattern},email.ilike.${pattern}`,
      { referencedTable: 'artists' },
    )
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)

  // `Relationships` i den genererte Database-typen er tom, så formen på det
  // innbakte treet settes for hånd — samme grep som i `lib/session`.
  const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { artists: ClubRosterArtist }>
  return rows.map((row) => ({ artist: row.artists, review: toReview(row) }))
}

/** Skriver klubbens vurdering. Bare feltene som faktisk sendes inn. */
export async function saveClubArtistReview(
  db: Db,
  clubId: string,
  artistId: string,
  patch: Partial<ClubArtistReview>,
) {
  if (Object.keys(patch).length === 0) return

  // `select()` for å se hva som faktisk ble truffet. Uten den ville en
  // lagring på en komiker klubben ikke har knyttet til seg treffe null rader
  // og melde suksess — skjemaet ser ut til å virke, men ingenting skjer.
  const { data, error } = await db
    .from('club_artists')
    .update(patch)
    .eq('club_id', clubId)
    .eq('artist_id', artistId)
    .select('artist_id')

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('This comedian is not connected to your club, so there is nothing to save.')
  }
}

function toReview(row: Record<string, unknown>): ClubArtistReview {
  return {
    category: (row.category as ArtistType[] | null) ?? null,
    admin_energy_level: (row.admin_energy_level as EnergyLevel | null) ?? null,
    admin_notes: (row.admin_notes as string | null) ?? null,
    is_flagged: Boolean(row.is_flagged),
    flag_reason: (row.flag_reason as string | null) ?? null,
    flagged_at: (row.flagged_at as string | null) ?? null,
  }
}

/**
 * Legger klubbens vurdering over komikerradene motoren matcher på.
 *
 * Rollene og energien som avgjør om noen passer et show-krav skal være
 * klubbens, ikke komikerens egen beskrivelse. Komikere klubben har flagget
 * faller ut her — flagget gjelder bare denne klubben, så det kan ikke
 * filtreres i spørringen mot `artists`.
 */
export function withClubReview<T extends { id: string }>(
  artists: T[],
  reviews: Map<string, ClubArtistReview>,
): Array<T & { category: ArtistType[] | null; admin_energy_level: EnergyLevel | null }> {
  return artists.flatMap((artist) => {
    const review = reviews.get(artist.id)
    if (!review || review.is_flagged) return []
    return [{ ...artist, category: review.category, admin_energy_level: review.admin_energy_level }]
  })
}
