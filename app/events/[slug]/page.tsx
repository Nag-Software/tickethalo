import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft, Ticket } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import { startCheckoutAction } from '../actions'
import {
  formatShowDate,
  formatShowTime,
  formatTicketPrice,
  getPublicLineup,
  getPublishedShowBySlug,
  remainingTickets,
  ticketFillPercent,
} from '@/lib/public-events'
import { cn, shouldBypassImageOptimization } from '@/lib/utils'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import { NaturalPosterImage } from '@/components/public/natural-poster-image'

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ error?: string }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const show = await getPublishedShowBySlug(slug)
  if (!show) return { title: 'Event ikke funnet — humor.events' }
  const description = show.description ?? `${show.title} på ${show.venue_name ?? show.venue_address ?? 'humor.events'} ${formatShowDate(show.date)}.`
  const canonical = `/events/${show.slug}`

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

export default async function EventDetailPage({ params, searchParams }: Props) {
  const [{ slug }, { error }] = await Promise.all([params, searchParams])
  const show = await getPublishedShowBySlug(slug)
  if (!show) notFound()

  const lineup = await getPublicLineup(show.id)
  const remaining = remainingTickets(show)
  const soldOut = remaining === 0
  const fillPercent = ticketFillPercent(show)
  const showLocation = show.venue_name ?? show.venue_address

  // Samme rolige mikrotekst som på kortene i listen, i stedet for et merke.
  const capacity = soldOut
    ? { text: 'Utsolgt', urgent: false }
    : remaining !== null && remaining <= 10
      ? { text: `Bare ${remaining} igjen`, urgent: true }
      : fillPercent >= 80
        ? { text: 'Nær utsolgt', urgent: true }
        : null

  const price = formatTicketPrice(show)
  const checkoutNote = show.ticket_url
    ? 'Du sendes videre til ekstern billettside.'
    : 'Betaling åpnes i sikker checkout.'

  const buyButton = (full?: boolean) => (
    <ToastActionForm action={startCheckoutAction} className={full ? 'w-full' : undefined}>
      <input type="hidden" name="show_id" value={show.id} />
      <input type="hidden" name="slug" value={show.slug} />
      <button
        type="submit"
        disabled={soldOut}
        className={cn(
          'inline-flex h-12 items-center justify-center gap-2 px-7 text-[14px] font-semibold transition-colors',
          full && 'w-full',
          'bg-[var(--ev-text)] text-[var(--ev-bg)]',
          'hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
          'disabled:cursor-not-allowed disabled:bg-[var(--ev-card-hover)] disabled:text-[var(--ev-faint)] disabled:hover:bg-[var(--ev-card-hover)]'
        )}
        style={{ borderRadius: 'var(--ev-r-chip)' }}
      >
        <Ticket className="size-4" /> {soldOut ? 'Utsolgt' : 'Kjøp billett'}
      </button>
    </ToastActionForm>
  )

  return (
    <main
      className="ev-surface min-h-screen bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      {/* pb-28 på mobil gir plass til den faste kjøpslinja nederst */}
      <div className="mx-auto max-w-5xl px-4 pb-28 pt-24 md:px-8 md:pt-28 lg:pb-24">
        <Link
          href="/events"
          className="mb-7 inline-flex w-fit items-center gap-2 text-[13px] text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)]"
        >
          <ArrowLeft className="size-4" /> Alle show
        </Link>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-14">
          {/* Plakat. Ikke beskåret her — på showsiden er hele plakaten poenget. */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            {/* Full bredde ville gitt ~66vh plakat på mobil, så tittel og pris
                lå under skjermkanten. Bredden knyttes til høyden i stedet. */}
            <div
              className="mx-auto w-full max-w-[min(100%,34vh)] overflow-hidden bg-[var(--ev-poster-ground)] lg:mx-0 lg:max-w-none"
              style={{ borderRadius: 'var(--ev-r-card)' }}
            >
              {show.poster_url ? (
                <NaturalPosterImage
                  src={show.poster_url}
                  alt={show.title}
                  priority
                  sizes="(max-width: 1024px) 60vw, 400px"
                  className="relative w-full"
                />
              ) : (
                <div className="flex aspect-[2/3] flex-col justify-between p-7 text-white">
                  <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/45">
                    humor.events
                  </span>
                  <strong className="text-3xl font-medium leading-tight">{show.title}</strong>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-8">
            <header className="flex flex-col gap-3">
              {show.clubName && (
                <div className="flex items-center gap-2 text-[14px] text-[var(--ev-muted)]">
                  {show.clubLogoUrl ? (
                    <Image
                      src={show.clubLogoUrl}
                      alt=""
                      width={20}
                      height={20}
                      className="size-5 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="grid size-5 shrink-0 place-content-center rounded-full bg-[var(--ev-card-hover)] text-[9px] font-bold"
                    >
                      {show.clubName.slice(0, 1)}
                    </span>
                  )}
                  Av {show.clubName}
                </div>
              )}

              <h1 className="text-balance text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-5xl">
                {show.title}
              </h1>

              <p className="text-[15px] text-[var(--ev-muted)]">
                {formatShowDate(show.date)} · {formatShowTime(show)}
                {showLocation && <> · {showLocation}</>}
                {show.clubCity && <>, {show.clubCity}</>}
              </p>
            </header>

            {/* Kjøpsblokk — skjult på mobil, der den faste bunnlinja tar over */}
            <div
              className="hidden flex-wrap items-center gap-x-6 gap-y-4 bg-[var(--ev-card)] p-6 lg:flex"
              style={{ borderRadius: 'var(--ev-r-card)' }}
            >
              <div>
                <div className="text-[28px] font-semibold leading-none tabular-nums">{price}</div>
                {capacity && (
                  <div
                    className={cn(
                      'mt-1.5 text-[13px]',
                      capacity.urgent ? 'text-[var(--ev-accent)]' : 'text-[var(--ev-faint)]'
                    )}
                  >
                    {capacity.text}
                  </div>
                )}
              </div>
              <div className="ml-auto flex flex-col items-end gap-2">
                {buyButton()}
                <p className="text-[12px] text-[var(--ev-faint)]">{checkoutNote}</p>
              </div>
            </div>

            {error === 'sold-out' && (
              <p className="text-[14px] font-medium text-[var(--ev-accent)]">Dette showet er utsolgt.</p>
            )}
            {error === 'checkout' && (
              <p className="text-[14px] text-[var(--ev-muted)]">Checkout kunne ikke åpnes akkurat nå.</p>
            )}

            <Section title="Om showet">
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--ev-muted)]">
                {show.description ?? 'Mer informasjon kommer snart.'}
              </p>
            </Section>

            <Section
              title="Line-up"
              aside={lineup.length > 0 ? `${lineup.length} ${lineup.length === 1 ? 'komiker' : 'komikere'}` : undefined}
            >
              {lineup.length === 0 ? (
                <p className="text-[15px] text-[var(--ev-faint)]">Line-up annonseres snart.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {lineup.map((item) => {
                    const name = item.artist?.stage_name ?? item.artist?.full_name ?? 'Artist'
                    const inner = (
                      <>
                        <span className="relative size-11 shrink-0 overflow-hidden rounded-full bg-[var(--ev-card-hover)]">
                          {item.artist?.profile_image_url ? (
                            <Image
                              src={item.artist.profile_image_url}
                              alt=""
                              fill
                              sizes="44px"
                              unoptimized={shouldBypassImageOptimization(item.artist.profile_image_url)}
                              className="object-cover"
                            />
                          ) : (
                            <span className="grid h-full place-content-center text-[15px] font-medium text-[var(--ev-muted)]">
                              {name[0]}
                            </span>
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-medium">{name}</span>
                          <span className="block truncate text-[13px] text-[var(--ev-faint)]">
                            {item.role?.role_name ?? 'Artist'}
                          </span>
                        </span>
                      </>
                    )

                    return (
                      <li key={item.spot.id}>
                        {item.artist ? (
                          <Link
                            href={`/artists/${item.artist.id}`}
                            className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-[var(--ev-card)]"
                          >
                            {inner}
                          </Link>
                        ) : (
                          <div className="flex items-center gap-3 px-2 py-2">{inner}</div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </Section>
          </div>
        </div>
      </div>

      {/* Fast kjøpslinje på mobil — prisen og handlingen alltid innen rekkevidde */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-4 border-t border-[var(--ev-line)] bg-[var(--ev-bg)]/92 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="min-w-0">
          <div className="text-[17px] font-semibold leading-none tabular-nums">{price}</div>
          {capacity && (
            <div
              className={cn(
                'mt-1 truncate text-[12px]',
                capacity.urgent ? 'text-[var(--ev-accent)]' : 'text-[var(--ev-faint)]'
              )}
            >
              {capacity.text}
            </div>
          )}
        </div>
        <div className="ml-auto shrink-0">{buyButton()}</div>
      </div>

      <Footer />
    </main>
  )
}

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4 border-b border-[var(--ev-line)] pb-2.5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {aside && <span className="text-[13px] text-[var(--ev-faint)]">{aside}</span>}
      </div>
      {children}
    </section>
  )
}
