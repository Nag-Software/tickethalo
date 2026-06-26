import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft, Ticket } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import { NaturalPosterImage } from '@/components/public/natural-poster-image'
import { startCheckoutAction } from '@/app/events/actions'
import { formatShowDate, formatShowTime, formatTicketPrice, getPublicLineup, getPublishedShowBySlug, remainingTickets, ticketFillPercent } from '@/lib/public-events'
import { shouldBypassImageOptimization } from '@/lib/utils'
import { getPublicAppUrl } from '@/lib/app-url'

type Props = {
  params: Promise<{ slug: string; eventSlug: string }>
  searchParams: Promise<{ error?: string }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug: clubSlug, eventSlug } = await params
  const show = await getPublishedShowBySlug(eventSlug)

  if (!show || show.clubSlug !== clubSlug) {
    return { title: 'Event ikke funnet — humor.events' }
  }

  const description = show.description ?? `${show.title} på ${show.venue_name ?? show.venue_address ?? 'humor.events'} ${formatShowDate(show.date)}.`
  const canonical = `/${clubSlug}/eventer/${show.slug}`

  return {
    title: `${show.title} — humor.events`,
    description,
    alternates: { canonical },
    openGraph: {
      title: show.title,
      description,
      type: 'website',
      url: canonical,
      images: show.poster_url ? [{ url: show.poster_url, alt: show.title }] : undefined,
    },
    other: {
      'event:start_time': show.date,
    },
  }
}

