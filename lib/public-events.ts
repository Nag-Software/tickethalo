import { createAdminClient } from '@/lib/supabase/admin'
import type { Artist, ConfirmedSpot, Show, ShowRequirement } from '@/types/database'

export type PublicShow = Pick<Show, 'id' | 'title' | 'slug' | 'description' | 'date' | 'start_time' | 'end_time' | 'venue_name' | 'venue_address' | 'capacity' | 'ticket_price' | 'currency' | 'ticket_url' | 'poster_url' | 'status' | 'club_id'> & {
  clubName: string | null
  clubCity: string | null
  soldTickets: number
}

export type PublicLineupItem = {
  spot: ConfirmedSpot
  artist: Pick<Artist, 'id' | 'full_name' | 'stage_name' | 'profile_image_url' | 'bio'> | null
  role: Pick<ShowRequirement, 'id' | 'role_name'> | null
}

export async function getUpcomingPublishedShows(limit?: number): Promise<PublicShow[]> {
  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  let query = db
    .from('shows')
    .select('id, title, slug, description, date, start_time, end_time, venue_name, venue_address, capacity, ticket_price, currency, ticket_url, poster_url, status, club_id')
    .eq('status', 'published')
    .gte('date', today)
    .order('date', { ascending: true })

  if (limit) query = query.limit(limit)

  const { data: shows } = await query
  return withTicketCounts(shows ?? [])
}

export async function getPublishedShowBySlug(slug: string): Promise<PublicShow | null> {
  const db = createAdminClient()
  const { data: show } = await db
    .from('shows')
    .select('id, title, slug, description, date, start_time, end_time, venue_name, venue_address, capacity, ticket_price, currency, ticket_url, poster_url, status, club_id')
    .eq('slug', slug)
    .eq('status', 'published')
    .single()

  if (!show) return null
  const [withCounts] = await withTicketCounts([show])
  return withCounts ?? null
}

export async function getPublicLineup(showId: string): Promise<PublicLineupItem[]> {
  const db = createAdminClient()
  const { data: spots } = await db
    .from('confirmed_spots')
    .select('*')
    .eq('show_id', showId)
    .eq('status', 'confirmed')
    .order('confirmed_at', { ascending: true })

  const artistIds = [...new Set((spots ?? []).map((spot) => spot.artist_id))]
  const requirementIds = [...new Set((spots ?? []).map((spot) => spot.show_requirement_id))]
  const [{ data: artists }, { data: roles }] = await Promise.all([
    artistIds.length
      ? db.from('artists').select('id, full_name, stage_name, profile_image_url, bio').in('id', artistIds)
      : Promise.resolve({ data: [] as Array<Pick<Artist, 'id' | 'full_name' | 'stage_name' | 'profile_image_url' | 'bio'>> }),
    requirementIds.length
      ? db.from('show_requirements').select('id, role_name').in('id', requirementIds)
      : Promise.resolve({ data: [] as Array<Pick<ShowRequirement, 'id' | 'role_name'>> }),
  ])
  const artistMap = new Map((artists ?? []).map((artist) => [artist.id, artist]))
  const roleMap = new Map((roles ?? []).map((role) => [role.id, role]))

  return (spots ?? []).map((spot) => ({
    spot,
    artist: artistMap.get(spot.artist_id) ?? null,
    role: roleMap.get(spot.show_requirement_id) ?? null,
  }))
}

export function formatShowDate(value: string) {
  return new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value))
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short' }).format(new Date(value))
}

export function formatShowTime(show: Pick<Show, 'start_time' | 'end_time'>) {
  const start = show.start_time?.slice(0, 5)
  const end = show.end_time?.slice(0, 5)
  if (start && end) return `${start}-${end}`
  return start ?? 'Tid kommer'
}

export function formatTicketPrice(show: Pick<Show, 'ticket_price' | 'currency'>) {
  if (!show.ticket_price) return 'Gratis'
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: show.currency, maximumFractionDigits: 0 }).format(show.ticket_price / 100)
}

export function remainingTickets(show: Pick<Show, 'capacity'> & { soldTickets: number }) {
  return show.capacity === null ? null : Math.max(show.capacity - show.soldTickets, 0)
}

export function ticketFillPercent(show: Pick<Show, 'capacity'> & { soldTickets: number }) {
  if (!show.capacity) return 0
  return Math.min(Math.round((show.soldTickets / show.capacity) * 100), 100)
}

async function withTicketCounts(shows: Array<Pick<Show, 'id' | 'title' | 'slug' | 'description' | 'date' | 'start_time' | 'end_time' | 'venue_name' | 'venue_address' | 'capacity' | 'ticket_price' | 'currency' | 'ticket_url' | 'poster_url' | 'status' | 'club_id'>>): Promise<PublicShow[]> {
  const db = createAdminClient()
  const clubIds = [...new Set(shows.map((show) => show.club_id).filter((clubId): clubId is string => Boolean(clubId)))]
  const { data: clubs } = clubIds.length > 0
    ? await db.from('clubs').select('id, name, city').in('id', clubIds)
    : { data: [] as Array<{ id: string; name: string; city: string | null }> }
  const clubMap = new Map((clubs ?? []).map((club) => [club.id, club]))

  return Promise.all(shows.map(async (show) => {
    const { count } = await db
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('show_id', show.id)
      .in('status', ['valid', 'used'])

    const club = show.club_id ? clubMap.get(show.club_id) : null

    return {
      ...show,
      clubName: club?.name ?? null,
      clubCity: club?.city ?? null,
      soldTickets: count ?? 0,
    }
  }))
}