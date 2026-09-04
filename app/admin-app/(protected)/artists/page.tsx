import Image from 'next/image'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { AdminHeader } from '@/components/admin/admin-header'
import { RemoveFromClubButton } from '@/components/admin/remove-from-club-button'
import { artistReadinessBlockers, READINESS_BLOCKER_LABELS } from '@/lib/artist-readiness'
import { EMPTY_REVIEW, clubArtistReviews } from '@/lib/club-artist-profile'
import { formatArtistRoleList } from '@/lib/artist-roles'
import { shouldBypassImageOptimization } from '@/lib/utils'
import { ArtistEnergyBadge, ArtistStatusBadge, FlaggedBadge } from '@/components/admin/artist-badges'
import type { ArtistStatus } from '@/types/database'

/**
 * Komikerlista i klubbadmin.
 *
 * Ett filter, ikke to. Tidligere lå det både faner (alle/klare/må vurderes) og
 * statuspiller over hverandre, og de svarte på samme spørsmål: hvem kan jeg
 * booke nå, og hvem må jeg gjøre noe med først. Nå er det én rad piller — og
 * de kolonnene som bare gjentok pillene, er borte.
 *
 * Lista er klubbens egen: komikerne den har knyttet til seg i «Discover
 * comedians» (`club_artists`, migrasjon 035). Sletteknappen løser derfor
 * koblingen — komikeren er delt mellom klubbene, og skal ikke kunne slettes
 * fra plattformen fordi én klubb er ferdig med hen.
 */

type ArtistFilter = 'all' | 'approved' | 'pending' | 'not_ready'

const FILTERS: { value: ArtistFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'not_ready', label: 'Not ready' },
]

const PAGE_SIZE = 25

type PageParams = { filter?: string; q?: string; page?: string }

