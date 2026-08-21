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
        title={`Hei, ${artist.stage_name ?? artist.full_name}`}
        description="Neste show, aktive tilbud og profilen bookingteamet jobber fra."
        actions={
          <>
            {offers.length > 0 && (
                <Link href="/artist-app/bookings" className={portalButton.primary}>
                {offers.length} {offers.length === 1 ? 'tilbud venter' : 'tilbud venter'}
              </Link>
            )}
            <Link href="/artist-app/profile" className={portalButton.secondary}>
              Åpne profil
            </Link>
          </>
        }
      />

      {/* Neste show */}
      <Panel title="Neste show">
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
                {featuredShow.title ?? 'Neste booking'}
              </h3>
              <p className="mt-1 text-[14px] text-[var(--ev-muted)]">
                {featuredShow.date ? formatDate(featuredShow.date) : 'Dato kommer'}
                {featuredShow.venue_name ? ` · ${featuredShow.venue_name}` : ''}
              </p>
              {nextSpot && (
                <p className="mt-2 text-[14px] font-medium tabular-nums">
                  {formatMoney(nextSpot.fee_amount, nextSpot.currency)}
                </p>
              )}
            </div>

            <Link href="/artist-app/bookings" className={`${portalButton.primary} shrink-0`}>
              Se bookinger <ArrowUpRight className="size-4" />
            </Link>
          </div>
        ) : (
          <Empty>Ingen kommende show akkurat nå. Nye bookinger og tilbud dukker opp her først.</Empty>
        )}
      </Panel>

      {/* Aktive tilbud */}
      <Panel
        title="Aktive tilbud"
        description="Tilbud som venter på svar."
        actions={
          offers.length > 0 ? (
            <Link
              href="/artist-app/bookings"
              className="inline-flex items-center gap-1.5 text-[13px] text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)]"
            >
              Alle tilbud <ArrowRight className="size-3.5" />
            </Link>
          ) : undefined
        }
      >
        {offers.length === 0 ? (
          <Empty>Ingen aktive tilbud akkurat nå.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {offers.slice(0, 3).map((offer) => {
              const show = showMap.get(offer.show_id)
              return (
                <Row key={offer.id}>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium">{show?.title ?? 'Bookingtilbud'}</p>
                    <p className="mt-0.5 truncate text-[13px] text-[var(--ev-muted)]">
                      {show?.date ? formatDate(show.date) : 'Dato kommer'}
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
                      Svar nå
                    </Link>
                  </div>
                </Row>
              )
            })}
          </div>
        )}
      </Panel>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="Tidligere show" description="Dine siste gjennomførte opptredener.">
          {previousSpots.length === 0 ? (
            <Empty>Ingen tidligere show ennå.</Empty>
          ) : (
            <div className="flex flex-col gap-2">
              {previousSpots.map((spot) => {
                const show = showMap.get(spot.show_id)
                return (
                  <Row key={spot.id}>
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium">{show?.title ?? 'Show'}</p>
                      <p className="mt-0.5 truncate text-[13px] text-[var(--ev-muted)]">
                        {show?.date ? formatDate(show.date) : 'Dato kommer'}
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

        <Panel title="Profilen din" description="Bookingteamet matcher deg mot nye kvelder ut fra denne.">
          <div className="flex flex-col divide-y divide-[var(--ev-line)]">
            <DataRow label="Navn" value={artist.stage_name ?? artist.full_name} />
            <DataRow label="E-post" value={artist.email} />
            <DataRow
              label="Status"
              value={
                <Chip tone={artist.status === 'approved' ? 'accent' : 'neutral'}>
                  {artist.status === 'approved' ? 'Godkjent' : 'Vurderes'}
                </Chip>
              }
            />
            <DataRow label="Aktive tilbud" value={offers.length} />
            <DataRow label="Tidligere show" value={previousSpots.length} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/artist-app/profile" className={portalButton.primary}>
              Rediger profil
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
          <p className="text-[13px] text-[var(--ev-faint)]">Komikerportal</p>
          <h1 className="mt-2 text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            Bookinger, tilbud og profil på ett sted
          </h1>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[var(--ev-muted)]">
            Logg inn eller registrer komikerprofil for å bli vurdert til kommende kvelder hos
            Tickethalo.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/artist-app/login" className={portalButton.primary}>
              Logg inn
            </Link>
            <Link href="/artist-app/signup" className={portalButton.secondary}>
              Registrer profil <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>

        <div
          className="flex flex-col gap-4 bg-[var(--ev-card)] p-6"
          style={{ borderRadius: 'var(--ev-r-card)' }}
        >
          <p className="text-[13px] text-[var(--ev-faint)]">Hva du finner her</p>
          <ul className="flex flex-col divide-y divide-[var(--ev-line)]">
            {['Kommende show og honorar', 'Aktive tilbud som venter på svar', 'Profilen arrangørene ser'].map(
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
  return new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

function formatDateDay(value: string) {
  return new Date(value).getDate()
}

function formatDateMonth(value: string) {
  return new Date(value).toLocaleDateString('nb-NO', { month: 'short' })
}
