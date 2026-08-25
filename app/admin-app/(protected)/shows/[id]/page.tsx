import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatTicketCode } from '@/lib/tickets'
import { AdminHeader } from '@/components/admin/admin-header'
import { DeleteButton } from '@/components/admin/delete-button'
import { deleteShowAction, updateShowDetailsAction } from '../actions'
import { buildBookingSpots } from '@/lib/booking-spots'
import { OverviewTab } from './overview-tab'
import { RequirementsTab } from './requirements-tab'
import { LineupTab } from './lineup-tab'
import { MarketingTab } from './marketing/marketing-tab'
import { artistMatchesRole } from '@/lib/artist-roles'
import { assertShowAccess } from '@/lib/club-auth'
import type { RequirementCompensationType, RequirementEnergy, RequirementGender } from '@/types/database'

type ShowTab = 'overview' | 'lineup' | 'marketing' | 'tickets'

export default async function ShowDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: ShowTab }>
}) {
  const { id } = await params
  const { tab = 'overview' } = await searchParams
  await assertShowAccess(id)
  const db = createAdminClient()
  const shouldLoadTickets = tab === 'tickets'
  const shouldLoadRelatedArtists = tab === 'overview' || tab === 'lineup'
  // The overview's booking card offers and adds artists straight from a row.
  const shouldLoadSelectableArtists = tab === 'lineup' || tab === 'overview'

  const [
    { data: show },
    { data: requirements },
    { data: offers },
    { data: lineup },
    { data: tickets },
    { count: soldTicketCount },
  ] = await Promise.all([
    db.from('shows').select('*').eq('id', id).single(),
    db.from('show_requirements').select('*').eq('show_id', id).order('lineup_position').order('created_at'),
    db.from('booking_offers').select('*').eq('show_id', id).order('created_at', { ascending: false }),
    db.from('confirmed_spots').select('*').eq('show_id', id),
    shouldLoadTickets
      ? db.from('tickets').select('id, ticket_code, status, customer_id, holder_name').eq('show_id', id).limit(500)
      : Promise.resolve({ data: [] as Array<{ id: string; ticket_code: string; status: string; customer_id: string | null; holder_name: string | null }> }),
    // The overview card shows ticket sales, but never the rows — a count is enough.
    tab === 'overview'
      ? db.from('tickets').select('id', { count: 'exact', head: true }).eq('show_id', id).in('status', ['valid', 'used'])
      : Promise.resolve({ count: 0 }),
  ])

  if (!show) notFound()

  // Fetch related artist/requirement data (split queries — no Relationships in DB types)
  const offerArtistIds = [...new Set((offers ?? []).map(o => o.artist_id))]
  const lineupArtistIds = [...new Set((lineup ?? []).map(s => s.artist_id))]
  const allArtistIds = [...new Set([...offerArtistIds, ...lineupArtistIds])]

  const [{ data: artistRows }, { data: selectableArtists }, { data: bookingExclusions }] = await Promise.all([
    shouldLoadRelatedArtists && allArtistIds.length
      ? db.from('artists').select('id, full_name, stage_name, email, profile_image_url, admin_score, admin_energy_level').in('id', allArtistIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string; stage_name: string | null; email: string; profile_image_url: string | null; admin_score: number | null; admin_energy_level: string | null }> }),
    shouldLoadSelectableArtists
      ? db.from('artists')
        .select('id, full_name, stage_name, email, admin_score, admin_energy_level, gender, category')
        .eq('status', 'approved')
        .eq('is_flagged', false)
        .order('full_name')
        .limit(250)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string; stage_name: string | null; email: string; admin_score: number | null; admin_energy_level: string | null; gender: string | null; category: string[] | null }> }),
    shouldLoadSelectableArtists
      ? db.from('show_artist_booking_exclusions').select('artist_id').eq('show_id', id)
      : Promise.resolve({ data: [] as Array<{ artist_id: string }> }),
  ])
  const artistMap = Object.fromEntries((artistRows ?? []).map(a => [a.id, a]))

  // Compute fill status per requirement
  const activeLineup = (lineup ?? []).filter(s => ['confirmed', 'completed', 'paid'].includes(s.status))
  const reqFillStatus = (requirements ?? []).map(r => {
    const filled = activeLineup.filter(s => s.show_requirement_id === r.id).length
    const pendingOffers = (offers ?? []).filter(o => o.show_requirement_id === r.id && o.status === 'sent').length
    return { ...r, filled, pendingOffers, isFull: filled >= r.quantity }
  })
  const allSlotsFilled = reqFillStatus.length > 0 && reqFillStatus.every(r => r.isFull)
  const activeArtistIds = new Set(activeLineup.map(spot => spot.artist_id))
  const activeOfferArtistIds = new Set((offers ?? []).filter(o => ['sent', 'accepted'].includes(o.status)).map(o => o.artist_id))
  const excludedArtistIds = new Set((bookingExclusions ?? []).map(row => row.artist_id))
  const unavailableArtistIds = new Set([...activeArtistIds, ...activeOfferArtistIds, ...excludedArtistIds])
  const bookingCandidates = (selectableArtists ?? []).filter(artist => !unavailableArtistIds.has(artist.id))
  const energyRelaxationSuggestions = Object.fromEntries(
    (requirements ?? []).flatMap((requirement) => {
      const status = reqFillStatus.find((row) => row.id === requirement.id)
      if (!status || status.isFull || status.pendingOffers > 0 || requirement.energy_level === 'any') return []

      const minScore = Math.max(requirement.min_score ?? 6, 6)
      const baseMatches = bookingCandidates.filter((artist) => {
        if (!artistMatchesRole(requirement.role_name, artist)) return false
        if ((artist.admin_score ?? 0) < minScore) return false
        if (requirement.required_gender && requirement.required_gender !== 'any' && artist.gender !== requirement.required_gender) return false
        return true
      })
      const strictCount = baseMatches.filter((artist) => artist.admin_energy_level === requirement.energy_level).length
      const anyEnergyCount = baseMatches.length

      return strictCount === 0
        ? [[requirement.id, { candidates: anyEnergyCount }]]
        : []
    })
  )

  const offerStats = {
    total: (offers ?? []).length,
    sent: (offers ?? []).filter(o => o.status === 'sent').length,
    accepted: (offers ?? []).filter(o => o.status === 'accepted').length,
    declined: (offers ?? []).filter(o => o.status === 'declined').length,
  }

  const TABS: { key: ShowTab; label: string; badge?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'lineup', label: 'Lineup', badge: (offerStats.sent || activeLineup.length) ? Math.max(offerStats.sent, activeLineup.length) : undefined },
    { key: 'marketing', label: 'Marketing' },
    { key: 'tickets', label: 'Tickets' },
  ]

  const STATUS_COLORS: Record<string, string> = {
    sent: 'bg-amber-100 text-amber-700',
    accepted: 'bg-emerald-100 text-emerald-700',
    declined: 'bg-red-100 text-red-700',
    expired: 'bg-zinc-100 text-zinc-500',
    filled_by_other: 'bg-orange-100 text-orange-700',
    cancelled: 'bg-zinc-100 text-zinc-400',
    confirmed: 'bg-emerald-100 text-emerald-700',
    completed: 'bg-sky-100 text-sky-700',
    paid: 'bg-purple-100 text-purple-700',
    valid: 'bg-emerald-100 text-emerald-700',
    used: 'bg-zinc-100 text-zinc-500',
    refunded: 'bg-orange-100 text-orange-700',
  }

  const SHOW_STATUS_COLORS: Record<string, string> = {
    draft: 'bg-zinc-100 text-zinc-600',
    booking: 'bg-amber-100 text-amber-700',
    fullbooked: 'bg-purple-100 text-purple-700',
    published: 'bg-emerald-100 text-emerald-700',
    completed: 'bg-sky-100 text-sky-700',
    cancelled: 'bg-red-100 text-red-700',
  }

  const SHOW_STATUS_LABELS: Record<string, string> = {
    draft: 'Planning', booking: 'Booking', fullbooked: 'Lineup ready',
    published: 'Published', completed: 'Completed', cancelled: 'Cancelled',
  }

  const ticketsSold = soldTicketCount ?? 0
  const bookingSpots = tab === 'overview'
    ? buildBookingSpots({
      requirements: requirements ?? [],
      confirmedSpots: lineup ?? [],
      offers: offers ?? [],
      artistName: (artistId) => {
        const artist = artistMap[artistId]
        return artist ? artist.stage_name ?? artist.full_name : 'Unknown artist'
      },
      currency: show.currency,
    })
    : []

  const showLocation = show.venue_address ?? show.venue_name

  return (
    <div>
      <AdminHeader
        title={show.title}
        description={[show.date, showLocation].filter(Boolean).join(' · ')}
        actions={
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${SHOW_STATUS_COLORS[show.status]}`}>
              {SHOW_STATUS_LABELS[show.status] ?? show.status}
            </span>
            <Link href="/admin-app/shows" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              ← Back
            </Link>
            <DeleteButton
              action={deleteShowAction}
              id={show.id}
              idField="show_id"
              confirmMessage={`Delete the show "${show.title}"? This cannot be undone.`}
            />
          </div>
        }
      />

      {/* Tab nav */}
      <div className="flex gap-0 border-b px-6">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin-app/shows/${id}?tab=${t.key}`}
            className={`relative px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center size-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                {t.badge}
              </span>
            )}
          </Link>
        ))}
      </div>

      <div className="p-6">

        {/* ══════════════════ OVERVIEW ══════════════════ */}
        {tab === 'overview' && (
          <OverviewTab
            show={show}
            spots={bookingSpots}
            bookingCandidates={bookingCandidates.map((artist) => ({
              id: artist.id,
              full_name: artist.full_name,
              stage_name: artist.stage_name,
              admin_score: artist.admin_score,
              admin_energy_level: artist.admin_energy_level,
              category: artist.category,
            }))}
            ticketsSold={ticketsSold}
            hasRequirements={(requirements ?? []).length > 0}
            allSlotsFilled={allSlotsFilled}
            updateShowDetailsAction={updateShowDetailsAction}
          />
        )}

        {/* ══════════════════ LINEUP ══════════════════ */}
        {tab === 'lineup' && (
          show.status === 'draft'
            ? <RequirementsTab
                key={(requirements ?? []).map((r) => [
                  r.id,
                  r.lineup_position,
                  r.role_name,
                  r.min_score ?? '',
                  r.energy_level,
                  r.required_gender ?? 'any',
                  r.compensation_type ?? '',
                  r.compensation_amount ?? '',
                  r.compensation_percent ?? '',
                ].join(':')).join('|')}
                showId={show.id}
                showStatus={show.status}
                showCurrency={show.currency}
                requirements={(requirements ?? []).map((r) => ({
                  id: r.id,
                  lineup_position: r.lineup_position,
                  role_name: r.role_name,
                  min_score: r.min_score ?? null,
                  energy_level: r.energy_level as RequirementEnergy,
                  required_gender: (r.required_gender ?? 'any') as RequirementGender,
                  compensation_type: (r.compensation_type ?? null) as RequirementCompensationType | null,
                  compensation_amount: r.compensation_amount ?? null,
                  compensation_percent: r.compensation_percent ?? null,
                }))}
              />
            : <LineupTab
                showId={show.id}
                showStatus={show.status}
                showCurrency={show.currency}
                requirements={(requirements ?? []).map(r => ({
                  id: r.id,
                  role_name: r.role_name,
                  quantity: r.quantity,
                  lineup_position: r.lineup_position,
                  min_score: r.min_score ?? null,
                  energy_level: r.energy_level as RequirementEnergy,
                  required_gender: (r.required_gender ?? 'any') as RequirementGender,
                  compensation_type: (r.compensation_type ?? null) as RequirementCompensationType | null,
                  compensation_amount: r.compensation_amount ?? null,
                  compensation_percent: r.compensation_percent ?? null,
                }))}
                confirmedSpots={(lineup ?? []).map(s => ({
                  id: s.id,
                  artist_id: s.artist_id,
                  show_requirement_id: s.show_requirement_id,
                  status: s.status,
                  fee_amount: s.fee_amount ?? null,
                  currency: s.currency ?? null,
                }))}
                allOffers={(offers ?? []).map(o => ({
                  id: o.id,
                  artist_id: o.artist_id,
                  show_requirement_id: o.show_requirement_id ?? null,
                  status: o.status,
                  sent_at: o.sent_at ?? null,
                }))}
                artistMap={artistMap as Record<string, { id: string; full_name: string; stage_name: string | null; email: string; profile_image_url: string | null; admin_score: number | null; admin_energy_level: string | null }>}
                selectableArtists={(selectableArtists ?? []).filter(a => !activeArtistIds.has(a.id) && !excludedArtistIds.has(a.id))}
                energyRelaxationSuggestions={energyRelaxationSuggestions}
                allSlotsFilled={allSlotsFilled}
              />
        )}

        {/* ══════════════════ MARKETING ══════════════════ */}
        {tab === 'marketing' && <MarketingTab showId={id} />}

        {/* ══════════════════ TICKETS ══════════════════ */}
        {tab === 'tickets' && (
          <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-muted-foreground">
              {tickets?.length ?? 0} tickets
            </p>
            <Link
              href={`/admin-app/scanner/${id}`}
              target="_blank"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              📷 Open scanner
            </Link>
          </div>
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2.5 font-medium">Guest</th>
                  <th className="text-left px-4 py-2.5 font-medium">Ticket code</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(tickets ?? []).map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      {t.holder_name ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tracking-wider">{formatTicketCode(t.ticket_code)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] ?? ''}`}>{t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!tickets?.length && (
              <p className="text-center py-12 text-muted-foreground text-sm">No tickets sold yet.</p>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  )
}
