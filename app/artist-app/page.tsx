import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import { formatMoney, getCurrentArtist } from '@/lib/artist-portal'
import { createClient } from '@/lib/supabase/server'
import { Chip, DataRow, Empty, PageHeader, Panel, Row, portalButton } from '@/components/artist/portal-ui'

export default async function ArtistDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <ArtistAuthLanding />

  const { artist, db } = await getCurrentArtist()
  const today = new Date().toISOString().slice(0, 10)

  const [offersResult, spotsResult] = await Promise.all([
    db.from('booking_offers').select('*').eq('artist_id', artist.id).eq('status', 'sent').order('created_at', { ascending: false }),
    db.from('confirmed_spots').select('*').eq('artist_id', artist.id).order('created_at', { ascending: false }),
  ])

  const offers = offersResult.data ?? []
  const spots = spotsResult.data ?? []
  const relevantShowIds = [...new Set([...offers.map((offer) => offer.show_id), ...spots.map((spot) => spot.show_id)])]
  const { data: shows } = relevantShowIds.length > 0
    ? await db.from('shows').select('id, title, date, start_time, venue_name').in('id', relevantShowIds)
    : { data: [] }
  const showMap = new Map((shows ?? []).map((show) => [show.id, show]))

  const nextSpot = spots
    .filter((spot) => {
      const show = showMap.get(spot.show_id)
      return spot.status === 'confirmed' && (!show?.date || show.date >= today)
    })
    .sort((a, b) => (showMap.get(a.show_id)?.date ?? '').localeCompare(showMap.get(b.show_id)?.date ?? ''))[0]

  const previousSpots = spots
    .filter((spot) => {
      const show = showMap.get(spot.show_id)
      return spot.status !== 'cancelled' && show?.date != null && show.date < today
    })
    .sort((a, b) => (showMap.get(b.show_id)?.date ?? '').localeCompare(showMap.get(a.show_id)?.date ?? ''))
    .slice(0, 3)

  const featuredShow = nextSpot ? showMap.get(nextSpot.show_id) : null

  return (
    <>
      <PageHeader
        title={`Hi, ${artist.stage_name ?? artist.full_name}`}
        description="Next show, active offers and the profile the booking team works from."
        actions={
          <>
            {offers.length > 0 && (
                <Link href="/artist-app/bookings" className={portalButton.primary}>
                {offers.length} {offers.length === 1 ? 'offer waiting' : 'offers waiting'}
              </Link>
            )}
            <Link href="/artist-app/profile" className={portalButton.secondary}>
              Open profile
            </Link>
          </>
        }
      />

      {/* Next show */}
      <Panel title="Next show">
        {featuredShow ? (
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <div
              className="grid w-full shrink-0 place-content-center bg-[var(--ev-text)] px-5 py-4 text-center text-[var(--ev-bg)] sm:w-24"
              style={{ borderRadius: 'var(--ev-r-art)' }}
            >
              <span className="text-[11px] uppercase tracking-[0.16em] opacity-70">
                {formatDateMonth(featuredShow.date ?? today)}
              </span>
              <span className="text-4xl font-semibold leading-none tabular-nums">
                {formatDateDay(featuredShow.date ?? today)}
              </span>
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="text-[1.35rem] font-semibold leading-tight tracking-[-0.02em]">
                {featuredShow.title ?? 'Next booking'}
              </h3>
              <p className="mt-1 text-[14px] text-[var(--ev-muted)]">
                {featuredShow.date ? formatDate(featuredShow.date) : 'Date coming'}
                {featuredShow.venue_name ? ` · ${featuredShow.venue_name}` : ''}
              </p>
              {nextSpot && (
                <p className="mt-2 text-[14px] font-medium tabular-nums">
                  {formatMoney(nextSpot.fee_amount, nextSpot.currency)}
                </p>
              )}
            </div>

            <Link href="/artist-app/bookings" className={`${portalButton.primary} shrink-0`}>
              See bookings <ArrowUpRight className="size-4" />
            </Link>
          </div>
        ) : (
          <Empty>No upcoming shows right now. New bookings and offers will appear here first.</Empty>
        )}
      </Panel>

      {/* Active offers */}
      <Panel
        title="Active offers"
        description="Offers awaiting response."
        actions={
          offers.length > 0 ? (
            <Link
              href="/artist-app/bookings"
              className="inline-flex items-center gap-1.5 text-[13px] text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)]"
            >
              All offers <ArrowRight className="size-3.5" />
            </Link>
          ) : undefined
        }
      >
        {offers.length === 0 ? (
          <Empty>No active offers right now.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {offers.slice(0, 3).map((offer) => {
              const show = showMap.get(offer.show_id)
              return (
                <Row key={offer.id}>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium">{show?.title ?? 'Booking offer'}</p>
                    <p className="mt-0.5 truncate text-[13px] text-[var(--ev-muted)]">
                      {show?.date ? formatDate(show.date) : 'Date coming'}
                      {show?.venue_name ? ` · ${show.venue_name}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[14px] font-medium tabular-nums">
                      {formatMoney(offer.fee_amount, offer.currency)}
                    </span>
                    <Link
                      href={`/artist-app/booking-offers/${offer.token}`}
                      className={portalButton.primary}
                    >
                      Reply now
                    </Link>
                  </div>
                </Row>
              )
            })}
          </div>
        )}
      </Panel>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Previous shows" description="Your last completed performances.">
          {previousSpots.length === 0 ? (
            <Empty>No previous shows yet.</Empty>
          ) : (
            <div className="flex flex-col gap-2">
              {previousSpots.map((spot) => {
                const show = showMap.get(spot.show_id)
                return (
                  <Row key={spot.id}>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium">{show?.title ?? 'Show'}</p>
                      <p className="mt-0.5 truncate text-[13px] text-[var(--ev-muted)]">
                        {show?.date ? formatDate(show.date) : 'Date coming'}
                        {show?.venue_name ? ` · ${show.venue_name}` : ''}
                      </p>
                    </div>
                    <span className="text-[14px] font-medium tabular-nums text-[var(--ev-muted)]">
                      {formatMoney(spot.fee_amount, spot.currency)}
                    </span>
                  </Row>
                )
              })}
            </div>
          )}
        </Panel>

        <Panel title="Your profile" description="The booking team matches you against new evenings based on this.">
          <div className="flex flex-col divide-y divide-[var(--ev-line)]">
            <DataRow label="Name" value={artist.stage_name ?? artist.full_name} />
            <DataRow label="Email" value={artist.email} />
            <DataRow
              label="Status"
              value={
                <Chip tone={artist.status === 'approved' ? 'accent' : 'neutral'}>
                  {artist.status === 'approved' ? 'Approved' : 'Under review'}
                </Chip>
              }
            />
            <DataRow label="Active offers" value={offers.length} />
            <DataRow label="Previous shows" value={previousSpots.length} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/artist-app/profile" className={portalButton.primary}>
              Edit profile
            </Link>
          </div>
        </Panel>
      </div>
    </>
  )
}

/** Vises på /artist-app når man ikke er logget inn — utenfor portalskallet. */
function ArtistAuthLanding() {
  return (
    <main
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <section className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-4 pb-16 pt-28 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:gap-16">
        <div>
          <p className="text-[13px] text-[var(--ev-faint)]">Comedian Portal</p>
          <h1 className="mt-2 text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            Bookings, offers and profile in one place
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[var(--ev-muted)]">
            Sign in or register a comedian profile to be considered for upcoming evenings at
            Tickethalo.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/artist-app/login" className={portalButton.primary}>
              Sign in
            </Link>
            <Link href="/artist-app/signup" className={portalButton.secondary}>
              Register Profile <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>

        <div
          className="flex flex-col gap-4 bg-[var(--ev-card)] p-6"
          style={{ borderRadius: 'var(--ev-r-card)' }}
        >
          <p className="text-[13px] text-[var(--ev-faint)]">What you find here</p>
          <ul className="flex flex-col divide-y divide-[var(--ev-line)]">
            {['Upcoming shows and fees', 'Active offers awaiting response', 'Profile organizers see'].map(
              (item) => (
                <li key={item} className="py-3 text-[15px] font-medium">
                  {item}
                </li>
              )
            )}
          </ul>
        </div>
      </section>

      <Footer />
    </main>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

function formatDateDay(value: string) {
  return new Date(value).getDate()
}

function formatDateMonth(value: string) {
  return new Date(value).toLocaleDateString('en-US', { month: 'short' })
}
