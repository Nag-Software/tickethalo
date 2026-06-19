import Link from 'next/link'
import {
  ArtistBadge,
  ArtistEmpty,
  ArtistList,
  ArtistListRow,
  ArtistPage,
  ArtistPageHeader,
  ArtistTabs,
  formatArtistDate,
  spotStatusLabel,
} from '@/components/artist/artist-ui'
import { formatMoney, getCurrentArtist } from '@/lib/artist-portal'

export default async function ConfirmedBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const { view = 'upcoming' } = await searchParams
  const { artist, db } = await getCurrentArtist()
  const { data: spots } = await db
    .from('confirmed_spots')
    .select('*')
    .eq('artist_id', artist.id)
    .order('created_at', { ascending: false })

  const showIds = [...new Set((spots ?? []).map((spot) => spot.show_id))]
  const { data: shows } = showIds.length > 0
    ? await db.from('shows').select('id, title, date, start_time, venue_name').in('id', showIds)
    : { data: [] }
  const showMap = new Map((shows ?? []).map((show) => [show.id, show]))
  const today = new Date().toISOString().slice(0, 10)

  const upcoming = (spots ?? []).filter((spot) => {
    const show = showMap.get(spot.show_id)
    return spot.status !== 'cancelled' && (!show?.date || show.date >= today)
  })
  const previous = (spots ?? []).filter((spot) => {
    const show = showMap.get(spot.show_id)
    return spot.status !== 'cancelled' && show?.date && show.date < today
  })
  const cancelled = (spots ?? []).filter((spot) => spot.status === 'cancelled')

  const filtered = view === 'cancelled' ? cancelled : view === 'previous' ? previous : upcoming
  const descriptions = {
    upcoming: `${upcoming.length} kommende show`,
    previous: `${previous.length} tidligere show`,
    cancelled: `${cancelled.length} kansellerte`,
  }

  return (
    <ArtistPage>
      <ArtistPageHeader
        title="Bookinger"
        description={descriptions[view as keyof typeof descriptions] ?? descriptions.upcoming}
      />

      <ArtistTabs
        items={[
          { href: '/artist-app/bookings?view=upcoming', label: 'Kommende', active: view === 'upcoming', count: upcoming.length },
          { href: '/artist-app/bookings?view=previous', label: 'Tidligere', active: view === 'previous', count: previous.length },
          { href: '/artist-app/bookings?view=cancelled', label: 'Kansellerte', active: view === 'cancelled', count: cancelled.length },
        ]}
      />

      {filtered.length === 0 ? (
        <ArtistEmpty text="Ingen bookinger i denne visningen." />
      ) : (
        <ArtistList>
          {filtered.map((spot) => {
            const show = showMap.get(spot.show_id)
            return (
              <ArtistListRow
                key={spot.id}
                title={show?.title ?? 'Show'}
                meta={[
                  show?.date ? formatArtistDate(show.date, 'weekday') : 'Dato kommer',
                  show?.venue_name,
                  formatMoney(spot.fee_amount, spot.currency),
                ].filter(Boolean).join(' · ')}
                aside={
                  <>
                    <ArtistBadge variant={spot.status === 'confirmed' ? 'accent' : 'muted'}>
                      {spotStatusLabel(spot.status)}
                    </ArtistBadge>
                  </>
                }
              />
            )
          })}
        </ArtistList>
      )}

      {view === 'upcoming' && upcoming.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Nye bookinger dukker opp her når du aksepterer et tilbud.{' '}
          <Link href="/artist-app/booking-offers" className="underline underline-offset-4 hover:text-primary">
            Se tilbud
          </Link>
        </p>
      )}
    </ArtistPage>
  )
}