export default async function ClubEventDetailPage({ params, searchParams }: Props) {
  const [{ slug: clubSlug, eventSlug }, { error }] = await Promise.all([params, searchParams])
  const show = await getPublishedShowBySlug(eventSlug)

  if (!show || show.clubSlug !== clubSlug) notFound()

  const clubHref = `/${clubSlug}`
  const lineup = await getPublicLineup(show.id)
  const remaining = remainingTickets(show)
  const soldOut = remaining === 0
  const fillPercent = ticketFillPercent(show)
  const lowStock = remaining !== null && remaining > 0 && (remaining <= 10 || fillPercent >= 80)
  const showLocation = show.venue_name ?? show.venue_address
  const showClub = show.clubName
  const availabilityText = soldOut ? 'Utsolgt' : 'Billetter tilgjengelig'
  const ticketWarning = soldOut
    ? 'Utsolgt'
    : lowStock
      ? 'Få igjen'
      : null

  const eventUrl = `${getPublicAppUrl()}/${clubSlug}/eventer/${show.slug}`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: show.title,
    startDate: show.start_time ? `${show.date}T${show.start_time}` : show.date,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url: eventUrl,
    ...(show.description ? { description: show.description } : {}),
    ...(show.poster_url ? { image: [show.poster_url] } : {}),
    location: {
      '@type': 'Place',
      name: show.venue_name ?? showClub ?? 'humor.events',
      ...(show.venue_address ? { address: show.venue_address } : {}),
    },
    ...(showClub ? { organizer: { '@type': 'Organization', name: showClub } } : {}),
    offers: {
      '@type': 'Offer',
      url: eventUrl,
      price: show.ticket_price != null ? (show.ticket_price / 100).toFixed(2) : '0',
      priceCurrency: show.currency,
      availability: soldOut ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    },
    ...(lineup.some((item) => item.artist)
      ? {
          performer: lineup
            .filter((item) => item.artist)
            .map((item) => ({ '@type': 'Person', name: item.artist!.stage_name ?? item.artist!.full_name })),
        }
      : {}),
  }

  return (
    <main className="public-shell min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader transparent tone="light" eventsHref={clubHref} />

      <section className="mx-auto max-w-5xl px-4 pb-16 pt-20 md:px-8 md:pt-24">
        <Link href={clubHref} className="mb-4 inline-flex w-fit items-center gap-2 text-sm font-medium text-zinc-500 transition-colors hover:text-vipps-orange-80">
          <ArrowLeft className="size-4" /> Tilbake til {show.clubName ?? 'klubbens program'}
        </Link>

        <article className="overflow-hidden rounded-2xl border border-border bg-white">
          <div className="grid md:grid-cols-2 md:items-start">
            <div className="relative isolate border-b border-border md:border-b-0 md:border-r">
              {show.poster_url ? (
                <NaturalPosterImage
                  src={show.poster_url}
                  alt={show.title}
                  preload
                  sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 512px"
                  className="relative w-full"
                />
              ) : (
                <div className="flex aspect-[2/3] flex-col justify-between bg-black p-8 text-white">
                  <span className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-400">humor.events</span>
                  <strong className="text-4xl font-medium leading-none">{show.title}</strong>
                </div>
              )}

              {ticketWarning && (
                <span className={`absolute right-4 top-4 z-10 rounded-full border border-border px-4 py-1.5 text-xs font-bold uppercase tracking-[0.22em] shadow-sm md:right-5 md:top-5 ${soldOut ? 'bg-black text-white' : 'bg-vipps-orange text-white'}`}>
                  {ticketWarning}
                </span>
              )}
            </div>

            <div className="min-w-0 flex flex-col gap-7 p-5 sm:p-7 md:p-9">
              {showClub && (
                <div className="inline-flex w-fit rounded-xl border border-border px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-zinc-700">
                  {showClub}
                </div>
              )}
              <h1 className="min-w-0 max-w-full text-[clamp(1.5rem,4.2vw,3rem)] font-medium leading-tight tracking-normal [hyphens:none] [overflow-wrap:normal] [word-break:keep-all]">{show.title}</h1>

              <dl className="divide-y divide-border border-y border-border">
                {showClub && <Info label="Klubb" text={showClub} />}
                <Info label="Sted" text={showLocation ?? 'Sted kommer'} />
                <Info label="Dato" text={formatShowDate(show.date)} />
                <Info label="Tid" text={formatShowTime(show)} />
                <Info label="Status" text={availabilityText} tone={soldOut ? 'danger' : ticketWarning ? 'accent' : 'default'} />
              </dl>

              <div className="mt-auto">
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div>
                    <div className="mb-1 text-xs font-bold uppercase tracking-widest text-zinc-500">Pris</div>
                    <div className="text-4xl font-medium leading-none">{formatTicketPrice(show)}</div>
                  </div>
                  {ticketWarning && <div className={`text-sm font-bold uppercase tracking-[0.22em] ${soldOut ? 'text-black' : 'text-vipps-orange-80'}`}>{ticketWarning}</div>}
                </div>

                {error === 'sold-out' && <p className="mb-3 text-sm font-medium text-black">Dette showet er utsolgt.</p>}
                {error === 'checkout' && <p className="mb-3 text-sm font-medium text-zinc-500">Betalingen kunne ikke åpnes akkurat nå.</p>}
                <ToastActionForm action={startCheckoutAction}>
                  <input type="hidden" name="show_id" value={show.id} />
                  <input type="hidden" name="slug" value={show.slug} />
                  <input type="hidden" name="club_slug" value={show.clubSlug ?? ''} />
                  <button
                    type="submit"
                    disabled={soldOut}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-transparent bg-vipps-orange px-10 py-4 text-sm font-medium uppercase tracking-[0.22em] text-white transition-colors hover:bg-vipps-orange-60 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Ticket className="size-4" /> {soldOut ? 'Utsolgt' : 'Kjøp billett'}
                  </button>
                </ToastActionForm>
                <p className="mt-3 text-xs text-zinc-500">{show.ticket_url ? 'Du sendes videre til ekstern billettside.' : 'Betaling åpnes i sikker checkout.'}</p>
              </div>
            </div>
          </div>
        </article>

        <div className="mt-10 grid gap-8 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <section className="order-2 md:order-1 bg-white p-5 sm:p-6">
            <div className="mb-5 flex items-end justify-between gap-4 border-b border-border pb-3">
              <h2 className="text-base font-medium uppercase tracking-widest text-zinc-500">Lineup</h2>
              <span className="text-sm font-medium text-zinc-400">{lineup.length} artist{lineup.length === 1 ? '' : 'er'}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-1">
              {lineup.map((item) => {
                // Only artists with a public (approved) profile get a link — others
                // would 404. A null artist renders as a plain, non-interactive card.
                const displayName = item.artist?.stage_name ?? item.artist?.full_name ?? 'Artist'
                const initial = (item.artist?.stage_name ?? item.artist?.full_name ?? '?')[0]
                const baseClass = 'grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-border bg-white p-2'
                const inner = (
                  <>
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-border bg-zinc-100">
                      {item.artist?.profile_image_url ? (
                        <Image
                          src={item.artist.profile_image_url}
                          alt={displayName}
                          fill
                          sizes="64px"
                          unoptimized={shouldBypassImageOptimization(item.artist.profile_image_url)}
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-black text-lg font-medium text-white">
                          {initial}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">{item.role?.role_name ?? 'Artist'}</div>
                      <h3 className="truncate text-base font-medium transition-colors group-hover:text-vipps-orange-80">{displayName}</h3>
                    </div>
                  </>
                )

                return item.artist ? (
                  <Link
                    key={item.spot.id}
                    href={`/artists/${item.artist.id}`}
                    className={`group ${baseClass} transition hover:-translate-y-0.5 hover:shadow-md`}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={item.spot.id} className={baseClass}>
                    {inner}
                  </div>
                )
              })}
              {lineup.length === 0 && (
                <p className="pt-2 text-sm font-medium text-zinc-400">Lineup annonseres snart.</p>
              )}
            </div>
          </section>

          <section className="order-1 md:order-2 bg-white p-5 sm:p-6">
            <h2 className="mb-5 border-b border-border pb-3 text-base font-medium uppercase tracking-widest text-zinc-500">Om showet</h2>
            <p className="whitespace-pre-wrap leading-relaxed text-zinc-600">{show.description ?? 'Mer informasjon kommer snart.'}</p>
          </section>
        </div>
      </section>
      <Footer />
    </main>
  )
}

function Info({ text, label, tone = 'default' }: { text: string; label?: string; tone?: 'default' | 'accent' | 'danger' }) {
  const valueClassName = tone === 'danger' ? 'text-black' : tone === 'accent' ? 'text-vipps-orange-80' : 'text-black'

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      {label && <span className="shrink-0 text-xs font-medium uppercase tracking-widest text-zinc-400">{label}</span>}
      <span className={`text-right text-base font-medium ${valueClassName}`}>{text}</span>
    </div>
  )
}
