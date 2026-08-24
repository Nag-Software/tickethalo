import Link from 'next/link'
import { Search } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DeleteButton } from '@/components/admin/delete-button'
import { deleteArtistAction } from './[id]/actions'
import { artistReadinessBlockers, READINESS_BLOCKER_LABELS } from '@/lib/artist-readiness'
import { formatArtistRoleList } from '@/lib/artist-roles'
import type { ArtistStatus, EnergyLevel } from '@/types/database'

const statusColors: Record<ArtistStatus, string> = {
  pending_review: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  inactive: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  flagged: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
}

const ARTIST_STATUS_LABELS: Record<ArtistStatus, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  inactive: 'Inactive',
  flagged: 'Flagged',
}

const ENERGY_LABELS: Record<EnergyLevel, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  uncertain: 'Unknown',
}

const energyColors: Record<EnergyLevel, string> = {
  high: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-400',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  low: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
  uncertain: 'bg-zinc-100 text-zinc-500',
}

type ArtistsTab = 'review' | 'ready' | 'all'

export default async function ArtistsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; energy?: string; ai?: string; q?: string; tab?: string }>
}) {
  const params = await searchParams
  const searchQuery = params.q?.trim() ?? ''
  const tab: ArtistsTab = params.tab === 'ready' || params.tab === 'all' ? params.tab : 'review'
  const db = createAdminClient()

  let query = db
    .from('artists')
    .select('id, full_name, stage_name, email, status, admin_score, admin_energy_level, is_flagged, created_at, category')
    .order('created_at', { ascending: false })
    .limit(200)

  if (params.status) query = query.eq('status', params.status as ArtistStatus)
  if (params.energy) query = query.eq('admin_energy_level', params.energy as EnergyLevel)
  if (searchQuery) {
    const sanitizedSearch = searchQuery.replace(/[%,]/g, ' ').trim()
    if (sanitizedSearch) {
      query = query.or(`full_name.ilike.%${sanitizedSearch}%,stage_name.ilike.%${sanitizedSearch}%,email.ilike.%${sanitizedSearch}%`)
    }
  }

  const { data: artists } = await query

  // The blockers depend on several columns, so the split happens in JS after
  // fetching. The counts come from the same set as the filters above, so they
  // match what is actually shown.
  const withBlockers = (artists ?? []).map((artist) => ({
    artist,
    blockers: artistReadinessBlockers(artist),
  }))
  const needsReview = withBlockers.filter((row) => row.blockers.length > 0)
  const ready = withBlockers.filter((row) => row.blockers.length === 0)
  const visible = tab === 'ready' ? ready : tab === 'all' ? withBlockers : needsReview

  const tabs: { value: ArtistsTab; label: string; count: number }[] = [
    { value: 'all', label: 'All', count: withBlockers.length },
    { value: 'ready', label: 'Ready', count: ready.length },
    { value: 'review', label: 'Review needed', count: needsReview.length },
  ]

  const filters: { label: string; key: string; value: string }[] = [
    { label: 'All', key: 'status', value: '' },
    { label: 'Pending', key: 'status', value: 'pending_review' },
    { label: 'Approved', key: 'status', value: 'approved' },
    { label: 'Rejected', key: 'status', value: 'rejected' },
    { label: 'Flagged', key: 'status', value: 'flagged' },
  ]

  return (
    <div>
      <AdminHeader
        title="Comedians"
        description={
          needsReview.length > 0
            ? `${withBlockers.length} comedians · ${needsReview.length} need review`
            : `${withBlockers.length} comedians · all ready for booking`
        }
        actions={
          <div className="flex items-center gap-3">
            <Link
              href={buildArtistsHref({}, { tab })}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset filters
            </Link>
          </div>
        }
      />
      <div className="p-6 space-y-4">
        {/* Tab order: the queue that needs an admin comes first, because a comedian
            without role/score/approval never shows up in booking. */}
        <div className="flex gap-1 border-b">
          {tabs.map((t) => {
            const active = tab === t.value
            return (
              <Link
                key={t.value}
                href={buildArtistsHref(params, { tab: t.value })}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
                }`}
              >
                {t.label}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                    t.value === 'review' && t.count > 0
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {t.count}
                </span>
              </Link>
            )
          })}
        </div>

        <form action="/admin-app/artists" className="flex max-w-xl gap-2">
          {tab !== 'review' && <input type="hidden" name="tab" value={tab} />}
          {params.status && <input type="hidden" name="status" value={params.status} />}
          {params.energy && <input type="hidden" name="energy" value={params.energy} />}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              defaultValue={searchQuery}
              placeholder="Search by name, stage name or email"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline">
            <Search className="size-4" /> Search
          </Button>
        </form>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          {filters.map((f) => {
            const active = (params.status ?? '') === f.value
            return (
              <Link
                key={f.value}
                href={buildArtistsHref(params, { status: f.value })}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
                }`}
              >
                {f.label}
              </Link>
            )
          })}
        </div>

        {/* Table */}
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                <th className="text-left px-4 py-2.5 font-medium">Comedian</th>
                <th className="text-left px-4 py-2.5 font-medium">Bookable</th>
                <th className="text-left px-4 py-2.5 font-medium">Role</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-center px-4 py-2.5 font-medium">Score</th>
                <th className="text-left px-4 py-2.5 font-medium">Energy</th>
                <th className="text-left px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visible.map(({ artist: a, blockers }) => {
                const roles = formatArtistRoleList(a.category)
                return (
                  <tr key={a.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/admin-app/artists/${a.id}`} className="flex flex-col hover:underline">
                        <span className="font-medium">{a.full_name}</span>
                        <span className="text-xs text-muted-foreground">{a.email}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {blockers.length === 0 ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                          Bookable
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {blockers.map((blocker) => (
                            <span
                              key={blocker}
                              className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
                            >
                              {READINESS_BLOCKER_LABELS[blocker]}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {roles.length > 0 ? roles.join(', ') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[a.status]}`}>
                        {ARTIST_STATUS_LABELS[a.status] ?? a.status}
                      </span>
                      {a.is_flagged && (
                        <span className="ml-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400">
                          flagged
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-bold">{a.admin_score ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {a.admin_energy_level ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${energyColors[a.admin_energy_level]}`}>
                          {ENERGY_LABELS[a.admin_energy_level] ?? a.admin_energy_level}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(a.created_at).toLocaleDateString('en-GB')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DeleteButton
                        action={deleteArtistAction}
                        id={a.id}
                        idField="artist_id"
                        confirmMessage={`Delete the artist "${a.full_name}"? This cannot be undone.`}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {visible.length === 0 && (
            <p className="text-center py-12 text-muted-foreground text-sm">
              {tab === 'review'
                ? 'No comedians are waiting for review.'
                : tab === 'ready'
                  ? 'No comedians are ready for booking yet.'
                  : 'No comedians found.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function buildArtistsHref(
  params: { status?: string; energy?: string; ai?: string; q?: string; tab?: string },
  overrides: { status?: string; energy?: string; ai?: string; q?: string; tab?: string }
) {
  const urlParams = new URLSearchParams()
  const nextParams = { ...params, ...overrides }

  for (const [key, value] of Object.entries(nextParams)) {
    if (value?.trim()) urlParams.set(key, value.trim())
  }

  const queryString = urlParams.toString()
  return queryString ? `/admin-app/artists?${queryString}` : '/admin-app/artists'
}
