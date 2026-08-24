import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { DeleteButton } from '@/components/admin/delete-button'
import { ShowBookingCard, SHOW_STATUS_LABELS } from '@/components/admin/show-booking-card'
import { buildBookingSpots, type BookingSpot } from '@/lib/booking-spots'
import { deleteShowAction } from './actions'
import type { Artist, BookingOffer, ConfirmedSpot, Show, ShowRequirement, ShowStatus } from '@/types/database'
import { getClubAccess } from '@/lib/club-auth'

type ShowRow = Pick<Show, 'id' | 'title' | 'date' | 'venue_name' | 'venue_address' | 'status' | 'capacity' | 'ticket_price' | 'currency' | 'published_at' | 'slug' | 'poster_url'>
type RequirementRow = Pick<ShowRequirement, 'id' | 'show_id' | 'role_name' | 'quantity' | 'lineup_position' | 'compensation_type' | 'compensation_amount' | 'compensation_percent'>
type SpotRow = Pick<ConfirmedSpot, 'show_id' | 'artist_id' | 'show_requirement_id' | 'status'>
type OfferRow = Pick<BookingOffer, 'show_id' | 'artist_id' | 'show_requirement_id' | 'status'>
type ArtistRow = Pick<Artist, 'id' | 'full_name' | 'stage_name'>
type EnrichedShowRow = ShowRow & {
  soldTickets: number
  spots: BookingSpot[]
}

const statusColors: Record<ShowStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  booking: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  fullbooked: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  completed: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
}

const statusFilters: Array<{ value: ShowStatus; label: string }> = (
  ['draft', 'booking', 'fullbooked', 'published', 'completed', 'cancelled'] as const
).map((value) => ({ value, label: SHOW_STATUS_LABELS[value] }))

