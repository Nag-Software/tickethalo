import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import { TicketOrder } from '@/components/public/ticket-order'
import {
  formatShortDate,
  formatShowDate,
  formatShowTime,
  formatTicketPrice,
  getPublicLineup,
  getPublishedShowBySlug,
  remainingTickets,
  ticketFillPercent,
} from '@/lib/public-events'
import { ticketSalesNote } from '@/lib/ticket-sales-display'
import { cn, shouldBypassImageOptimization } from '@/lib/utils'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import { NaturalPosterImage } from '@/components/public/natural-poster-image'
import { showVenue } from '@/lib/show-venue'
import { MAX_TICKETS_PER_ORDER } from '@/lib/tickets'

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ tickets?: string }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const show = await getPublishedShowBySlug(slug)
  if (!show) return { title: 'Event not found — Tickethalo' }
  const description = show.description ?? `${show.title} at ${showVenue(show).venue ?? 'Tickethalo'} on ${formatShowDate(show.date)}.`
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

export default async function EventDetailPage({ params, searchParams }: Props) {
  const { slug } = await params
  // Satt av avbruddssiden (`/checkout/cancel`): kjøperen som gikk ut av
  // betalingen kommer tilbake til arket med det samme antallet.
  const { tickets } = await searchParams
  const resumeQuantity = Math.floor(Number(tickets))
  const resume = resumeQuantity >= 1 && resumeQuantity <= MAX_TICKETS_PER_ORDER
  const show = await getPublishedShowBySlug(slug)
  if (!show) notFound()

  const lineup = await getPublicLineup(show.id)
  const remaining = remainingTickets(show)
  const soldOut = remaining === 0
  const fillPercent = ticketFillPercent(show)
  // Navn og adresse: kjøperen skal finne fram, ikke bare vite hva stedet heter.
  const showLocation = showVenue(show).line
  // Byen legges bare til når adressen ikke allerede har den — ellers står
  // «4006 Stavanger, Stavanger».
  const city = show.clubCity?.trim()
  const place =
    city && !showLocation?.toLowerCase().includes(city.toLowerCase())
      ? [showLocation, city].filter(Boolean).join(', ')
      : showLocation
  // Worked out on the server when the page was fetched — see `withTicketCounts`.
  const salesOpen = show.salesState.kind === 'open'

  // The same calm microcopy as on the cards in the list, instead of a badge.
  // No urgency while sales are not open: the button already says why.
  const capacity = soldOut
    ? { text: 'Sold out', urgent: false }
    : !salesOpen
      ? null
      : remaining !== null && remaining <= 10
        ? { text: `Only ${remaining} left`, urgent: true }
        : fillPercent >= 80
          ? { text: 'Almost sold out', urgent: true }
          : null

  const price = formatTicketPrice(show)
  const orderSummary = [formatShortDate(show.date), show.start_time?.slice(0, 5), showVenue(show).venue]
    .filter(Boolean)
    .join(' · ')
  // The line under the button. Before sales open it says exactly when, which the
  // short button label has no room for. Where nothing can be bought it says
  // nothing — "Payment opens in secure checkout" under a disabled button is noise.
  const checkoutNote = !salesOpen
    ? ticketSalesNote(show.salesState)
    : soldOut
      ? null
      : show.ticket_url
        ? 'You will be sent on to an external ticket page.'
        : 'Secure checkout · pay by card'

  const buyButton = (full?: boolean) => (
    <TicketOrder
      showId={show.id}
      slug={show.slug}
      title={show.title}
      summary={orderSummary}
      ticketPrice={show.ticket_price}
      currency={show.currency}
      external={Boolean(show.ticket_url)}
      soldOut={soldOut}
      salesState={show.salesState}
      remaining={remaining}
      full={full}
      initialQuantity={resume ? resumeQuantity : 1}
      autoOpen={resume}
    />
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

        {/* The poster column is sized from the window height, not a fixed 400px:
            the buy block sits under the poster in the same sticky column, and a
            column taller than the window would hide it. 20rem is the header
            offset plus the block; 0.667 is a 2:3 poster, the tallest we see.
            Sizing the column — rather than capping the poster inside it — keeps
            poster and buy block the same width and hands the rest to the text. */}
        <div className="grid gap-8 lg:grid-cols-[clamp(280px,calc((100svh_-_20rem)_*_0.667),400px)_minmax(0,1fr)] lg:gap-14">
          {/* Poster. Not cropped here — on the show page the whole poster is the point. */}
          {/* Sticky only where the column fits: below ~46rem of height the 280px
              floor makes it taller than the window, and a stuck column would
              cut the buy block off. There it scrolls with the page instead. */}
          <div className="flex flex-col gap-4 lg:self-start lg:[@media(min-height:46rem)]:sticky lg:[@media(min-height:46rem)]:top-24">
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

            {/* Buy block — hidden on mobile, where the fixed bottom bar takes
                over. It lives in the sticky poster column so price and action
                stay in view while the description and line-up scroll. */}
            <div
              className="hidden flex-col gap-3.5 bg-[var(--ev-card)] p-5 lg:flex"
              style={{ borderRadius: 'var(--ev-r-card)' }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="text-[28px] font-semibold leading-none tabular-nums">{price}</div>
                {capacity && (
                  <div
                    className={cn(
                      'text-[13px]',
                      capacity.urgent ? 'font-medium text-[var(--ev-accent)]' : 'text-[var(--ev-faint)]'
                    )}
                  >
                    {capacity.text}
                  </div>
                )}
              </div>
              {buyButton(true)}
              {checkoutNote && <p className="text-center text-[12px] text-[var(--ev-faint)]">{checkoutNote}</p>}
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

              <ul className="flex flex-col gap-1 text-[17px] text-[var(--ev-muted)] sm:text-[15px]">
                {[formatShowDate(show.date), formatShowTime(show).replace('-', ' – '), place].map(
                  (line) =>
                    line && (
                      <li key={line} className="flex gap-2">
                        <span aria-hidden>·</span>
                        {line}
                      </li>
                    )
                )}
              </ul>

              {/* On mobile the buy block is hidden and the bottom bar has no room
                  for the full date and time sales open, so it goes here. */}
              {!salesOpen && checkoutNote && (
                <p className="text-[15px] text-[var(--ev-faint)] lg:hidden">{checkoutNote}</p>
              )}
            </header>

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
