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
      <section className="border-b border-black/10">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-10 pt-8 md:grid-cols-[minmax(0,1fr)_280px] md:items-start md:gap-10 md:px-6 md:pb-12 md:pt-10 lg:px-8">
          <div>
            <p className="text-sm text-zinc-500">Hei, {artist.stage_name ?? artist.full_name}</p>
            <h1 className="mt-1 max-w-2xl text-[clamp(2rem,5vw,3.25rem)] font-medium leading-tight tracking-tight">
              {featuredShow ? 'Neste show' : 'Komikerportal'}
            </h1>

            {featuredShow ? (
              <div className="mt-6 grid border border-black/10 md:grid-cols-[96px_1fr]">
                <div className="grid content-center border-b border-black/10 px-4 py-4 text-center md:border-b-0 md:border-r md:border-r-black/10">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                    {formatArtistMonth(featuredShow.date ?? today)}
                  </span>
                  <span className="text-5xl font-medium leading-none tracking-tight">
                    {formatArtistDay(featuredShow.date ?? today)}
                  </span>
                </div>
                <div className="grid gap-3 px-4 py-4 sm:px-5">
                  <Link
                    href="/artist-app/bookings"
                    className="group inline-flex w-fit items-start gap-2 text-2xl font-medium leading-tight tracking-tight transition hover:text-[#ff6bff] md:text-3xl"
                  >
                    {featuredShow.title ?? 'Neste booking'}
                    <ArrowUpRight className="mt-1 size-5 opacity-50 transition group-hover:translate-x-0.5" />
                  </Link>
                  <p className="text-sm text-zinc-600">
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
              <div className="mt-6 max-w-lg text-sm leading-relaxed text-zinc-600">
                Ingen kommende show akkurat nå. Nye tilbud og bookinger vises her med en gang.
              </div>
            )}
          </div>

          <aside className="grid gap-3">
            <div className="border border-black/10 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Status</p>
              <p className="mt-2 text-xl font-medium">{artist.stage_name ?? artist.full_name}</p>
              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex items-center justify-between border-t border-black/10 pt-2">
                  <span className="text-zinc-500">Profil</span>
                  <ArtistBadge variant={isArtistGloballyApproved(artist) || isApproved ? 'accent' : 'muted'}>
                    {isApproved ? 'Godkjent' : 'Vurderes'}
                  </ArtistBadge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Tilbud</span>
                  <span className="font-medium">{offers.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Kommende show</span>
                  <span className="font-medium">{upcomingCount}</span>
                </div>
              </div>
              <Link href="/artist-app/profile" className="mt-4 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4 hover:text-[#ff6bff]">
                Rediger profil <ArrowRight className="size-3.5" />
              </Link>
            </div>

            <Link href="/artist-app/available-dates" className="block border border-black/10 p-4 transition hover:border-black/30">
              <p className="text-sm font-medium">Tilgjengelighet</p>
              <p className="mt-1 text-xs text-zinc-500">
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
            <h2 className="text-xl font-medium">Tilbud som venter</h2>
            <p className="mt-0.5 text-sm text-zinc-500">Svar så raskt du kan — plassene fylles fortløpende.</p>
          </div>
          {offers.length > 0 && (
            <Link href="/artist-app/booking-offers" className="text-sm font-medium underline underline-offset-4 hover:text-[#ff6bff]">
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
        <section className="border-t border-black/10 bg-zinc-50/50">
          <div className="mx-auto max-w-6xl px-4 py-8 md:px-6 lg:px-8">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-medium">Tidligere show</h2>
                <p className="mt-0.5 text-sm text-zinc-500">Dine siste opptredener.</p>
              </div>
              <Link href="/artist-app/bookings?view=previous" className="text-sm font-medium underline underline-offset-4 hover:text-[#ff6bff]">
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
    <main className="min-h-screen bg-white text-black">
      <section className="min-h-[calc(100vh-100px)] border-b border-black/10">
        <PublicHeader transparent tone="light" />
        <div className="mx-auto flex max-w-6xl flex-col justify-center px-4 py-20 md:px-6 md:py-[28vh] lg:px-8">
          <h1 className="max-w-xl text-[clamp(2.5rem,6vw,4.5rem)] font-medium leading-tight tracking-tight">
            Komikerportal
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-zinc-600 md:text-base">
            Logg inn for å se tilbud, bookinger og profilen din hos humor.events.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/artist-app/login" className={artistPrimaryButtonClass}>
              Logg inn
            </Link>
            <Link href="/artist-app/signup" className="inline-flex items-center gap-1.5 text-sm font-medium underline underline-offset-4 hover:text-[#ff6bff]">
              Registrer profil <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}
