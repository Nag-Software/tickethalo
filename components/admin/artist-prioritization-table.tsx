import Link from 'next/link'
import { ARTIST_ROLE_OPTIONS } from '@/lib/artist-roles'
import type { ClubArtistPriorities } from '@/lib/club-booking-priorities'

type ArtistPrioritizationTableProps = {
  priorities: ClubArtistPriorities
}

function formatScore(value: number) {
  return value.toFixed(1)
}

function formatDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('nb-NO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function ArtistPrioritizationTable({ priorities }: ArtistPrioritizationTableProps) {
  const roleLabel = ARTIST_ROLE_OPTIONS.find(option => option.value === priorities.roleName)?.label ?? priorities.roleName

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Prioriteringsscore</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Rangering for rolle <span className="font-medium text-foreground">{roleLabel}</span> basert på
          gjeldende innstillinger og bookinghistorikk ({priorities.totalClubEvents} events i vinduet).
          {priorities.referenceDate ? (
            <>
              {' '}Tilgjengelighetsbonus gjelder for{' '}
              <span className="font-medium text-foreground">
                {priorities.referenceShowTitle ?? 'neste show'} ({formatDate(priorities.referenceDate)})
              </span>.
            </>
          ) : (
            <> Ingen kommende show i booking — tilgjengelighetsbonus er ikke med i score.</>
          )}
          {' '}Høyere score = bookes først.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {ARTIST_ROLE_OPTIONS.map(({ value, label }) => {
          const active = priorities.roleName === value
          return (
            <Link
              key={value}
              href={`/admin-app/min-klubb/bookingalgoritme?role=${encodeURIComponent(value)}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
              <th className="px-4 py-2.5 text-left font-medium w-10">#</th>
              <th className="px-4 py-2.5 text-left font-medium">Komiker</th>
              <th className="px-4 py-2.5 text-center font-medium">Show</th>
              <th className="px-4 py-2.5 text-center font-medium">Rolle</th>
              <th className="px-4 py-2.5 text-center font-medium">Prioritert</th>
              <th className="px-4 py-2.5 text-right font-medium">Base</th>
              <th className="px-4 py-2.5 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {priorities.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Ingen godkjente komikere funnet.
                </td>
              </tr>
            ) : (
              priorities.rows.map((row, index) => (
                <tr
                  key={row.artistId}
                  className={`border-b last:border-0 transition-colors hover:bg-muted/20 ${
                    !row.bookable ? 'opacity-60' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-muted-foreground tabular-nums">{index + 1}</td>
                  <td className="px-4 py-3">
                    <Link href={`/admin-app/artists/${row.artistId}`} className="hover:underline">
                      <span className="font-medium">{row.fullName}</span>
                      {row.stageName && (
                        <span className="block text-xs text-muted-foreground">{row.stageName}</span>
                      )}
                    </Link>
                    {!row.bookable && (
                      <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
                        Ikke bookbar for denne rollen
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                    {row.globalBookings}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums text-muted-foreground">
                    {row.roleBookings}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {priorities.referenceDate ? (
                      row.prioritizedForReferenceShow ? (
                        <span className="text-emerald-700 dark:text-emerald-400">Ja</span>
                      ) : row.upcomingAvailabilityCount > 0 ? (
                        <span className="text-muted-foreground" title="Prioritert andre datoer">
                          {row.upcomingAvailabilityCount} dato{row.upcomingAvailabilityCount === 1 ? '' : 'er'}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Nei</span>
                      )
                    ) : row.upcomingAvailabilityCount > 0 ? (
                      <span className="text-muted-foreground">
                        {row.upcomingAvailabilityCount} dato{row.upcomingAvailabilityCount === 1 ? '' : 'er'}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatScore(row.baseScore)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold">
                    {formatScore(row.finalScore)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Pool: {priorities.eligiblePoolSize} bookbare komikere for {roleLabel}. Score = base × rettferdighet ×
        dominans + boost. Komikere uten denne rollen (nivå) for klubben vises med lavere score og markeres som
        ikke bookbare.
      </p>
    </section>
  )
}
