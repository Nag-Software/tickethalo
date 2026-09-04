import Link from 'next/link'
import { ChevronLeft, ChevronRight, MapPin, Search, X } from 'lucide-react'
import { AdminHeader } from '@/components/admin/admin-header'
import { DiscoverFilters, type DiscoverSort } from '@/components/admin/discover-filters'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { formatArtistRoleList } from '@/lib/artist-roles'
import type { ArtistType } from '@/types/database'
import { ConnectArtistButton } from '@/components/admin/connect-artist-button'

/**
 * Komikerkatalogen — hele Tickethalo, ikke bare klubbens egne.
 *
 * Lista er ment å tåle flere hundre komikere, så filtrering, sortering og
 * sidevisning skjer i spørringen. Antall bookinger ligger i `artist_directory`
 * (migrasjon 035) nettopp for at «mest booket» skal være en `order by` og
 * ikke én telling per kort.
 *
 * Komikere klubben allerede har knyttet til seg faller ut: katalogen er stedet
 * man finner noen nye. De man har, står under «My comedians», og fjernes
 * derfra — ikke herfra.
 */

const PAGE_SIZE = 18

const SORTS: Record<DiscoverSort, { column: string; ascending: boolean }> = {
  bookings: { column: 'bookings', ascending: false },
  name: { column: 'full_name', ascending: true },
  newest: { column: 'created_at', ascending: false },
}

type DirectoryArtist = {
  id: string
  full_name: string
  stage_name: string | null
  profile_image_url: string | null
  city: string | null
  country: string | null
  category: ArtistType[] | null
  bookings: number
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string; sort?: string; page?: string; q?: string }>
}) {
  const params = await searchParams
  const city = params.city?.trim() ?? ''
  const searchQuery = params.q?.trim() ?? ''
  const sort: DiscoverSort = params.sort === 'name' || params.sort === 'newest' ? params.sort : 'bookings'
  const page = Math.max(1, Number(params.page ?? 1) || 1)

  const db = createAdminClient()
  const clubId = await getDefaultClubIdForAdmin()
  const order = SORTS[sort]

  // Må hentes før katalogspørringen: den bygger på hvem som skal utelates.
  const { data: connections } = await db
    .from('club_artists')
    .select('artist_id')
    .eq('club_id', clubId)

  const connectedIds = (connections ?? []).map((row) => row.artist_id)
  const excludeConnected = `(${connectedIds.join(',')})`

  let query = db
    .from('artist_directory')
    .select('id, full_name, stage_name, profile_image_url, city, country, category, bookings', { count: 'exact' })
    // Katalogen er komikere klubben kan jobbe med, ikke søknadsbunken.
    .eq('status', 'approved')
    .order(order.column, { ascending: order.ascending })
    .order('full_name', { ascending: true })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (connectedIds.length > 0) query = query.not('id', 'in', excludeConnected)
  if (city) query = query.eq('city', city)
  if (searchQuery) {
    // `%` og `,` ville brutt filteruttrykket PostgREST bygger av strengen.
    const sanitized = searchQuery.replace(/[%,]/g, ' ').trim()
    if (sanitized) query = query.or(`full_name.ilike.%${sanitized}%,stage_name.ilike.%${sanitized}%`)
  }

  let cityQuery = db
    .from('artist_directory')
    .select('city')
    .eq('status', 'approved')
    .not('city', 'is', null)

  if (connectedIds.length > 0) cityQuery = cityQuery.not('id', 'in', excludeConnected)

  const [{ data, count }, { data: cityRows }] = await Promise.all([query, cityQuery])

  const artists = (data ?? []) as DirectoryArtist[]
  const total = count ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const start = (page - 1) * PAGE_SIZE

  const cityCounts = new Map<string, number>()
  for (const row of cityRows ?? []) {
    if (!row.city) continue
    cityCounts.set(row.city, (cityCounts.get(row.city) ?? 0) + 1)
  }
  const cities = [...cityCounts.entries()]
    .map(([name, count]) => ({ city: name, count }))
    .sort((a, b) => a.city.localeCompare(b.city))

  return (
    <div>
      <AdminHeader title="Discover comedians" />

      <div className="flex max-w-6xl flex-col gap-6 p-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Discover comedians</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Find the right talent for your club. Connected comedians show up under My comedians.
          </p>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <form action="/admin-app/discover" className="relative w-full sm:w-64">
              {city && <input type="hidden" name="city" value={city} />}
              {sort !== 'bookings' && <input type="hidden" name="sort" value={sort} />}
              <Label htmlFor="discover-search">Comedian</Label>
              <Search className="pointer-events-none absolute left-3.5 top-[2.1rem] size-4 text-muted-foreground" />
              <Input
                id="discover-search"
                name="q"
                defaultValue={searchQuery}
                placeholder="Search by name"
                className="mt-1.5 h-10 rounded-4xl pl-10 pr-9"
              />
              {searchQuery && (
                <Link
                  href={buildHref({ city, sort })}
                  aria-label="Clear search"
                  className="absolute right-3 top-[2.1rem] flex size-5 -translate-y-0.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" />
                </Link>
              )}
              <button type="submit" className="sr-only">
                Search
              </button>
            </form>

            <DiscoverFilters cities={cities} city={city} sort={sort} query={searchQuery} />
          </div>

          <div className="flex items-center gap-3 pb-0.5">
            <span className="text-sm text-muted-foreground">
              {total === 0
                ? 'No comedians'
                : `Showing ${start + 1}–${start + artists.length} of ${total} ${total === 1 ? 'comedian' : 'comedians'}`}
            </span>
            {(city || searchQuery || sort !== 'bookings') && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/admin-app/discover">Reset filters</Link>
              </Button>
            )}
          </div>
        </div>

        {artists.length === 0 ? (
          <Card size="sm">
            <CardContent className="py-16 text-center text-sm text-muted-foreground">
              {!city && !searchQuery && connectedIds.length > 0
                ? 'Every comedian in the catalogue is already in your club.'
                : 'No comedians match this filter.'}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {artists.map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        )}

        {pageCount > 1 && (
          <Pagination page={page} pageCount={pageCount} city={city} sort={sort} query={searchQuery} />
        )}
      </div>
    </div>
  )
}

