import Link from 'next/link'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { PublicHeader } from '@/components/public/public-header'
import {
  ArtistBadge,
  ArtistEmpty,
  ArtistList,
  ArtistListRow,
  artistPrimaryButtonClass,
  artistSecondaryButtonClass,
  formatArtistDate,
  formatArtistDay,
  formatArtistMonth,
} from '@/components/artist/artist-ui'
import { formatMoney, getCurrentArtist, isArtistBookable, isArtistGloballyApproved } from '@/lib/artist-portal'
import { MAX_ARTIST_AVAILABILITY_DATES } from '@/lib/artist-availability'
import { createClient } from '@/lib/supabase/server'
import { Footer } from '@/components/Footer'

export default async function ArtistDashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <ArtistAuthLanding />

  const { artist, db } = await getCurrentArtist()
  const today = new Date().toISOString().slice(0, 10)
  const isApproved = isArtistBookable(artist)

  const [offersResult, spotsResult, availabilityResult] = await Promise.all([
    db.from('booking_offers').select('*').eq('artist_id', artist.id).eq('status', 'sent').order('created_at', { ascending: false }),
    db.from('confirmed_spots').select('*').eq('artist_id', artist.id).order('created_at', { ascending: false }),
    db.from('artist_availability').select('id', { count: 'exact', head: true }).eq('artist_id', artist.id).gte('available_date', today),
  ])

  const offers = offersResult.data ?? []
  const spots = spotsResult.data ?? []
  const availabilityCount = availabilityResult.count ?? 0
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
  const upcomingCount = spots.filter((spot) => {
    const show = showMap.get(spot.show_id)
    return spot.status === 'confirmed' && (!show?.date || show.date >= today)
  }).length
  const previousSpots = spots
    .filter((spot) => {
      const show = showMap.get(spot.show_id)
      return spot.status !== 'cancelled' && show?.date != null && show.date < today
    })
    .sort((a, b) => (showMap.get(b.show_id)?.date ?? '').localeCompare(showMap.get(a.show_id)?.date ?? ''))
    .slice(0, 5)
  const featuredShow = nextSpot ? showMap.get(nextSpot.show_id) : null

  return (
    <div>
      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-10 pt-8 md:grid-cols-[minmax(0,1fr)_280px] md:items-start md:gap-10 md:px-6 md:pb-12 md:pt-10 lg:px-8">
          <div>
            <p className="text-sm text-muted-foreground">Hei, {artist.stage_name ?? artist.full_name}</p>
            <h1 className="mt-1 max-w-2xl text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-tight tracking-tight">
              {featuredShow ? 'Neste show' : 'Komikerportal'}
            </h1>

            {featuredShow ? (
              <div className="mt-6 grid overflow-hidden rounded-2xl ring-1 ring-black/[0.06] shadow-sm md:grid-cols-[96px_1fr]">
                <div className="grid content-center bg-vipps-orange-0 px-4 py-4 text-center md:border-r md:border-border">
                  <span className="text-xs font-semibold uppercase tracking-wide text-vipps-orange-80">
                    {formatArtistMonth(featuredShow.date ?? today)}
                  </span>
                  <span className="text-5xl font-semibold leading-none tracking-tight text-vipps-orange-80">
                    {formatArtistDay(featuredShow.date ?? today)}
                  </span>
                </div>
                <div className="grid gap-3 px-4 py-4 sm:px-5">
                  <Link
                    href="/artist-app/bookings"
                    className="group inline-flex w-fit items-start gap-2 text-2xl font-semibold leading-tight tracking-tight transition hover:text-primary md:text-3xl"
                  >
                    {featuredShow.title ?? 'Neste booking'}
                    <ArrowUpRight className="mt-1 size-5 opacity-50 transition group-hover:translate-x-0.5" />
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {featuredShow.date ? formatArtistDate(featuredShow.date, 'long') : 'Dato kommer'}
                    {featuredShow.venue_name ? ` · ${featuredShow.venue_name}` : ''}
                    {nextSpot ? ` · ${formatMoney(nextSpot.fee_amount, nextSpot.currency)}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link href="/artist-app/bookings" className={artistPrimaryButtonClass}>
                      Se bookinger
                    </Link>
                    {offers.length > 0 && (
                      <Link href="/artist-app/booking-offers" className={artistSecondaryButtonClass}>
                        {offers.length} tilbud venter
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 max-w-lg text-sm leading-relaxed text-muted-foreground">
                Ingen kommende show akkurat nå. Nye tilbud og bookinger vises her med en gang.
              </div>
            )}
          </div>

          <aside className="grid gap-3">
            <div className="rounded-2xl border border-border p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
              <p className="mt-2 text-xl font-semibold">{artist.stage_name ?? artist.full_name}</p>
              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="text-muted-foreground">Profil</span>
                  <ArtistBadge variant={isArtistGloballyApproved(artist) || isApproved ? 'accent' : 'muted'}>
                    {isApproved ? 'Godkjent' : 'Vurderes'}
                  </ArtistBadge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Tilbud</span>
                  <span className="font-semibold">{offers.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Kommende show</span>
                  <span className="font-semibold">{upcomingCount}</span>
                </div>
              </div>
              <Link href="/artist-app/profile" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80">
                Rediger profil <ArrowRight className="size-3.5" />
              </Link>
            </div>

            <Link href="/artist-app/available-dates" className="block rounded-2xl border border-border p-4 transition hover:border-primary/40 hover:bg-muted/40">
              <p className="text-sm font-semibold">Tilgjengelighet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isApproved
                  ? `${availabilityCount} av ${MAX_ARTIST_AVAILABILITY_DATES} datoer valgt · gir bonus i booking`
                  : 'Tilgjengelig når profilen er godkjent'}
              </p>
            </Link>
          </aside>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8 md:px-6 lg:px-8">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Tilbud som venter</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Svar så raskt du kan — plassene fylles fortløpende.</p>
          </div>
          {offers.length > 0 && (
            <Link href="/artist-app/booking-offers" className="text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80">
              Se alle
            </Link>
          )}
        </div>

        {offers.length === 0 ? (
          <ArtistEmpty text="Ingen aktive tilbud akkurat nå." />
        ) : (
          <ArtistList>
            {offers.slice(0, 5).map((offer) => {
              const show = showMap.get(offer.show_id)
              return (
                <ArtistListRow
                  key={offer.id}
                  title={show?.title ?? 'Bookingtilbud'}
                  meta={[
                    show?.date ? formatArtistDate(show.date) : 'Dato kommer',
                    show?.venue_name,
                    formatMoney(offer.fee_amount, offer.currency),
                  ].filter(Boolean).join(' · ')}
                  actions={
                    <Link href={`/artist-app/booking-offers/${offer.token}`} className={artistPrimaryButtonClass}>
                      Svar
                    </Link>
                  }
                />
              )
            })}
          </ArtistList>
        )}
      </section>

      {previousSpots.length > 0 && (
        <section className="border-t border-border bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-8 md:px-6 lg:px-8">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Tidligere show</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">Dine siste opptredener.</p>
              </div>
              <Link href="/artist-app/bookings?view=previous" className="text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80">
                Se alle
              </Link>
            </div>
            <ArtistList>
              {previousSpots.map((spot) => {
                const show = showMap.get(spot.show_id)
                return (
                  <ArtistListRow
                    key={spot.id}
                    title={show?.title ?? 'Show'}
                    meta={[
                      show?.date ? formatArtistDate(show.date, 'weekday') : 'Dato kommer',
                      show?.venue_name,
                    ].filter(Boolean).join(' · ')}
                  />
                )
              })}
            </ArtistList>
          </div>
        </section>
      )}
    </div>
  )
}

function ArtistAuthLanding() {
  return (
    <main className="public-shell min-h-screen bg-background text-foreground">
      <section className="min-h-[calc(100vh-100px)] border-b border-border">
        <PublicHeader transparent tone="light" />
        <div className="mx-auto flex max-w-6xl flex-col justify-center px-4 py-20 md:px-6 md:py-[28vh] lg:px-8">
          <h1 className="max-w-xl text-[clamp(2.5rem,6vw,4.5rem)] font-semibold leading-tight tracking-tight">
            Komikerportal
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground md:text-base">
            Logg inn for å se tilbud, bookinger og profilen din hos humor.events.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/artist-app/login" className={artistPrimaryButtonClass}>
              Logg inn
            </Link>
            <Link href="/artist-app/signup" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary underline underline-offset-4 hover:text-primary/80">
              Registrer profil <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}
