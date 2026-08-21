import { createAdminClient } from '@/lib/supabase/admin'
import type { Club, ClubLocation } from '@/types/database'

export type PublicClubLocation = Pick<ClubLocation, 'id' | 'name' | 'address_line'>

export type PublicClub = Pick<Club, 'id' | 'name' | 'slug' | 'description' | 'logo_url' | 'city' | 'brand_color'> & {
  locations: PublicClubLocation[]
}

const CLUB_COLUMNS = 'id, name, slug, description, logo_url, city, brand_color' as const

export async function getPublicClubBySlug(slug: string): Promise<PublicClub | null> {
  const db = createAdminClient()

  const { data: club } = await db
    .from('clubs')
    .select(CLUB_COLUMNS)
    .eq('slug', slug)
    .maybeSingle()

  if (!club) return null

  const { data: locations } = await db
    .from('club_locations')
    .select('id, name, address_line')
    .eq('club_id', club.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  return { ...club, locations: locations ?? [] }
}

/** "Storgata 1, Oslo" — the address on one line, without stray commas. */
export function formatClubLocation(location: PublicClubLocation, city: string | null): string {
  return [location.address_line, city].filter(Boolean).join(', ')
}

/** A map link, so the address is something you can actually act on. */
export function mapsUrl(location: PublicClubLocation, city: string | null): string {
  const query = [location.name, location.address_line, city].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}
