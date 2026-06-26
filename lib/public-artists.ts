import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Artist, Show } from '@/types/database'

export type PublicArtist = Pick<Artist,
  | 'id'
  | 'full_name'
  | 'stage_name'
  | 'profile_image_url'
  | 'bio'
  | 'category'
  | 'language'
  | 'social_links'
>

export type PublicArtistShow = Pick<Show,
  | 'id'
  | 'title'
  | 'slug'
  | 'club_id'
  | 'date'
  | 'start_time'
  | 'end_time'
  | 'venue_name'
  | 'venue_address'
  | 'poster_url'
> & {
  clubSlug: string | null
  role_name: string | null
}

// admin_energy_level is an internal rating — deliberately NOT exposed in the public projection.
const PUBLIC_ARTIST_FIELDS = 'id, full_name, stage_name, profile_image_url, bio, category, language, social_links'

export async function getPublicArtists(): Promise<PublicArtist[]> {
  const db = createAdminClient()
  const { data } = await db
    .from('artists')
    .select(PUBLIC_ARTIST_FIELDS)
    .eq('status', 'approved')
    .order('stage_name', { ascending: true, nullsFirst: false })
    .order('full_name', { ascending: true })
    .limit(500)

  return data ?? []
}

// Wrapped in React cache() so the duplicate call from generateMetadata + the page body
// in the same request only hits the DB once.
export const getPublicArtistById = cache(async (artistId: string): Promise<PublicArtist | null> => {
  const db = createAdminClient()
  const { data } = await db
    .from('artists')
    .select(PUBLIC_ARTIST_FIELDS)
    .eq('id', artistId)
    .eq('status', 'approved')
    .single()

  return data ?? null
})

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
          .select('id, title, slug, club_id, date, start_time, end_time, venue_name, venue_address, poster_url')
          .in('id', showIds)
          .eq('status', 'published')
          // Only genuinely upcoming shows — these render under "Kommende events", so a
          // finished show must not appear (and ascending order must not surface the
          // oldest past show first).
          .gte('date', new Date().toISOString().slice(0, 10))
          .order('date', { ascending: true })
      : Promise.resolve({ data: [] as Array<Pick<Show, 'id' | 'title' | 'slug' | 'club_id' | 'date' | 'start_time' | 'end_time' | 'venue_name' | 'venue_address' | 'poster_url'>> }),
    requirementIds.length
      ? db.from('show_requirements').select('id, role_name').in('id', requirementIds)
      : Promise.resolve({ data: [] as Array<{ id: string; role_name: string }> }),
  ])

  const clubIds = [...new Set((shows ?? []).map((show) => show.club_id).filter((clubId): clubId is string => Boolean(clubId)))]
  const { data: clubs } = clubIds.length > 0
    ? await db.from('clubs').select('id, slug').in('id', clubIds)
    : { data: [] as Array<{ id: string; slug: string }> }
  const clubSlugById = new Map((clubs ?? []).map((club) => [club.id, club.slug]))

  const roleByShowId = new Map(
    (spots ?? []).map((spot) => [spot.show_id, roles?.find((role) => role.id === spot.show_requirement_id)?.role_name ?? null])
  )

  return (shows ?? []).map((show) => ({
    ...show,
    clubSlug: show.club_id ? clubSlugById.get(show.club_id) ?? null : null,
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
