import { createAdminClient } from '@/lib/supabase/admin'
import type { Artist, Show } from '@/types/database'

export type PublicArtist = Pick<Artist,
  | 'id'
  | 'full_name'
  | 'stage_name'
  | 'profile_image_url'
  | 'bio'
  | 'category'
  | 'city'
  | 'country'
  | 'languages'
  | 'social_links'
>

export type PublicArtistShow = Pick<Show,
  | 'id'
  | 'title'
  | 'slug'
  | 'date'
  | 'start_time'
  | 'end_time'
  | 'venue_name'
  | 'venue_address'
  | 'poster_url'
> & {
  role_name: string | null
}

// Score er intern (migrasjon 041), og energi er klubbens egen vurdering
// (migrasjon 043). Ingen av dem hører hjemme på en offentlig side.
const PUBLIC_ARTIST_FIELDS = 'id, full_name, stage_name, profile_image_url, bio, category, city, country, languages, social_links'

export async function getPublicArtists(): Promise<PublicArtist[]> {
  const db = createAdminClient()
  const { data } = await db
    .from('artists')
    .select(PUBLIC_ARTIST_FIELDS)
    .eq('status', 'approved')
    .order('stage_name', { ascending: true, nullsFirst: false })
    .order('full_name', { ascending: true })

  return data ?? []
}

export async function getPublicArtistById(artistId: string): Promise<PublicArtist | null> {
  const db = createAdminClient()
  const { data } = await db
    .from('artists')
    .select(PUBLIC_ARTIST_FIELDS)
    .eq('id', artistId)
    .eq('status', 'approved')
    .single()

  return data ?? null
}

export async function getPublicArtistShows(artistId: string): Promise<PublicArtistShow[]> {
  const db = createAdminClient()
  const { data: spots } = await db
    .from('confirmed_spots')
    .select('show_id, show_requirement_id')
    .eq('artist_id', artistId)
    .in('status', ['confirmed', 'completed', 'paid'])

  const showIds = [...new Set((spots ?? []).map((spot) => spot.show_id))]
  const requirementIds = [...new Set((spots ?? []).map((spot) => spot.show_requirement_id))]

  const [{ data: shows }, { data: roles }] = await Promise.all([
    showIds.length
      ? db
          .from('shows')
          .select('id, title, slug, date, start_time, end_time, venue_name, venue_address, poster_url')
          .in('id', showIds)
          .eq('status', 'published')
          .order('date', { ascending: true })
      : Promise.resolve({ data: [] as Array<Pick<Show, 'id' | 'title' | 'slug' | 'date' | 'start_time' | 'end_time' | 'venue_name' | 'venue_address' | 'poster_url'>> }),
    requirementIds.length
      ? db.from('show_requirements').select('id, role_name').in('id', requirementIds)
      : Promise.resolve({ data: [] as Array<{ id: string; role_name: string }> }),
  ])

  const roleByShowId = new Map(
    (spots ?? []).map((spot) => [spot.show_id, roles?.find((role) => role.id === spot.show_requirement_id)?.role_name ?? null])
  )

  return (shows ?? []).map((show) => ({
    ...show,
    role_name: roleByShowId.get(show.id) ?? null,
  }))
}

export function artistDisplayName(artist: Pick<PublicArtist, 'full_name' | 'stage_name'>) {
  return artist.stage_name ?? artist.full_name
}

export function artistInitials(artist: Pick<PublicArtist, 'full_name' | 'stage_name'>) {
  return artistDisplayName(artist)
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
