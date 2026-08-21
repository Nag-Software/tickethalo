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
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const show = await getPublishedShowBySlug(slug)
  if (!show) return { title: 'Event not found — Tickethalo' }
  const description = show.description ?? `${show.title} at ${show.venue_name ?? show.venue_address ?? 'Tickethalo'} on ${formatShowDate(show.date)}.`
  const canonical = `/events/${show.slug}`

  return {
    title: `${show.title} — Tickethalo`,
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

export default async function EventDetailPage({ params }: Props) {
  const { slug } = await params
  const show = await getPublishedShowBySlug(slug)
  if (!show) notFound()

  const lineup = await getPublicLineup(show.id)
  const remaining = remainingTickets(show)
  const soldOut = remaining === 0
  const fillPercent = ticketFillPercent(show)
  const showLocation = show.venue_name ?? show.venue_address

  // The same calm microcopy as on the cards in the list, instead of a badge.
  const capacity = soldOut
    ? { text: 'Sold out', urgent: false }
    : remaining !== null && remaining <= 10
      ? { text: `Only ${remaining} left`, urgent: true }
      : fillPercent >= 80
        ? { text: 'Almost sold out', urgent: true }
        : null

  const price = formatTicketPrice(show)
  const checkoutNote = show.ticket_url
    ? 'You will be sent on to an external ticket page.'
    : 'Payment opens in secure checkout.'

  const buyButton = (full?: boolean) => (
    <ToastActionForm action={startCheckoutAction} className={full ? 'w-full' : undefined}>
      <input type="hidden" name="show_id" value={show.id} />
      <input type="hidden" name="slug" value={show.slug} />
      <button
        type="submit"
        disabled={soldOut}
        className={cn(
          'inline-flex h-12 items-center justify-center gap-2 px-7 text-[16px] font-semibold transition-colors lg:text-[14px]',
          full && 'w-full',
          'bg-[var(--ev-text)] text-[var(--ev-bg)]',
          'hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
          'disabled:cursor-not-allowed disabled:bg-[var(--ev-card-hover)] disabled:text-[var(--ev-faint)] disabled:hover:bg-[var(--ev-card-hover)]'
        )}
        style={{ borderRadius: 'var(--ev-r-chip)' }}
      >
        <Ticket className="size-4" /> {soldOut ? 'Sold out' : 'Buy ticket'}
      </button>
    </ToastActionForm>
  )

  return (
    <main
      // The document root is still lang="nb" for the Norwegian portals — see
      // app/page.tsx for why this page declares its own language.
      lang="en"
      className="ev-surface min-h-screen bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      {/* pb-28 on mobile leaves room for the fixed buy bar at the bottom */}
      <div className="mx-auto max-w-5xl px-4 pb-28 pt-24 md:px-8 md:pt-28 lg:pb-24">
        <Link
          href="/events"
          className="-ml-2 mb-5 inline-flex h-11 w-fit items-center gap-2 rounded-full px-2 text-[15px] font-medium text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:ml-0 sm:mb-7 sm:h-auto sm:px-0 sm:text-[13px] sm:font-normal"
        >
          <ArrowLeft className="size-4" aria-hidden /> All shows
        </Link>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-14">
          {/* Poster. Not cropped here — on the show page the whole poster is the point. */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            {/* Full width would give a ~66vh poster on mobile, pushing the title
                and price below the fold. The width is tied to the height instead. */}
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
                  <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/60">
                    Tickethalo
                  </span>
                  <strong className="text-3xl font-medium leading-tight">{show.title}</strong>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-8">
            <header className="flex flex-col gap-3">
              {show.clubName && (
                <div className="flex w-fit max-w-full items-center gap-2 text-[16px] text-[var(--ev-muted)] sm:text-[14px]">
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
                  {show.clubSlug ? (
                    <Link
                      href={`/clubs/${show.clubSlug}`}
                      className="truncate underline-offset-4 transition-colors hover:text-[var(--ev-accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]"
                    >
                      By {show.clubName}
                    </Link>
                  ) : (
                    <>By {show.clubName}</>
                  )}
                </div>
              )}

              <h1 className="text-balance text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-5xl">
                {show.title}
              </h1>

              <p className="text-[17px] text-[var(--ev-muted)] sm:text-[15px]">
                {formatShowDate(show.date)} · {formatShowTime(show)}
                {showLocation && <> · {showLocation}</>}
                {show.clubCity && <>, {show.clubCity}</>}
              </p>
            </header>

            {/* Buy block — hidden on mobile, where the fixed bottom bar takes over */}
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
                      capacity.urgent ? 'font-medium text-[var(--ev-accent)]' : 'text-[var(--ev-faint)]'
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

            {/* Klubben er selger og arrangør av showet — Tickethalo formidler
                billetten. Kjøperen inngår avtalen med klubben, så det må stå
                der kjøpet skjer, ikke bare i vilkårene. */}
            {show.clubName && (
              <p className="text-[13px] leading-relaxed text-[var(--ev-faint)]">
                Organiser and seller: {show.clubLegalName ?? show.clubName}
                {show.clubOrgNumber ? ` (org. no. ${show.clubOrgNumber})` : ''}. The ticket is sold by
                the organiser; Tickethalo handles the ticketing —{' '}
                <Link href="/kjopsvilkar" className="underline underline-offset-2 hover:text-[var(--ev-text)]">
                  terms of purchase
                </Link>
                .
              </p>
            )}

            <Section title="About the show">
              <p className="whitespace-pre-wrap text-[17px] leading-relaxed text-[var(--ev-muted)] sm:text-[15px]">
                {show.description ?? 'More information coming soon.'}
              </p>
            </Section>

            <Section
              title="Line-up"
              aside={lineup.length > 0 ? `${lineup.length} ${lineup.length === 1 ? 'comedian' : 'comedians'}` : undefined}
            >
              {lineup.length === 0 ? (
                <p className="text-[17px] text-[var(--ev-faint)] sm:text-[15px]">Line-up announced soon.</p>
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
                          <span className="block truncate text-[17px] font-medium sm:text-[15px]">{name}</span>
                          <span className="block truncate text-[15px] text-[var(--ev-faint)] sm:text-[13px]">
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

      {/* Fixed buy bar on mobile — price and action always within reach */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-4 border-t border-[var(--ev-line)] bg-[var(--ev-bg)]/92 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="min-w-0">
          <div className="text-[20px] font-semibold leading-none tabular-nums">{price}</div>
          {capacity && (
            <div
              className={cn(
                'mt-1.5 truncate text-[14px]',
                capacity.urgent ? 'font-medium text-[var(--ev-accent)]' : 'text-[var(--ev-faint)]'
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
        <h2 className="text-[19px] font-semibold tracking-[-0.01em] sm:text-[15px]">{title}</h2>
        {aside && <span className="text-[15px] text-[var(--ev-faint)] sm:text-[13px]">{aside}</span>}
      </div>
      {children}
    </section>
  )
}
