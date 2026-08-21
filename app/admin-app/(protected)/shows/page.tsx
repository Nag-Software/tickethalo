import Image from 'next/image'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { DeleteButton } from '@/components/admin/delete-button'
import { deleteShowAction } from './actions'
import type { Artist, ConfirmedSpot, Show, ShowRequirement, ShowStatus } from '@/types/database'
import { cn } from '@/lib/utils'
import { canonicalRoleLabel } from '@/lib/artist-roles'
import { getClubAccess } from '@/lib/club-auth'

type ShowRow = Pick<Show, 'id' | 'title' | 'date' | 'venue_name' | 'venue_address' | 'status' | 'capacity' | 'ticket_price' | 'currency' | 'published_at' | 'slug' | 'poster_url'>
type RequirementRow = Pick<ShowRequirement, 'id' | 'show_id' | 'role_name' | 'quantity' | 'lineup_position'>
type SpotRow = Pick<ConfirmedSpot, 'show_id' | 'artist_id' | 'show_requirement_id' | 'status'>
type ArtistRow = Pick<Artist, 'id' | 'full_name' | 'stage_name'>
type EnrichedShowRow = ShowRow & {
  soldTickets: number
  remainingTickets: number | null
  fillPercent: number
  totalSlots: number
  totalFilled: number
  lineup: Array<{ lineupPosition: number; roleName: string; artistName: string }>
  slotSummary: Array<{ lineupPosition: number; roleName: string; quantity: number; filled: number; artistNames: string[] }>
}

const statusColors: Record<ShowStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  booking: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  fullbooked: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  completed: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
}

const statusFilters: Array<{ value: ShowStatus; label: string }> = [
  { value: 'draft', label: 'Planlegger' },
  { value: 'booking', label: 'Booking' },
  { value: 'fullbooked', label: 'Fullbooket' },
  { value: 'published', label: 'Publisert' },
  { value: 'completed', label: 'Gjennomført' },
  { value: 'cancelled', label: 'Kansellert' },
]

