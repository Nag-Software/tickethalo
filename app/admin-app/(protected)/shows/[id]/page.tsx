import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { ToastActionForm } from '@/components/toast-action-form'
import { DeleteButton } from '@/components/admin/delete-button'
import {
  deleteMarketingDesignAction,
  deleteShowAction,
  generatePosterAction,
  selectMarketingDesignAction,
  updateShowDetailsAction,
  uploadMarketingDesignAction,
} from '../actions'
import { RequirementsTab } from './requirements-tab'
import { LineupTab } from './lineup-tab'
import { MarketingTemplateUploadButton } from './marketing-template-upload-button'
import { PosterGenerateButton } from './poster-generate-button'
import { artistMatchesRole } from '@/lib/artist-roles'
import { assertShowAccess } from '@/lib/club-auth'
import type { RequirementCompensationType, RequirementEnergy, RequirementGender, ShowMarketingDesign } from '@/types/database'

type ShowTab = 'overview' | 'lineup' | 'marketing' | 'tickets'

function formatFileSize(bytes: number | null) {
  if (!bytes) return null
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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
  const shouldLoadMarketingTasks = tab === 'marketing'
  const shouldLoadMarketingDesigns = tab === 'marketing'
  const shouldLoadRelatedArtists = tab === 'lineup' || tab === 'marketing'
  const shouldLoadSelectableArtists = tab === 'lineup'

  const [
    { data: show },
    { data: requirements },
    { data: offers },
    { data: lineup },
    { data: tickets },
    { data: marketingTasks },
    { data: marketingDesigns },
  ] = await Promise.all([
    db.from('shows').select('*').eq('id', id).single(),
    db.from('show_requirements').select('*').eq('show_id', id).order('lineup_position').order('created_at'),
    db.from('booking_offers').select('*').eq('show_id', id).order('created_at', { ascending: false }),
    db.from('confirmed_spots').select('*').eq('show_id', id),
    shouldLoadTickets
      ? db.from('tickets').select('id, ticket_code, status, customer_id').eq('show_id', id).limit(500)
      : Promise.resolve({ data: [] as Array<{ id: string; ticket_code: string; status: string; customer_id: string | null }> }),
    shouldLoadMarketingTasks
      ? db.from('marketing_tasks').select('*').eq('show_id', id).order('created_at')
      : Promise.resolve({ data: [] as Array<{ id: string; show_id: string; task_key: string; label: string | null; is_completed: boolean; created_at: string }> }),
    shouldLoadMarketingDesigns
      ? db.from('show_marketing_designs').select('*').eq('show_id', id).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as ShowMarketingDesign[] }),
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
  const totalSlots = reqFillStatus.reduce((s, r) => s + r.quantity, 0)
  const totalFilled = reqFillStatus.reduce((s, r) => s + Math.min(r.filled, r.quantity), 0)
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
    { key: 'overview', label: 'Oversikt' },
    { key: 'lineup', label: 'Lineup', badge: (offerStats.sent || activeLineup.length) ? Math.max(offerStats.sent, activeLineup.length) : undefined },
    { key: 'marketing', label: 'Markedsføring' },
    { key: 'tickets', label: 'Billetter' },
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
    draft: 'Planlegger', booking: 'Booker', fullbooked: 'Lineup klar',
    published: 'Publisert', completed: 'Gjennomført', cancelled: 'Kansellert',
  }

  const showLocation = show.venue_address ?? show.venue_name
  const selectedMarketingDesign = (marketingDesigns ?? []).find((design) => design.id === show.selected_marketing_design_id) ?? (marketingDesigns ?? [])[0] ?? null

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
              ← Tilbake
            </Link>
            <DeleteButton
              action={deleteShowAction}
              id={show.id}
              idField="show_id"
              confirmMessage={`Slett showen "${show.title}"? Dette kan ikke angres.`}
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
          <div className="space-y-6">
            {totalSlots > 0 && (
              <div className="rounded-xl border bg-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-sm">fremgang</h2>
                  <span className="text-sm font-bold tabular-nums">{totalFilled}/{totalSlots} plasser fylt</span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.round((totalFilled / totalSlots) * 100)}%` }} />
                </div>
                <div className="grid gap-2">
                  {reqFillStatus.map((r) => (
                    <div key={r.id} className="flex items-center gap-3">
                      <span className="text-sm font-medium w-32 truncate">{r.role_name}</span>
                      <div className="flex gap-1">
                        {Array.from({ length: r.quantity }).map((_, i) => (
                          <div key={i} className={`size-5 rounded-sm border-2 flex items-center justify-center text-[10px] font-bold transition-colors ${
                            i < r.filled ? 'bg-emerald-500 border-emerald-500 text-white'
                              : i < r.filled + r.pendingOffers ? 'bg-amber-100 border-amber-400 text-amber-700'
                              : 'bg-muted border-muted-foreground/20'
                          }`}>
                            {i < r.filled ? '✓' : i < r.filled + r.pendingOffers ? '?' : ''}
                          </div>
                        ))}
                      </div>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ml-auto ${r.isFull ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.isFull ? 'Fylt' : `${r.filled}/${r.quantity}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="rounded-xl border bg-card p-5 space-y-2">
                <h2 className="font-semibold text-sm">Info</h2>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Dato</dt><dd className="font-medium">{show.date}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Tid</dt><dd className="font-medium">{show.start_time ?? '—'}{show.end_time ? `–${show.end_time}` : ''}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Sted</dt><dd className="font-medium">{showLocation ?? '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Kapasitet</dt><dd className="font-medium">{show.capacity ?? '—'}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Pris</dt><dd className="font-medium">{show.ticket_price ? `${show.ticket_price / 100} ${show.currency}` : '—'}</dd></div>
                </dl>
              </div>

              <div className="rounded-xl border bg-card p-5 space-y-3">
                <h2 className="font-semibold text-sm">Automatikk</h2>
                <div className="space-y-2">
                  {show.status === 'draft' && (requirements ?? []).length === 0 && (
                    <Link href={`/admin-app/shows/${id}?tab=lineup`} className="block w-full text-center text-sm px-3 py-2 rounded-md border border-dashed text-muted-foreground hover:text-foreground transition-colors">
                      + Legg til krav først
                    </Link>
                  )}
                  {['draft', 'booking'].includes(show.status) && (requirements ?? []).length > 0 && !allSlotsFilled && (
                    <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                      Tilbud sendes automatisk når krav lagres og når nye artister godkjennes. Plasser fylles først når artister godkjenner tilbudet.
                      {' '}Du kan når som helst{' '}
                      <Link href={`/admin-app/shows/${id}?tab=lineup`} className="font-medium underline underline-offset-2">
                        publisere lineupen manuelt
                      </Link>
                      {' '}selv om ikke alle plasser er fylt.
                    </div>
                  )}
                  {allSlotsFilled && show.status !== 'published' && (
                    <div className="rounded-md bg-purple-50 dark:bg-purple-950/20 border border-purple-300/50 px-3 py-2 text-xs text-purple-700 dark:text-purple-400">
                      Lineup er fylt. Systemet genererer plakat og publiserer automatisk.
                    </div>
                  )}
                  {show.status === 'published' && (
                    <Link href={`/events/${show.slug}`} target="_blank" className="block w-full text-center text-sm px-3 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors font-medium">
                      🔗 Vis eventside
                    </Link>
                  )}
                </div>
              </div>
            </div>

            <ToastActionForm action={updateShowDetailsAction} className="rounded-xl border bg-card p-5 space-y-4">
              <input type="hidden" name="show_id" value={show.id} />
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold text-sm">Rediger show</h2>
                <button type="submit" className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
                  Lagre endringer
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">Tittel</span>
                  <input name="title" required defaultValue={show.title} className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">Slug</span>
                  <input name="slug" required defaultValue={show.slug} className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Dato</span>
                  <input name="date" type="date" required defaultValue={show.date} className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Start</span>
                  <input name="start_time" type="time" defaultValue={(show.start_time ?? '').slice(0, 5)} className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Slutt</span>
                  <input name="end_time" type="time" defaultValue={(show.end_time ?? '').slice(0, 5)} className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Kapasitet</span>
                  <input name="capacity" type="number" min={0} defaultValue={show.capacity ?? ''} className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <label className="space-y-1 md:col-span-4">
                  <span className="text-xs font-medium text-muted-foreground">Sted / adresse</span>
                  <input name="venue_address" defaultValue={show.venue_address ?? ''} className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-xs font-medium text-muted-foreground">Pris ({show.currency})</span>
                  <input name="ticket_price" type="number" min={0} step="0.01" defaultValue={show.ticket_price ? show.ticket_price / 100 : ''} className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
                  <span className="block text-[11px] text-muted-foreground">
                    Valuta styres av klubben og endres under{' '}
                    <Link href="/admin-app/min-klubb" className="underline underline-offset-2">Min klubb</Link>.
                  </span>
                </label>
              </div>
              <label className="space-y-1 block">
                <span className="text-xs font-medium text-muted-foreground">Beskrivelse</span>
                <textarea name="description" defaultValue={show.description ?? ''} rows={4} className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
              </label>
            </ToastActionForm>

            {show.poster_url && (
              <div className="rounded-xl border bg-card p-5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-sm">Plakat</h2>
                  <PosterGenerateButton showId={show.id} posterUrl={show.poster_url} action={generatePosterAction}>
                    Regenerer
                  </PosterGenerateButton>
                </div>
                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg border bg-muted/20">
                  <Image src={show.poster_url} alt={`Plakat for ${show.title}`} fill sizes="(max-width: 768px) 92vw, 50vw" className="object-contain" />
                </div>
              </div>
            )}
          </div>
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
        {tab === 'marketing' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px] gap-7 items-start">
              <div className="rounded-xl border bg-card p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-semibold text-sm">Lineup-plakat</h2>
                    {selectedMarketingDesign && (
                      <p className="mt-0.5 text-xs text-muted-foreground">Bruker {selectedMarketingDesign.label || selectedMarketingDesign.file_name}</p>
                    )}
                  </div>
                  <PosterGenerateButton showId={show.id} posterUrl={show.poster_url} action={generatePosterAction}>
                    {show.poster_url ? 'Regenerer' : 'Generer'}
                  </PosterGenerateButton>
                </div>
                {show.poster_url ? (
                  <div className="space-y-2">
                    <div className="relative mx-auto aspect-[2/3] w-full max-w-[520px] overflow-hidden rounded-lg border bg-muted/20">
                      <Image src={show.poster_url} alt={`Plakat for ${show.title}`} fill sizes="(max-width: 768px) 92vw, 520px" className="object-contain" />
                    </div>
                    <a href={show.poster_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline block">
                      Åpne i ny fane
                    </a>
                  </div>
                ) : (
                  <div className="mx-auto flex aspect-[2/3] w-full max-w-[520px] items-center justify-center rounded-lg border border-dashed bg-muted/30 text-sm text-muted-foreground">
                    {show.status === 'draft' ? 'Plakat genereres når lineup er bekreftet.' : 'Ingen plakat generert ennå.'}
                  </div>
                )}
              </div>

              <div className="rounded-xl border bg-card p-5 min-h-[640px] flex flex-col gap-4">
                <div className="space-y-1">
                  <h2 className="font-semibold text-sm">Plakat templates</h2>
                  <p className="text-xs text-muted-foreground">Design AI-en skal jobbe ut fra.</p>
                </div>

                <div className="flex-1 space-y-3">
                  {(marketingDesigns ?? []).length > 0 ? (
                    (marketingDesigns ?? []).map((design) => {
                      const isSelected = design.id === selectedMarketingDesign?.id
                      const fileSize = formatFileSize(design.file_size)

                      return (
                        <div key={design.id} className={`rounded-lg border p-2 transition-colors ${isSelected ? 'border-primary bg-primary/5' : 'bg-background hover:bg-muted/30'}`}>
                          <ToastActionForm action={selectMarketingDesignAction} successMessage="Template valgt.">
                            <input type="hidden" name="show_id" value={show.id} />
                            <input type="hidden" name="design_id" value={design.id} />
                            <button type="submit" className="block w-full text-left">
                              <div className="flex items-center justify-between gap-2 pb-2">
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-semibold">{design.label || design.file_name}</p>
                                  <p className="text-[11px] text-muted-foreground uppercase">{design.file_type}{fileSize ? ` · ${fileSize}` : ''}</p>
                                </div>
                                {isSelected && (
                                  <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">Valgt</span>
                                )}
                              </div>
                              <div className="relative aspect-[3/4] overflow-hidden rounded-md border bg-muted/20">
                                <Image src={design.file_url} alt={design.label || design.file_name} fill sizes="260px" className="object-contain" />
                              </div>
                            </button>
                          </ToastActionForm>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <a href={design.file_url} target="_blank" rel="noreferrer" className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                              Åpne fil
                            </a>
                            <ToastActionForm action={deleteMarketingDesignAction} successMessage="Template slettet.">
                              <input type="hidden" name="show_id" value={show.id} />
                              <input type="hidden" name="design_id" value={design.id} />
                              <button type="submit" className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
                                Slett
                              </button>
                            </ToastActionForm>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div className="flex aspect-[3/4] items-center justify-center rounded-lg border border-dashed bg-muted/20 px-4 text-center text-sm text-muted-foreground">
                      Ingen templates lagt til.
                    </div>
                  )}
                </div>

                <MarketingTemplateUploadButton showId={show.id} action={uploadMarketingDesignAction} />
              </div>
            </div>

            {(marketingTasks ?? []).length > 0 && (
              <div className="rounded-xl border bg-card divide-y">
                <div className="px-4 py-2.5 font-semibold text-sm border-b bg-muted/20">Sjekkliste</div>
                {(marketingTasks ?? []).map((task) => (
                  <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                    <div className={`size-5 rounded border-2 shrink-0 flex items-center justify-center text-[10px] ${task.is_completed ? 'bg-primary border-primary text-primary-foreground' : 'border-input'}`}>
                      {task.is_completed && '✓'}
                    </div>
                    <span className={`text-sm ${task.is_completed ? 'line-through text-muted-foreground' : ''}`}>{task.label ?? task.task_key}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border bg-card p-5 space-y-2">
                <h2 className="font-semibold text-sm">Facebook-tekst</h2>
                <pre className="text-xs bg-muted rounded-lg p-3 whitespace-pre-wrap font-sans select-all leading-relaxed">{[
                  `🎭 ${show.title}`,
                  ``,
                  `📅 ${show.date}${show.start_time ? ` kl. ${show.start_time}` : ''}`,
                  `📍 ${showLocation ?? 'Sted TBA'}`,
                  ``,
                  activeLineup.length > 0 ? `Lineup:\n${activeLineup.map(s => `• ${artistMap[s.artist_id]?.full_name ?? '?'}`).join('\n')}` : null,
                  ``,
                  `🎟️ Billetter: ${process.env.APP_URL ?? 'https://tickethalo.com'}/events/${show.slug}`,
                ].filter(Boolean).join('\n')}</pre>
              </div>

              <div className="rounded-xl border bg-card p-5 space-y-2">
                <h2 className="font-semibold text-sm">E-posttekst</h2>
                <pre className="text-xs bg-muted rounded-lg p-3 whitespace-pre-wrap font-sans select-all leading-relaxed">{[
                  `Emne: ${show.title} – ${show.date}`,
                  ``,
                  `Hei!`,
                  ``,
                  `Vi inviterer til ${show.title}${showLocation ? ` på ${showLocation}` : ''}, ${show.date}${show.start_time ? ` kl. ${show.start_time}` : ''}.`,
                  ``,
                  activeLineup.length > 0 ? `Lineup:\n${activeLineup.map(s => `• ${artistMap[s.artist_id]?.full_name ?? '?'}`).join('\n')}\n` : null,
                  `Kjøp billetter her:`,
                  `${process.env.APP_URL ?? 'https://tickethalo.com'}/events/${show.slug}`,
                ].filter(Boolean).join('\n')}</pre>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════ TICKETS ══════════════════ */}
        {tab === 'tickets' && (
          <>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-semibold text-muted-foreground">
              {tickets?.length ?? 0} billetter
            </p>
            <Link
              href={`/admin-app/scanner/${id}`}
              target="_blank"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              📷 Åpne scanner
            </Link>
          </div>
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2.5 font-medium">Ticket code</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(tickets ?? []).map((t) => (
                  <tr key={t.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-mono text-xs">{t.ticket_code}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status] ?? ''}`}>{t.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!tickets?.length && (
              <p className="text-center py-12 text-muted-foreground text-sm">Ingen billetter solgt ennå.</p>
            )}
          </div>
          </>
        )}
      </div>
    </div>
  )
}
