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
 * Ett kort for ett show — brukt både på forsiden (mørk) og på /events (lys).
 * Farger leses fra `.ev-surface`-variablene, så tonen bestemmes av forelderen.
 *
 * Layout: rad på mobil (96px plakat + tekst), kolonne fra `sm` og opp der
 * plakaten fyller hele bredden. Plakaten har ingen ramme rundt seg — kortet
 * er kunsten, ikke en boks rundt kunsten.
 */

/** Kapasitet som rolig mikrotekst, ikke som merke. Null når det ikke haster. */
function capacityNote(show: PublicShow): { text: string; urgent: boolean } | null {
  const remaining = remainingTickets(show)
  if (remaining === 0) return { text: 'Utsolgt', urgent: false }

  const fill = ticketFillPercent(show)
  if (remaining !== null && remaining <= 10) return { text: `${remaining} igjen`, urgent: true }
  if (fill >= 80) return { text: 'Nær utsolgt', urgent: true }
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
    <article className="group relative flex gap-4 sm:block">
      {/* Plakat */}
      <div
        className="relative w-24 shrink-0 overflow-hidden sm:w-full"
        style={{ borderRadius: 'var(--ev-r-art)' }}
      >
        <div className="relative aspect-[2/3] bg-[var(--ev-poster-ground)]">
          {show.poster_url ? (
            <Image
              src={show.poster_url}
              alt=""
              fill
              priority={priority}
              sizes="(max-width: 640px) 96px, (max-width: 1024px) 45vw, 23vw"
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.015]"
            />
          ) : (
            <div className="flex h-full flex-col justify-between p-3 text-white sm:p-4">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">humor.events</span>
              <strong className="text-sm font-medium leading-tight sm:text-2xl">{show.title}</strong>
            </div>
          )}
          {/* Hårkant som tennes ved hover — E5 */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/10 transition-colors duration-300 group-hover:ring-[var(--ev-accent-fill)]/60"
            style={{ borderRadius: 'var(--ev-r-art)' }}
          />
        </div>
      </div>

      {/* Tekst */}
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:mt-3.5">
        <div className="flex items-baseline gap-2 text-[13px] text-[var(--ev-muted)]">
          <span className="font-medium text-[var(--ev-text)]">{formatDayLabel(show.date, today)}</span>
          <span aria-hidden className="text-[var(--ev-faint)]">·</span>
          <span>{formatShowTime(show)}</span>
        </div>

        <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[var(--ev-text)] sm:text-base">
          {/* Strukket lenke: hele kortet er klikkbart, men kun én lenke i DOM-en */}
          <Link href={href} className="after:absolute after:inset-0 after:content-['']">
            {show.title}
          </Link>
        </h3>

        {show.clubName && (
          <div className="flex items-center gap-1.5 text-[13px] text-[var(--ev-muted)]">
            {show.clubLogoUrl ? (
              <Image
                src={show.clubLogoUrl}
                alt=""
                width={16}
                height={16}
                className="size-4 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="grid size-4 shrink-0 place-content-center rounded-full bg-[var(--ev-card-hover)] text-[8px] font-bold text-[var(--ev-muted)]"
              >
                {show.clubName.slice(0, 1)}
              </span>
            )}
            <span className="truncate">Av {show.clubName}</span>
          </div>
        )}

        {place && <p className="truncate text-[13px] text-[var(--ev-faint)]">{place}</p>}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="text-[13px] font-medium tabular-nums text-[var(--ev-text)]">
            {formatTicketPrice(show)}
          </span>
          {capacity && (
            <span
              className={cn(
                'text-[13px]',
                capacity.urgent ? 'text-[var(--ev-accent)]' : 'text-[var(--ev-faint)]'
              )}
            >
              {capacity.text}
            </span>
          )}
        </div>

        {/* Én handling — kortet i seg selv er lenken til showsiden */}
        <ToastActionForm action={startCheckoutAction} className="relative z-10 mt-2.5">
          <input type="hidden" name="show_id" value={show.id} />
          <input type="hidden" name="slug" value={show.slug ?? show.id} />
          <button
            type="submit"
            disabled={soldOut}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 px-4 text-[13px] font-semibold transition-colors',
              'bg-[var(--ev-text)] text-[var(--ev-bg)]',
              'hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
              'disabled:cursor-not-allowed disabled:bg-[var(--ev-card-hover)] disabled:text-[var(--ev-faint)] disabled:hover:bg-[var(--ev-card-hover)]'
            )}
            style={{ borderRadius: 'var(--ev-r-chip)' }}
          >
            <Ticket className="size-4" />
            {soldOut ? 'Utsolgt' : 'Kjøp billett'}
          </button>
        </ToastActionForm>
      </div>
    </article>
  )
}
