import Image from 'next/image'
import Link from 'next/link'
import { Ticket } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ToastActionForm } from '@/components/toast-action-form'
import { startCheckoutAction } from '@/app/events/actions'
import type { PublicShow } from '@/lib/public-events'
import { formatShowTime, formatTicketPrice, remainingTickets, ticketFillPercent } from '@/lib/public-events'
import { formatDayLabel } from '@/lib/event-filters'

/**
 * One card for one show — used both on the front page (dark) and on /events (light).
 * Colours are read from the `.ev-surface` variables, so the parent decides the tone.
 *
 * Layout: a row on mobile (104px poster + text), a column from `sm` up where the
 * poster fills the full width. The poster has no frame around it — the card is
 * the artwork, not a box around the artwork.
 *
 * The type scale splits at `sm`: the mobile row is lifted to at least 15px, while
 * the column from `sm` up keeps the tighter scale — there the cards sit four or
 * five across, and large text would burst them.
 */

/** Capacity as calm microcopy, not as a badge. Null when there is no urgency. */
function capacityNote(show: PublicShow): { text: string; urgent: boolean } | null {
  const remaining = remainingTickets(show)
  if (remaining === 0) return { text: 'Sold out', urgent: false }

  const fill = ticketFillPercent(show)
  if (remaining !== null && remaining <= 10) return { text: `${remaining} left`, urgent: true }
  if (fill >= 80) return { text: 'Almost sold out', urgent: true }
  return null
}

export function EventCard({
  show,
  today,
  priority = false,
}: {
  show: PublicShow
  today: string
  priority?: boolean
}) {
  const href = `/events/${show.slug ?? show.id}`
  const soldOut = remainingTickets(show) === 0
  const capacity = capacityNote(show)
  const venue = show.venue_name ?? show.venue_address
  const place = [venue, show.clubCity].filter(Boolean).join(', ')

  return (
    // sm:flex-col rather than sm:block, so the price line can be pushed down
    // with mt-auto and the buy buttons line up across a row of cards.
    <article className="group relative flex gap-3.5 sm:h-full sm:flex-col sm:gap-0">
      {/* Poster */}
      <div
        className="relative w-[104px] shrink-0 self-start overflow-hidden sm:w-full sm:self-auto"
        style={{ borderRadius: 'var(--ev-r-art)' }}
      >
        <div className="relative aspect-[2/3] bg-[var(--ev-poster-ground)]">
          {show.poster_url ? (
            <Image
              src={show.poster_url}
              alt=""
              fill
              priority={priority}
              sizes="(max-width: 640px) 104px, (max-width: 1024px) 45vw, 23vw"
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.015]"
            />
          ) : (
            <div className="flex h-full flex-col justify-between p-3 text-white sm:p-4">
              <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/60">Tickethalo</span>
              <strong className="text-[15px] font-medium leading-tight sm:text-2xl">{show.title}</strong>
            </div>
          )}
          {/* Hairline edge that lights up on hover — E5 */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10 transition-colors duration-300 group-hover:ring-[var(--ev-accent-fill)]/60"
            style={{ borderRadius: 'var(--ev-r-art)' }}
          />
        </div>
      </div>

      {/* Text. On mobile the row is a list, not a card — but every line stands
          on its own, with no merging to save height. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:mt-3.5">
        <div className="flex items-baseline gap-2 text-[15px] text-[var(--ev-muted)] sm:text-[13px]">
          <span className="font-medium text-[var(--ev-text)]">{formatDayLabel(show.date, today)}</span>
          <span aria-hidden className="text-[var(--ev-faint)]">·</span>
          <span className="truncate">{formatShowTime(show)}</span>
        </div>

        <h3 className="text-[19px] font-semibold leading-snug tracking-[-0.01em] text-[var(--ev-text)] sm:text-base">
          {/* Stretched link: the whole card is clickable, but only one link in the DOM */}
          <Link href={href} className="line-clamp-2 after:absolute after:inset-0 after:content-['']">
            {show.title}
          </Link>
        </h3>

        {show.clubName && (
          // `relative z-10` lifts the club link above the title's stretched
          // link, the same trick the buy button below uses.
          <div className="relative z-10 flex w-fit max-w-full items-center gap-2 text-[15px] text-[var(--ev-muted)] sm:gap-1.5 sm:text-[13px]">
            {show.clubLogoUrl ? (
              <Image
                src={show.clubLogoUrl}
                alt=""
                width={20}
                height={20}
                className="size-5 shrink-0 rounded-full object-cover sm:size-4"
              />
            ) : (
              <span
                aria-hidden
                className="grid size-5 shrink-0 place-content-center rounded-full bg-[var(--ev-card-hover)] text-[10px] font-bold text-[var(--ev-muted)] sm:size-4 sm:text-[8px]"
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
              <span className="truncate">By {show.clubName}</span>
            )}
          </div>
        )}

        {/* Venue and city on their own line, on mobile too. The city used to be
            glued to the end of the club line to save height — at a readable font
            size it simply got truncated, and one more line is cheaper than
            hiding where the show actually is. */}
        {place && <p className="truncate text-[15px] text-[var(--ev-faint)] sm:text-[13px]">{place}</p>}

        {/* Price, capacity and the only action on one line.
            mt-auto aligns the buy buttons to the bottom across a row. */}
        <div className="mt-auto flex items-center gap-x-3 pt-2.5 sm:gap-x-2.5">
          <span className="text-[17px] font-semibold tabular-nums text-[var(--ev-text)] sm:text-[13px] sm:font-medium">
            {formatTicketPrice(show)}
          </span>
          {capacity && (
            <span
              className={cn(
                'truncate text-[15px] sm:text-[13px]',
                capacity.urgent ? 'font-medium text-[var(--ev-accent)]' : 'text-[var(--ev-faint)]'
              )}
            >
              {capacity.text}
            </span>
          )}

          <ToastActionForm action={startCheckoutAction} className="relative z-10 ml-auto">
            <input type="hidden" name="show_id" value={show.id} />
            <input type="hidden" name="slug" value={show.slug ?? show.id} />
            <button
              type="submit"
              disabled={soldOut}
              className={cn(
                // h-11 = a 44px touch target on mobile, the minimum for a primary
                // action driven by a thumb. From sm up it is a mouse pointer and the
                // cards sit four or five across — there the original height is right.
                'inline-flex h-11 items-center gap-2 px-4 text-[15px] font-semibold transition-colors',
                'sm:h-9 sm:gap-1.5 sm:text-[13px]',
                'bg-[var(--ev-text)] text-[var(--ev-bg)]',
                'hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
                'disabled:cursor-not-allowed disabled:bg-[var(--ev-card-hover)] disabled:text-[var(--ev-faint)] disabled:hover:bg-[var(--ev-card-hover)]'
              )}
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              <Ticket className="size-4 sm:size-3.5" aria-hidden />
              {soldOut ? 'Sold out' : 'Buy'}
              {/* Without this a screen reader just reads "Buy" twenty times in a row. */}
              <span className="sr-only"> ticket for {show.title}</span>
            </button>
          </ToastActionForm>
        </div>
      </div>
    </article>
  )
}
