import Link from 'next/link'
import { ExternalLink, Mic, Search } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { EmptyState, formatDate } from '@/components/superadmin/ui'
import { getOsloToday } from '@/lib/event-filters'
import { cn } from '@/lib/utils'
import { ArtistStatusControl } from './artist-status-control'
import type { ArtistStatus } from '@/types/database'

export const metadata = { title: 'Komikere — Superadmin' }

const FILTERS = [
  { key: 'all', label: 'Alle', statuses: null },
  { key: 'active', label: 'Aktive', statuses: ['approved'] },
  { key: 'out', label: 'Tatt ut', statuses: ['inactive', 'rejected'] },
  { key: 'review', label: 'Til vurdering', statuses: ['pending_review', 'flagged'] },
] as const satisfies ReadonlyArray<{ key: string; label: string; statuses: readonly ArtistStatus[] | null }>

type FilterKey = (typeof FILTERS)[number]['key']

/**
 * Alle komikere på plattformen, og det ene stedet statusen deres settes.
 *
 * «Platform status» sto før på klubbens komikerprofil, synlig for alle og
 * brukbar bare for superadmin. Moderering rammer alle klubber samtidig, så den
 * hører hjemme her. Klubbens egen mening om en komiker — roller, energi,
 * flagg — ligger fortsatt hos klubben.
 */
export default async function SuperadminArtistsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>
}) {
  const params = await searchParams
  const query = (params.q ?? '').trim()
  const filter: FilterKey = FILTERS.some((item) => item.key === params.status) ? (params.status as FilterKey) : 'all'

  const db = createAdminClient()
  const today = getOsloToday()

  const [{ data: artists }, { data: clubLinks }, { data: upcomingShows }] = await Promise.all([
    db.from('artists')
      .select('id, full_name, stage_name, email, city, status, profile_image_url, created_at')
      .order('full_name'),
    db.from('club_artists').select('artist_id'),
    db.from('shows').select('id').is('deleted_at', null).gte('date', today).neq('status', 'cancelled'),
  ])

  const upcomingShowIds = (upcomingShows ?? []).map((show) => show.id)
  const { data: upcomingSpots } = upcomingShowIds.length > 0
    ? await db.from('confirmed_spots').select('artist_id').in('show_id', upcomingShowIds).eq('status', 'confirmed')
    : { data: [] as Array<{ artist_id: string }> }

  const count = (rows: Array<{ artist_id: string }> | null) => {
    const map = new Map<string, number>()
    for (const row of rows ?? []) map.set(row.artist_id, (map.get(row.artist_id) ?? 0) + 1)
    return map
  }
  const clubsByArtist = count(clubLinks)
  const bookingsByArtist = count(upcomingSpots)

  const all = artists ?? []
  const counts = Object.fromEntries(
    FILTERS.map((item) => [
      item.key,
      item.statuses ? all.filter((artist) => (item.statuses as readonly string[]).includes(artist.status)).length : all.length,
    ]),
  ) as Record<FilterKey, number>

  const statuses = FILTERS.find((item) => item.key === filter)?.statuses ?? null
  const needle = query.toLowerCase()
  const visible = all.filter((artist) => {
    if (statuses && !(statuses as readonly string[]).includes(artist.status)) return false
    if (!needle) return true
    return [artist.full_name, artist.stage_name, artist.email, artist.city]
      .some((value) => value?.toLowerCase().includes(needle))
  })

  const hrefFor = (key: FilterKey) => {
    const search = new URLSearchParams()
    if (key !== 'all') search.set('status', key)
    if (query) search.set('q', query)
    const suffix = search.toString()
    return `/superadmin/artists${suffix ? `?${suffix}` : ''}`
  }

  return (
    <div>
      <AdminHeader title="Komikere" description={`${all.length} registrert · ${counts.active} aktive`} />

      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap gap-1.5" aria-label="Filtrer på status">
            {FILTERS
              // «Til vurdering» er en gammel tilstand: vis den bare når noen faktisk står der.
              .filter((item) => item.key !== 'review' || counts.review > 0 || filter === 'review')
              .map((item) => (
                <Link
                  key={item.key}
                  href={hrefFor(item.key)}
                  aria-current={filter === item.key ? 'page' : undefined}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    filter === item.key
                      ? 'border-foreground bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {item.label}
                  <span className="ml-1.5 tabular-nums opacity-70">{counts[item.key]}</span>
                </Link>
              ))}
          </nav>

          <form method="get" className="relative w-full sm:w-72">
            {filter !== 'all' && <input type="hidden" name="status" value={filter} />}
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={query} placeholder="Søk på navn, e-post eller by" className="pl-9" />
          </form>
        </div>

        {visible.length === 0 ? (
          <EmptyState icon={Mic}>
            {all.length === 0 ? 'Ingen komikere har registrert seg ennå.' : 'Ingen komikere passer søket.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Komiker</th>
                  <th className="px-4 py-2.5 font-medium">By</th>
                  <th className="px-4 py-2.5 text-right font-medium">Klubber</th>
                  <th className="px-4 py-2.5 text-right font-medium">Kommende</th>
                  <th className="px-4 py-2.5 font-medium">Registrert</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {visible.map((artist) => {
                  const name = artist.stage_name?.trim() || artist.full_name
                  return (
                    <tr key={artist.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8">
                            {artist.profile_image_url && <AvatarImage src={artist.profile_image_url} alt="" />}
                            <AvatarFallback className="text-xs">{name.charAt(0).toUpperCase() || '?'}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{name}</p>
                            <p className="truncate text-xs text-muted-foreground">{artist.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{artist.city ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{clubsByArtist.get(artist.id) ?? 0}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{bookingsByArtist.get(artist.id) ?? 0}</td>
                      <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{formatDate(artist.created_at)}</td>
                      <td className="px-4 py-2">
                        <ArtistStatusControl
                          // Nøkkelen tar med statusen, så velgeren følger raden når listen hentes på nytt.
                          key={`${artist.id}:${artist.status}`}
                          artistId={artist.id}
                          artistName={name}
                          status={artist.status as ArtistStatus}
                          upcomingBookings={bookingsByArtist.get(artist.id) ?? 0}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/admin-app/artists/${artist.id}`}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Profil
                          <ExternalLink className="size-3" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