export default async function ShowsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const db = createAdminClient()
  const clubAccess = await getClubAccess()

  let showsQuery = db
    .from('shows')
    .select('id, title, date, venue_name, venue_address, status, capacity, ticket_price, currency, published_at, slug, poster_url')
    .order('date', { ascending: true })
    .limit(200)

  if (clubAccess.clubIds.length > 0) {
    showsQuery = showsQuery.in('club_id', clubAccess.clubIds)
  } else {
    showsQuery = showsQuery.eq('id', '00000000-0000-0000-0000-000000000000') // no results
  }

  const { data: allShows } = await showsQuery

  const showIds = (allShows ?? []).map((show) => show.id)
  const [{ data: requirementRows }, { data: spotRows }, { data: offerRows }, { data: ticketRows }] = await Promise.all([
    showIds.length > 0
      ? db.from('show_requirements').select('id, show_id, role_name, quantity, lineup_position, compensation_type, compensation_amount, compensation_percent').in('show_id', showIds).order('lineup_position').order('created_at')
      : Promise.resolve({ data: [] as RequirementRow[] }),
    showIds.length > 0
      ? db.from('confirmed_spots').select('show_id, artist_id, show_requirement_id, status').in('show_id', showIds).in('status', ['confirmed', 'completed', 'paid'])
      : Promise.resolve({ data: [] as SpotRow[] }),
    showIds.length > 0
      ? db.from('booking_offers').select('show_id, artist_id, show_requirement_id, status').in('show_id', showIds).eq('status', 'sent')
      : Promise.resolve({ data: [] as OfferRow[] }),
    showIds.length > 0
      ? db.from('tickets').select('show_id').in('show_id', showIds).in('status', ['valid', 'used'])
      : Promise.resolve({ data: [] as Array<{ show_id: string }> }),
  ])

  const artistIds = [...new Set([
    ...(spotRows ?? []).map((spot) => spot.artist_id),
    ...(offerRows ?? []).map((offer) => offer.artist_id),
  ])]
  const { data: artistRows } = artistIds.length > 0
    ? await db.from('artists').select('id, full_name, stage_name').in('id', artistIds)
    : { data: [] as ArtistRow[] }

  const requirementsByShow = new Map<string, RequirementRow[]>()
  for (const requirement of requirementRows ?? []) {
    const current = requirementsByShow.get(requirement.show_id) ?? []
    current.push(requirement)
    requirementsByShow.set(requirement.show_id, current)
  }

  const spotsByShow = new Map<string, SpotRow[]>()
  for (const spot of spotRows ?? []) {
    const current = spotsByShow.get(spot.show_id) ?? []
    current.push(spot)
    spotsByShow.set(spot.show_id, current)
  }

  const offersByShow = new Map<string, OfferRow[]>()
  for (const offer of offerRows ?? []) {
    const current = offersByShow.get(offer.show_id) ?? []
    current.push(offer)
    offersByShow.set(offer.show_id, current)
  }

  const soldTicketsByShow = new Map<string, number>()
  for (const ticket of ticketRows ?? []) {
    soldTicketsByShow.set(ticket.show_id, (soldTicketsByShow.get(ticket.show_id) ?? 0) + 1)
  }

  const artistMap = new Map((artistRows ?? []).map((artist) => [artist.id, artist]))
  const artistLabel = (artistId: string) => {
    const artist = artistMap.get(artistId)
    return artist ? artist.stage_name ?? artist.full_name : 'Unknown artist'
  }

  const enrichedShows: EnrichedShowRow[] = (allShows ?? []).map((show) => {
    const showRequirements = requirementsByShow.get(show.id) ?? []
    const showSpots = spotsByShow.get(show.id) ?? []
    const showOffers = offersByShow.get(show.id) ?? []
    const soldTickets = soldTicketsByShow.get(show.id) ?? 0

    const spots = buildBookingSpots({
      requirements: showRequirements,
      confirmedSpots: showSpots,
      offers: showOffers,
      artistName: artistLabel,
      currency: show.currency,
    })

    return {
      ...show,
      soldTickets,
      spots,
    }
  })

  const activeStatus = statusFilters.some((filter) => filter.value === status)
    ? status as ShowStatus
    : undefined
  const shows = activeStatus
    ? enrichedShows.filter((show) => show.status === activeStatus)
    : enrichedShows

  const today = new Date().toISOString().slice(0, 10)
  const upcomingShows = (shows ?? []).filter(s => s.date >= today)
  const pastShows = (shows ?? []).filter(s => s.date < today)
  const visibleStatusFilters = statusFilters.filter((filter) =>
    enrichedShows.some((show) => show.status === filter.value) || activeStatus === filter.value
  )

  return (
    <div>
      <AdminHeader
        title="Shows"
        description={`${shows?.length ?? 0} shows`}
        actions={
          <Link
            href="/admin-app/shows/new"
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            + New show
          </Link>
        }
      />
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin-app/shows"
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${!activeStatus ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'}`}>
            All ({allShows?.length ?? 0})
          </Link>
          {visibleStatusFilters.map((filter) => (
            <Link key={filter.value} href={`/admin-app/shows?status=${filter.value}`}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${activeStatus === filter.value ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'}`}>
              {filter.label} ({enrichedShows.filter((show) => show.status === filter.value).length})
            </Link>
          ))}
        </div>

        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Upcoming ({upcomingShows.length})
          </h2>
          <UpcomingShowsGrid rows={upcomingShows} />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Past ({pastShows.length})
          </h2>
          <ShowsTable rows={pastShows} />
        </section>
      </div>
    </div>
  )
}

function UpcomingShowsGrid({ rows }: { rows: EnrichedShowRow[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Link
        href="/admin-app/shows/new"
        className="flex min-h-40 max-h-60 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed bg-muted/40 p-8 text-center transition hover:-translate-y-0.5 hover:bg-muted/60"
      >
        <span className="text-5xl font-light leading-none text-muted-foreground">+</span>
        <span className="space-y-1.5">
          <span className="block text-lg font-bold tracking-tight">New show</span>
          <span className="block text-xs text-muted-foreground">Create a show, add the details and get the poster ready.</span>
        </span>
      </Link>

      {rows.map((show) => (
        <ShowBookingCard
          key={show.id}
          deleteAction={deleteShowAction}
          show={{
            id: show.id,
            title: show.title,
            date: show.date,
            status: show.status,
            posterUrl: show.poster_url,
            capacity: show.capacity,
            soldTickets: show.soldTickets,
            spots: show.spots,
          }}
        />
      ))}
    </div>
  )
}

function ShowsTable({ rows }: { rows: ShowRow[] }) {
  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
            <th className="text-left px-4 py-2.5 font-medium">Title</th>
            <th className="text-left px-4 py-2.5 font-medium">Date</th>
            <th className="text-left px-4 py-2.5 font-medium">Venue</th>
            <th className="text-left px-4 py-2.5 font-medium">Status</th>
            <th className="text-center px-4 py-2.5 font-medium">Capacity</th>
            <th className="text-left px-4 py-2.5 font-medium">Price</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((show) => (
            <tr key={show.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
              <td className="px-4 py-3">
                <Link href={`/admin-app/shows/${show.id}`} className="font-medium hover:underline">
                  {show.title}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                {new Date(show.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{show.venue_name ?? show.venue_address ?? '—'}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[show.status]}`}>
                  {SHOW_STATUS_LABELS[show.status]}
                </span>
              </td>
              <td className="px-4 py-3 text-center">{show.capacity ?? '—'}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {show.ticket_price
                  ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: show.currency, maximumFractionDigits: 0 }).format(show.ticket_price / 100)
                  : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                <DeleteButton
                  action={deleteShowAction}
                  id={show.id}
                  idField="show_id"
                  confirmMessage={`Delete the show "${show.title}"? This cannot be undone.`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="text-center py-8 text-muted-foreground text-sm">No shows.</p>
      )}
    </div>
  )
}