/** Alle lenkene på siden bærer de samme fire parameterne. */
function buildHref({
  city,
  sort,
  query,
  page,
}: {
  city?: string
  sort?: DiscoverSort
  query?: string
  page?: number
}) {
  const params = new URLSearchParams()
  if (query?.trim()) params.set('q', query.trim())
  if (city) params.set('city', city)
  if (sort && sort !== 'bookings') params.set('sort', sort)
  if (page && page > 1) params.set('page', String(page))

  const search = params.toString()
  return search ? `/admin-app/discover?${search}` : '/admin-app/discover'
}

function ArtistCard({ artist }: { artist: DirectoryArtist }) {
  const name = artist.stage_name?.trim() || artist.full_name
  const place = [artist.city, artist.country].filter(Boolean).join(', ')
  const roles = formatArtistRoleList(artist.category)

  return (
    <Card size="sm" className="items-center gap-0 py-6 text-center transition-shadow hover:shadow-md">
      <CardContent className="flex w-full flex-col items-center">
        <Avatar size="lg" className="!size-20">
          {artist.profile_image_url && <AvatarImage src={artist.profile_image_url} alt="" />}
          <AvatarFallback className="text-xl font-semibold">
            {name.trim().charAt(0).toUpperCase() || '?'}
          </AvatarFallback>
        </Avatar>

        <h3 className="mt-3 w-full truncate text-base font-semibold">{name}</h3>

        <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" />
          {place || 'Location not set'}
          {' · '}
          {artist.bookings} {artist.bookings === 1 ? 'booking' : 'bookings'}
        </p>

        {roles.length > 0 && (
          <p className="mt-[0.5px] w-full truncate text-xs text-muted-foreground">{roles.join(' · ')}</p>
        )}

        <div className="mt-2 flex w-full flex-col gap-2">
          <ConnectArtistButton
            artistId={artist.id}
            artistName={name}
            suggestedRoles={artist.category}
            className="text-xs sm:text-md w-full"
          />

          <Button variant="outline" className="text-xs sm:text-md w-full" asChild>
            <Link href={`/admin-app/artists/${artist.id}`}>View full profile</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function Pagination({
  page,
  pageCount,
  city,
  sort,
  query,
}: {
  page: number
  pageCount: number
  city: string
  sort: DiscoverSort
  query: string
}) {
  const href = (target: number) => buildHref({ city, sort, query, page: target })

  // Fem tall er så mange som får plass før rekka blir tapet. Vinduet følger
  // siden man står på.
  const windowStart = Math.max(1, Math.min(page - 2, pageCount - 4))
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => windowStart + index)

  return (
    <nav className="flex items-center justify-center gap-1.5" aria-label="Pagination">
      <Button variant="outline" size="icon-sm" disabled={page === 1} asChild={page !== 1} aria-label="Previous page">
        {page === 1 ? <ChevronLeft /> : <Link href={href(page - 1)}><ChevronLeft /></Link>}
      </Button>

      {pages.map((target) => (
        <Button
          key={target}
          variant={target === page ? 'default' : 'ghost'}
          size="icon-sm"
          asChild
          aria-current={target === page ? 'page' : undefined}
        >
          <Link href={href(target)}>{target}</Link>
        </Button>
      ))}

      <Button
        variant="outline"
        size="icon-sm"
        disabled={page === pageCount}
        asChild={page !== pageCount}
        aria-label="Next page"
      >
        {page === pageCount ? <ChevronRight /> : <Link href={href(page + 1)}><ChevronRight /></Link>}
      </Button>
    </nav>
  )
}
