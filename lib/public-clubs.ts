import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Club, Show } from '@/types/database'

export type PublicClub = Pick<Club, 'id' | 'name' | 'slug' | 'description' | 'logo_url' | 'header_image_url' | 'location_name' | 'address_line' | 'city'> & {
  upcomingShowCount: number
  nextShowDate: string | null
}

export async function getPublicClubs(): Promise<PublicClub[]> {
  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: clubs } = await db
    .from('clubs')
    .select('id, name, slug, description, logo_url, header_image_url, location_name, address_line, city')
    .order('name', { ascending: true })
    .limit(200)

  return withUpcomingShowStats(clubs ?? [], today)
}

// Wrapped in React cache() so the duplicate call from generateMetadata + the page body
// in the same request only hits the DB once.
export const getPublicClubBySlug = cache(async (slug: string): Promise<PublicClub | null> => {
  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: club } = await db
    .from('clubs')
    .select('id, name, slug, description, logo_url, header_image_url, location_name, address_line, city')
    .eq('slug', slug)
    .single()

  if (!club) return null

  const [withStats] = await withUpcomingShowStats([club], today)
  return withStats ?? null
})

async function withUpcomingShowStats(
  clubs: Array<Pick<Club, 'id' | 'name' | 'slug' | 'description' | 'logo_url' | 'header_image_url' | 'location_name' | 'address_line' | 'city'>>,
  today: string,
): Promise<PublicClub[]> {
  const db = createAdminClient()
  const clubIds = clubs.map((club) => club.id)

  const { data: upcomingShows } = clubIds.length > 0
    ? await db
        .from('shows')
        .select('club_id, date')
        .in('club_id', clubIds)
        .eq('status', 'published')
        .gte('date', today)
        .order('date', { ascending: true })
    : { data: [] as Array<Pick<Show, 'club_id' | 'date'>> }

  const showCounts = new Map<string, number>()
  const nextShowDates = new Map<string, string>()

  for (const show of upcomingShows ?? []) {
    if (!show.club_id) continue

    showCounts.set(show.club_id, (showCounts.get(show.club_id) ?? 0) + 1)

    if (!nextShowDates.has(show.club_id)) {
      nextShowDates.set(show.club_id, show.date)
    }
  }

  return clubs.map((club) => ({
    ...club,
    upcomingShowCount: showCounts.get(club.id) ?? 0,
    nextShowDate: nextShowDates.get(club.id) ?? null,
  }))
}