const statusLabels: Record<ShowStatus, string> = {
  draft: 'Planlegger',
  booking: 'Booking',
  fullbooked: 'Fullbooket',
  published: 'Publisert',
  completed: 'Gjennomført',
  cancelled: 'Kansellert',
}

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
  const [{ data: requirementRows }, { data: spotRows }, { data: ticketRows }] = await Promise.all([
    showIds.length > 0
      ? db.from('show_requirements').select('id, show_id, role_name, quantity, lineup_position').in('show_id', showIds).order('lineup_position').order('created_at')
      : Promise.resolve({ data: [] as RequirementRow[] }),
    showIds.length > 0
      ? db.from('confirmed_spots').select('show_id, artist_id, show_requirement_id, status').in('show_id', showIds).in('status', ['confirmed', 'completed', 'paid'])
      : Promise.resolve({ data: [] as SpotRow[] }),
    showIds.length > 0
      ? db.from('tickets').select('show_id').in('show_id', showIds).in('status', ['valid', 'used'])
      : Promise.resolve({ data: [] as Array<{ show_id: string }> }),
  ])

  const artistIds = [...new Set((spotRows ?? []).map((spot) => spot.artist_id))]
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

  const soldTicketsByShow = new Map<string, number>()
  for (const ticket of ticketRows ?? []) {
    soldTicketsByShow.set(ticket.show_id, (soldTicketsByShow.get(ticket.show_id) ?? 0) + 1)
  }

  const artistMap = new Map((artistRows ?? []).map((artist) => [artist.id, artist]))

  const enrichedShows: EnrichedShowRow[] = (allShows ?? []).map((show) => {
    const showRequirements = requirementsByShow.get(show.id) ?? []
    const showSpots = spotsByShow.get(show.id) ?? []
    const soldTickets = soldTicketsByShow.get(show.id) ?? 0
    const remainingTickets = show.capacity == null ? null : Math.max(show.capacity - soldTickets, 0)
    const fillPercent = !show.capacity ? 0 : Math.min(Math.round((soldTickets / show.capacity) * 100), 100)
    const slotSummary = showRequirements.map((requirement) => {
      const matchingSpots = showSpots.filter((spot) => spot.show_requirement_id === requirement.id)
      const artistNames = matchingSpots
        .map((spot) => artistMap.get(spot.artist_id))
        .filter((artist): artist is ArtistRow => Boolean(artist))
        .map((artist) => artist.stage_name ?? artist.full_name)

      return {
        lineupPosition: requirement.lineup_position,
        roleName: requirement.role_name,
        quantity: requirement.quantity,
        filled: Math.min(matchingSpots.length, requirement.quantity),
        artistNames,
      }
    })
    const lineup = slotSummary.flatMap((item) => item.artistNames.map((artistName) => ({
      lineupPosition: item.lineupPosition,
      roleName: item.roleName,
      artistName,
    })))
    const totalSlots = slotSummary.reduce((sum, item) => sum + item.quantity, 0)
    const totalFilled = slotSummary.reduce((sum, item) => sum + item.filled, 0)

    return {
      ...show,
      soldTickets,
      remainingTickets,
      fillPercent,
      totalSlots,
      totalFilled,
      lineup,
      slotSummary,
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
        title="Show"
        description={`${shows?.length ?? 0} show`}
        actions={
          <Link
            href="/admin-app/shows/new"
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            + Nytt show
          </Link>
        }
      />
      <div className="p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Link href="/admin-app/shows"
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${!activeStatus ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'}`}>
            Alle ({allShows?.length ?? 0})
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
            Kommende ({upcomingShows.length})
          </h2>
          <UpcomingShowsGrid rows={upcomingShows} />
        </section>
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Tidligere ({pastShows.length})
          </h2>
          <ShowsTable rows={pastShows} />
        </section>
      </div>
    </div>
  )
}

function UpcomingShowsGrid({ rows }: { rows: EnrichedShowRow[] }) {
  return (
    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 ">
      <Link
        href="/admin-app/shows/new"
        className="flex min-h-[30rem] max-h-60 flex-col items-center justify-center gap-6 rounded-lg border bg-muted/60 p-8 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="text-7xl font-light leading-none text-foreground">+</div>
        <div className="space-y-2">
          <p className="text-3xl font-semibold tracking-[0.18em] text-foreground">Nytt event</p>
          <p className="text-sm text-muted-foreground">Opprett show, legg til detaljer og gjør plakaten klar.</p>
        </div>
      </Link>

      {rows.map((show) => {
        const statusLabel = statusLabels[show.status]
        const location = show.venue_name ?? show.venue_address ?? 'Sted kommer'
        const formattedDate = new Date(show.date).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })
        const formattedPrice = show.ticket_price
          ? new Intl.NumberFormat('nb-NO', { style: 'currency', currency: show.currency, maximumFractionDigits: 0 }).format(show.ticket_price / 100)
          : 'Pris kommer'
        const seatsLabel = show.remainingTickets === null
          ? 'Fri kapasitet'
          : show.remainingTickets === 0
            ? 'Utsolgt'
            : show.fillPercent >= 80
              ? 'Få plasser igjen'
              : 'Billetter tilgjengelig'
        const soldLabel = show.capacity == null
          ? `${show.soldTickets} solgt`
          : `${show.soldTickets}/${show.capacity} solgt`
        const isPublishedCard = show.status === 'published' || show.status === 'completed'
        const bookingPercent = show.totalSlots > 0 ? Math.round((show.totalFilled / show.totalSlots) * 100) : 0
        const remainingBookingSlots = Math.max(show.totalSlots - show.totalFilled, 0)
        const bookingSummary = show.totalSlots === 0
          ? 'Ingen spots satt opp'
          : remainingBookingSlots === 0
            ? 'Alle spots er fylt'
            : remainingBookingSlots === 1
              ? '1 spot gjenstar'
              : `${remainingBookingSlots} spots gjenstar`

        return (
          <article key={show.id} className="overflow-hidden rounded-lg border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <Link href={`/admin-app/shows/${show.id}`} className="block">
              <div className="relative aspect-[3/4] max-h-80 w-full mx-auto border-b bg-muted">
                {show.poster_url ? (
                  <Image
                    src={show.poster_url}
                    alt={show.title}
                    fill
                    sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                    className="object-contain bg-zinc-950"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/60 text-center text-muted-foreground">
                    <div className="text-5xl font-light leading-none">+</div>
                    <div className="space-y-1 px-6">
                      <p className="text-sm font-semibold uppercase tracking-[0.2em]">Ingen poster</p>
                      <p className="text-xs">Placeholder til plakat er klar.</p>
                    </div>
                  </div>
                )}
                <div className="absolute left-3 top-3 rounded-md border bg-background px-3 py-2 text-center shadow-sm">
                  <div className="text-2xl font-black leading-none tracking-tight">{new Date(show.date).getDate()}.</div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {new Date(show.date).toLocaleDateString('nb-NO', { month: 'short' })}
                  </div>
                </div>
              </div>
            </Link>

            <div className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/admin-app/shows/${show.id}`} className="line-clamp-2 text-lg font-semibold tracking-tight hover:underline">
                    {show.title}
                  </Link>
                  <p className="mt-1 text-xs text-muted-foreground">{formattedDate}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusColors[show.status]}`}>
                  {statusLabel}
                </span>
              </div>

              {isPublishedCard ? (
                <div className="space-y-3 text-xs text-muted-foreground">
                  <div className="space-y-1.5">
                    <p className="truncate text-sm">{location}</p>
                    <div className="flex items-center justify-between gap-2">
                      <span>{formattedPrice}</span>
                      <span>{show.remainingTickets === null ? 'Kapasitet åpen' : `${show.remainingTickets} igjen`}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-medium text-foreground">{seatsLabel}</span>
                      <span>{soldLabel}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${show.fillPercent}%` }} />
                    </div>
                  </div>

                  <div className="space-y-1.5 border-t pt-3">
                    <div className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      <span>Lineup</span>
                      <span>{show.lineup.length}</span>
                    </div>
                    {show.lineup.length > 0 ? (
                      <ul className="space-y-1 text-[11px] leading-4">
                        {show.lineup.slice(0, 4).map((item, index) => (
                          <li key={`${show.id}-${item.roleName}-${item.artistName}-${index}`} className="flex items-start justify-between gap-2">
                            <span className="font-medium text-foreground">{item.lineupPosition}. {item.roleName}</span>
                            <span className="truncate text-right">{item.artistName}</span>
                          </li>
                        ))}
                        {show.lineup.length > 4 && (
                          <li className="text-right text-muted-foreground">+ {show.lineup.length - 4} til</li>
                        )}
                      </ul>
                    ) : (
                      <p className="text-[11px]">Lineup kommer.</p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-2">
                    <span className="uppercase tracking-[0.16em] text-muted-foreground">Bookingstatus</span>
                    <span className="font-medium text-foreground">{show.totalFilled}/{show.totalSlots || 0} booket</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-amber-500"
                      style={{ width: `${bookingPercent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium text-foreground">{bookingSummary}</span>
                    <span>{bookingPercent}% fylt</span>
                  </div>
                  {show.slotSummary.length > 0 ? (
                    <ul className="space-y-1.5 border-t pt-2.5 text-[11px] leading-4">
                      {show.slotSummary.map((item, index) => {
                        const openSlots = Math.max(item.quantity - item.filled, 0)
                        const roleLabel = canonicalRoleLabel(item.roleName) ?? item.roleName
                        const bookedNames = item.artistNames.slice(0, item.filled)
                        const namesLabel = bookedNames.length > 0 ? bookedNames.join(', ') : 'Ingen booket'

                        return (
                          <li key={`${show.id}-${item.roleName}-${index}`} className="flex items-center justify-between gap-2 rounded-md p-0">
                            <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                              <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">{item.lineupPosition}.</span>
                              <div className={cn(item.filled !== item.quantity ? statusColors.booking : statusColors.completed, 'shrink-0 rounded-md border px-2 py-0.5')}>
                                <span className="font-medium text-foreground">{roleLabel}</span>
                              </div>
                              <span className="truncate text-foreground/85">{namesLabel}</span>
                            </div>
                            <div className="shrink-0 text-right text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                              {openSlots > 0 ? `${openSlots} ledig` : 'Fylt'}
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="border-t pt-2.5 text-[11px]">Ingen spots satt opp ennå.</p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between gap-3 border-t pt-3">
                <Link href={`/admin-app/shows/${show.id}`} className="text-xs font-medium text-muted-foreground hover:text-foreground">
                  Åpne show
                </Link>
                <DeleteButton
                  action={deleteShowAction}
                  id={show.id}
                  idField="show_id"
                  confirmMessage={`Slett showen "${show.title}"? Dette kan ikke angres.`}
                />
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function ShowsTable({ rows }: { rows: ShowRow[] }) {
  return (
    <div className="rounded-lg border overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
            <th className="text-left px-4 py-2.5 font-medium">Tittel</th>
            <th className="text-left px-4 py-2.5 font-medium">Dato</th>
            <th className="text-left px-4 py-2.5 font-medium">Sted</th>
            <th className="text-left px-4 py-2.5 font-medium">Status</th>
            <th className="text-center px-4 py-2.5 font-medium">Kapasitet</th>
            <th className="text-left px-4 py-2.5 font-medium">Pris</th>
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
                {new Date(show.date).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{show.venue_name ?? show.venue_address ?? '—'}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[show.status]}`}>
                  {show.status}
                </span>
              </td>
              <td className="px-4 py-3 text-center">{show.capacity ?? '—'}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {show.ticket_price
                  ? new Intl.NumberFormat('nb-NO', { style: 'currency', currency: show.currency, maximumFractionDigits: 0 }).format(show.ticket_price / 100)
                  : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                <DeleteButton
                  action={deleteShowAction}
                  id={show.id}
                  idField="show_id"
                  confirmMessage={`Slett showen "${show.title}"? Dette kan ikke angres.`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <p className="text-center py-8 text-muted-foreground text-sm">Ingen show.</p>
      )}
    </div>
  )
}