export default async function ArtistsPage({
  searchParams,
}: {
  searchParams: Promise<PageParams>
}) {
  const params = await searchParams
  const searchQuery = params.q?.trim() ?? ''
  const filter = toFilter(params.filter)
  const db = createAdminClient()
  const clubId = await getDefaultClubIdForAdmin()

  // Roller, energi og flagg er klubbens egen vurdering og ligger på
  // koblingen, ikke på komikeren — se `lib/club-artist-profile`.
  const reviews = await clubArtistReviews(db, clubId)
  const rosterIds = [...reviews.keys()]

  let query = db
    .from('artists')
    .select('id, full_name, stage_name, email, profile_image_url, status')
    .in('id', rosterIds)
    .order('created_at', { ascending: false })
    .limit(200)

  if (searchQuery) {
    const sanitizedSearch = searchQuery.replace(/[%,]/g, ' ').trim()
    if (sanitizedSearch) {
      query = query.or(`full_name.ilike.%${sanitizedSearch}%,stage_name.ilike.%${sanitizedSearch}%,email.ilike.%${sanitizedSearch}%`)
    }
  }

  // Uten koblinger er det ingenting å spørre etter — `in()` med tom liste
  // ville dessuten hentet alle.
  const { data: artists } = rosterIds.length > 0 ? await query : { data: [] }

  // Blokkeringene leses av flere kolonner, så «ikke klar» avgjøres her og ikke
  // i spørringen. Tellingen bruker samme sett som tabellen viser.
  const rows = (artists ?? []).map((artist) => {
    const review = reviews.get(artist.id) ?? EMPTY_REVIEW
    return {
      artist,
      review,
      blockers: artistReadinessBlockers({ status: artist.status, category: review.category }),
    }
  })
  const matchesFilter = (
    { artist, blockers }: { artist: { status: ArtistStatus }; blockers: unknown[] },
    value: ArtistFilter,
  ) => {
    if (value === 'approved') return artist.status === 'approved'
    if (value === 'pending') return artist.status === 'pending_review'
    if (value === 'not_ready') return blockers.length > 0
    return true
  }

  // Tellingen står på pillene, ikke i en setning over dem: den som lurer på om
  // noen venter på noe, ser det på pilla hen uansett må trykke på.
  const counts = Object.fromEntries(
    FILTERS.map((option) => [option.value, rows.filter((row) => matchesFilter(row, option.value)).length]),
  ) as Record<ArtistFilter, number>

  const filtered = rows.filter((row) => matchesFilter(row, filter))

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, Number(params.page ?? 1) || 1), pageCount)
  const start = (page - 1) * PAGE_SIZE
  const visible = filtered.slice(start, start + PAGE_SIZE)

  return (
    <div>
      <AdminHeader title="Comedians" description={`${rows.length} ${rows.length === 1 ? 'comedian' : 'comedians'}`} />

      <div className="flex max-w-6xl flex-col gap-5 p-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Comedians</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? 'comedian' : 'comedians'}
            {counts.pending > 0 && ` · ${counts.pending} pending review`}
          </p>
        </div>

        <form action="/admin-app/artists" className="relative">
          {filter !== 'all' && <input type="hidden" name="filter" value={filter} />}
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            name="q"
            defaultValue={searchQuery}
            placeholder="Search by name or email"
            aria-label="Search comedians"
            className="h-11 w-full rounded-full border bg-card pl-11 pr-11 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-[var(--ev-accent-fill)]"
          />
          {/* Et søk som står igjen i feltet er den vanligste grunnen til at
              lista «mangler» noen. Da må det være én ting å trykke på. */}
          {searchQuery && (
            <Link
              href={buildArtistsHref({ filter })}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </Link>
          )}
          {/* Enter sender skjemaet. Knappen er der for skjermlesere og for
              tastatur som ikke sender på Enter i ett enkelt felt. */}
          <button type="submit" className="sr-only">
            Search
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((option) => {
            const active = filter === option.value
            return (
              <Link
                key={option.value}
                href={buildArtistsHref({ q: searchQuery, filter: option.value })}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[var(--ev-accent-fill)] text-white'
                    : 'border text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.label}
                <span
                  className={`text-xs tabular-nums ${
                    active
                      ? 'text-white/70'
                      : option.value === 'not_ready' && counts.not_ready > 0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-muted-foreground/60'
                  }`}
                >
                  {counts[option.value]}
                </span>
              </Link>
            )
          })}
        </div>

        <div className="overflow-hidden rounded-2xl border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-5 py-3 text-left font-medium">Comedian</th>
                  <th className="px-5 py-3 text-left font-medium">Role</th>
                  <th className="px-5 py-3 text-left font-medium">Status</th>
                  <th className="px-5 py-3 text-left font-medium">Energy</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map(({ artist, review, blockers }) => {
                  const roles = formatArtistRoleList(review.category)
                  // «Ikke godkjent» står allerede i statuskolonnen. Her vises
                  // bare det som ellers ikke er synlig noe sted i tabellen.
                  const missing = blockers.filter((blocker) => blocker !== 'approval')
                  return (
                    <tr key={artist.id} className="relative border-b transition-colors last:border-0 hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <Link
                          href={`/admin-app/artists/${artist.id}`}
                          className="group flex items-center gap-3 after:absolute after:inset-0 after:content-['']"
                        >
                          <Avatar
                            src={artist.profile_image_url}
                            name={artist.stage_name ?? artist.full_name}
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold group-hover:underline">
                              {artist.full_name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">{artist.email}</span>
                            {missing.length > 0 && (
                              <span className="mt-0.5 block truncate text-xs text-amber-600 dark:text-amber-400">
                                {missing.map((blocker) => READINESS_BLOCKER_LABELS[blocker]).join(' · ')}
                              </span>
                            )}
                          </span>
                        </Link>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {roles.length > 0 ? roles.join(', ') : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <ArtistStatusBadge status={artist.status} />
                        {review.is_flagged && <span className="ml-1"><FlaggedBadge /></span>}
                      </td>
                      <td className="px-5 py-3">
                        {review.admin_energy_level ? (
                          <ArtistEnergyBadge level={review.admin_energy_level} />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="relative px-5 py-3 text-right">
                        <RemoveFromClubButton artistId={artist.id} name={artist.full_name} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {visible.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-14 text-sm text-muted-foreground">
              <p>
                {searchQuery
                  ? `No comedians match “${searchQuery}”.`
                  : filter === 'not_ready'
                    ? 'Every comedian is ready for booking.'
                    : rosterIds.length === 0
                      ? 'No comedians in your club yet.'
                      : 'No comedians here yet.'}
              </p>
              {/* Et tomt resultat skal ha veien videre i seg selv: enten
                  tilbake til hele lista, eller ut i katalogen. */}
              {searchQuery || filter !== 'all' ? (
                <Link href="/admin-app/artists" className="font-medium text-foreground hover:underline">
                  Show all comedians
                </Link>
              ) : (
                <Link href="/admin-app/discover" className="font-medium text-foreground hover:underline">
                  Discover comedians →
                </Link>
              )}
            </div>
          )}
        </div>

        {filtered.length > 0 && (
          <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
            <span>
              Showing {start + 1}–{start + visible.length} of {filtered.length}{' '}
              {filtered.length === 1 ? 'comedian' : 'comedians'}
            </span>

            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <PageStep
                  href={buildArtistsHref({ q: searchQuery, filter, page: page - 1 })}
                  disabled={page === 1}
                  label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </PageStep>
                <span className="px-2 tabular-nums">
                  {page} / {pageCount}
                </span>
                <PageStep
                  href={buildArtistsHref({ q: searchQuery, filter, page: page + 1 })}
                  disabled={page === pageCount}
                  label="Next page"
                >
                  <ChevronRight className="size-4" />
                </PageStep>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) {
    return (
      <Image
        src={src}
        alt=""
        width={36}
        height={36}
        unoptimized={shouldBypassImageOptimization(src)}
        className="size-9 shrink-0 rounded-full object-cover"
      />
    )
  }

  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}

function PageStep({
  href,
  disabled,
  label,
  children,
}: {
  href: string
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  const className = 'inline-flex size-8 items-center justify-center rounded-full border transition-colors'

  if (disabled) {
    return (
      <span aria-disabled className={`${className} opacity-40`}>
        {children}
      </span>
    )
  }

  return (
    <Link href={href} aria-label={label} className={`${className} hover:bg-muted hover:text-foreground`}>
      {children}
    </Link>
  )
}

function toFilter(value: string | undefined): ArtistFilter {
  return FILTERS.some((option) => option.value === value) ? (value as ArtistFilter) : 'all'
}

/** Søket og filteret skal overleve hverandre; siden nullstilles når de endres. */
function buildArtistsHref({ q, filter, page }: { q?: string; filter?: ArtistFilter; page?: number }) {
  const urlParams = new URLSearchParams()
  if (q?.trim()) urlParams.set('q', q.trim())
  if (filter && filter !== 'all') urlParams.set('filter', filter)
  if (page && page > 1) urlParams.set('page', String(page))

  const queryString = urlParams.toString()
  return queryString ? `/admin-app/artists?${queryString}` : '/admin-app/artists'
}
