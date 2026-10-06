import Link from 'next/link'
import { XCircle } from 'lucide-react'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import { formatShortDate, formatTicketPrice, getPublishedShowBySlug, remainingTickets } from '@/lib/public-events'
import { showVenue } from '@/lib/show-venue'
import { MAX_TICKETS_PER_ORDER } from '@/lib/tickets'

export const metadata = { title: 'Payment cancelled — Tickethalo' }

export default async function CheckoutCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string; tickets?: string }>
}) {
  const { event, tickets } = await searchParams
  const eventHref = event ? `/events/${event}` : '/events'

  // Ordren kjøperen gikk ut av. Uten den måtte hun tilbake til showet, åpne
  // kjøpet og velge antall på nytt — her er det ett trykk. Kan billettene ikke
  // lenger kjøpes (utsolgt, salget stengt), vises bare veien tilbake.
  const show = event ? await getPublishedShowBySlug(event) : null
  const requested = Math.floor(Number(tickets))
  const quantity = requested >= 1 && requested <= MAX_TICKETS_PER_ORDER ? requested : 1
  const remaining = show ? remainingTickets(show) : null
  const order =
    show && !show.ticket_url && show.salesState.kind === 'open' && (remaining === null || remaining >= quantity)
      ? {
          title: show.title,
          summary: [formatShortDate(show.date), show.start_time?.slice(0, 5), showVenue(show).venue]
            .filter(Boolean)
            .join(' · '),
          total: formatTicketPrice({ ticket_price: (show.ticket_price ?? 0) * quantity, currency: show.currency }),
          href: `${eventHref}?tickets=${quantity}`,
        }
      : null

  return (
    <main
      // The document root is still lang="nb" for the Norwegian portals — see
      // app/page.tsx for why this page declares its own language.
      lang="en"
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <section className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-24 md:px-8">
        <div
          className="bg-[var(--ev-card)] p-7 sm:p-9"
          style={{ borderRadius: 'var(--ev-r-card)' }}
        >
          <XCircle className="size-10 text-[var(--ev-faint)]" aria-hidden />
          <h1 className="mt-5 text-balance text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
            The payment was cancelled
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--ev-muted)]">
            Nothing has been charged. The ticket is not reserved, so the seat may be taken by
            someone else — go back to the show if you want to try again.
          </p>

          {order && (
            <div className="mt-6 flex flex-col gap-1 border-y border-[var(--ev-line)] py-4">
              <div className="text-[17px] font-semibold">{order.title}</div>
              <div className="text-[15px] text-[var(--ev-muted)]">{order.summary}</div>
              <div className="mt-2 flex justify-between gap-4 text-[16px]">
                <span>
                  {quantity} {quantity === 1 ? 'ticket' : 'tickets'}
                </span>
                <span className="font-semibold tabular-nums">{order.total}</span>
              </div>
            </div>
          )}

          <div className="mt-7 flex flex-wrap gap-2.5">
            {order && (
              <Link
                href={order.href}
                className="inline-flex h-12 w-full items-center justify-center bg-[var(--ev-accent-fill)] px-5 text-[16px] font-semibold text-[var(--ev-accent-ink)] transition-colors hover:bg-[var(--ev-text)] hover:text-[var(--ev-bg)]"
                style={{ borderRadius: 'var(--ev-r-chip)' }}
              >
                Try again · {order.total}
              </Link>
            )}
            <Link
              href={eventHref}
              className={
                order
                  ? 'inline-flex h-11 items-center justify-center px-5 text-[13px] font-semibold text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line-strong)] transition-colors hover:text-[var(--ev-text)]'
                  : 'inline-flex h-11 items-center justify-center bg-[var(--ev-text)] px-5 text-[13px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]'
              }
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              Back to the show
            </Link>
            <Link
              href="/events"
              className="inline-flex h-11 items-center justify-center px-5 text-[13px] font-semibold text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line-strong)] transition-colors hover:text-[var(--ev-text)]"
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              All shows
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
