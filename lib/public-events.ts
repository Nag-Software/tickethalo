import { createAdminClient } from '@/lib/supabase/admin'
import type { Artist, ConfirmedSpot, Show, ShowRequirement } from '@/types/database'

export type PublicShow = Pick<Show, 'id' | 'title' | 'slug' | 'description' | 'date' | 'start_time' | 'end_time' | 'venue_name' | 'venue_address' | 'capacity' | 'ticket_price' | 'currency' | 'ticket_url' | 'poster_url' | 'status' | 'club_id'> & {
  clubName: string | null
  clubSlug: string | null
  clubCity: string | null
  clubLogoUrl: string | null
  /** Selgeren av billetten. Klubben er arrangør — Tickethalo formidler. */
  clubLegalName: string | null
  clubOrgNumber: string | null
  soldTickets: number
}

export type PublicLineupItem = {
  spot: ConfirmedSpot
  artist: Pick<Artist, 'id' | 'full_name' | 'stage_name' | 'profile_image_url' | 'bio'> | null
  role: Pick<ShowRequirement, 'id' | 'role_name'> | null
}

/** `as const` er ikke pynt: supabase-js utleder radtypen fra selve strengen. */
const SHOW_COLUMNS =
  'id, title, slug, description, date, start_time, end_time, venue_name, venue_address, capacity, ticket_price, currency, ticket_url, poster_url, status, club_id' as const

export async function getUpcomingPublishedShows(limit?: number): Promise<PublicShow[]> {
  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  let query = db
    .from('shows')
    .select(SHOW_COLUMNS)
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
    .select(SHOW_COLUMNS)
    .eq('slug', slug)
    .eq('status', 'published')
    .single()

  if (!show) return null
  const [withCounts] = await withTicketCounts([show])
  return withCounts ?? null
}

/**
 * Showene på én klubbside: kommende først, og et kort tilbakeblikk under.
 * Tilbakeblikket er der for klubber som ikke har lagt ut noe nytt ennå — en
 * tom klubbside sier ingenting om klubben.
 */
export async function getClubShows(clubId: string, pastLimit = 6): Promise<{ upcoming: PublicShow[]; past: PublicShow[] }> {
  const db = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: upcoming }, { data: past }] = await Promise.all([
    db
      .from('shows')
      .select(SHOW_COLUMNS)
      .eq('club_id', clubId)
      .eq('status', 'published')
      .gte('date', today)
      .order('date', { ascending: true }),
    db
      .from('shows')
      .select(SHOW_COLUMNS)
      .eq('club_id', clubId)
      .in('status', ['published', 'completed'])
      .lt('date', today)
      .order('date', { ascending: false })
      .limit(pastLimit),
  ])

  const [upcomingWithCounts, pastWithCounts] = await Promise.all([
    withTicketCounts(upcoming ?? []),
    withTicketCounts(past ?? []),
  ])

  return { upcoming: upcomingWithCounts, past: pastWithCounts }
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
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value))
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(value))
}

export function formatShowTime(show: Pick<Show, 'start_time' | 'end_time'>) {
  const start = show.start_time?.slice(0, 5)
  const end = show.end_time?.slice(0, 5)
  if (start && end) return `${start}-${end}`
  return start ?? 'Time TBA'
}

export function formatTicketPrice(show: Pick<Show, 'ticket_price' | 'currency'>) {
  if (!show.ticket_price) return 'Free'
  // en-GB over en-US: the venues bill in NOK, and en-GB renders that as
  // "NOK 270" rather than the US "NOK 270.00" with a dollar-shaped layout.
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: show.currency, maximumFractionDigits: 0 }).format(show.ticket_price / 100)
}

export function remainingTickets(show: Pick<Show, 'capacity'> & { soldTickets: number }) {
  return show.capacity === null ? null : Math.max(show.capacity - show.soldTickets, 0)
}

export function ticketFillPercent(show: Pick<Show, 'capacity'> & { soldTickets: number }) {
  if (!show.capacity) return 0
  return Math.min(Math.round((show.soldTickets / show.capacity) * 100), 100)
}

/**
 * Fyller på klubbnavn og antall solgte billetter.
 *
 * Begge deler hentes i én runde hver, uansett hvor mange show lista har.
 * Billettallet kommer fra `show_ticket_counts` (migrasjon 031) — før dette
 * gjorde funksjonen én count-spørring per show, altså tjue kall for en
 * forside med tjue show.
 */
async function withTicketCounts(shows: Array<Pick<Show, 'id' | 'title' | 'slug' | 'description' | 'date' | 'start_time' | 'end_time' | 'venue_name' | 'venue_address' | 'capacity' | 'ticket_price' | 'currency' | 'ticket_url' | 'poster_url' | 'status' | 'club_id'>>): Promise<PublicShow[]> {
  if (shows.length === 0) return []

  const db = createAdminClient()
  const clubIds = [...new Set(shows.map((show) => show.club_id).filter((clubId): clubId is string => Boolean(clubId)))]
  const showIds = shows.map((show) => show.id)

  const [{ data: clubs }, { data: ticketCounts }] = await Promise.all([
    clubIds.length > 0
      ? db.from('clubs').select('id, name, slug, city, logo_url, legal_name, org_number').in('id', clubIds)
      : Promise.resolve({
        data: [] as Array<{
          id: string
          name: string
          slug: string
          city: string | null
          logo_url: string | null
          legal_name: string | null
          org_number: string | null
        }>,
      }),
    db.from('show_ticket_counts').select('show_id, sold_tickets').in('show_id', showIds),
  ])

  const clubMap = new Map((clubs ?? []).map((club) => [club.id, club]))
  const soldByShow = new Map((ticketCounts ?? []).map((row) => [row.show_id, row.sold_tickets]))

  return shows.map((show) => {
    const club = show.club_id ? clubMap.get(show.club_id) : null

    return {
      ...show,
      clubName: club?.name ?? null,
      clubSlug: club?.slug ?? null,
      clubCity: club?.city ?? null,
      clubLogoUrl: club?.logo_url ?? null,
      clubLegalName: club?.legal_name ?? null,
      clubOrgNumber: club?.org_number ?? null,
      soldTickets: soldByShow.get(show.id) ?? 0,
    }
  })
}