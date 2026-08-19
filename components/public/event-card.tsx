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
    // sm:flex-col i stedet for sm:block, så prislinjen kan skyves ned med
    // mt-auto og kjøpsknappene står på linje på tvers av en rad kort.
    <article className="group relative flex gap-3.5 sm:h-full sm:flex-col sm:gap-0">
      {/* Plakat */}
      <div
        className="relative w-[88px] shrink-0 self-start overflow-hidden sm:w-full sm:self-auto"
        style={{ borderRadius: 'var(--ev-r-art)' }}
      >
        <div className="relative aspect-[2/3] bg-[var(--ev-poster-ground)]">
          {show.poster_url ? (
            <Image
              src={show.poster_url}
              alt=""
              fill
              priority={priority}
              sizes="(max-width: 640px) 88px, (max-width: 1024px) 45vw, 23vw"
              className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.015]"
            />
          ) : (
            <div className="flex h-full flex-col justify-between p-3 text-white sm:p-4">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">Tickethalo</span>
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

      {/* Tekst.
          På mobil er raden en liste, ikke et kort: byen slås sammen med
          klubblinja og scenenavnet vike helt, slik at én rad blir omtrent
          like høy som plakaten i stedet for dobbelt så høy. */}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:mt-3.5 sm:gap-1">
        <div className="flex items-baseline gap-2 text-[12.5px] text-[var(--ev-muted)] sm:text-[13px]">
          <span className="font-medium text-[var(--ev-text)]">{formatDayLabel(show.date, today)}</span>
          <span aria-hidden className="text-[var(--ev-faint)]">·</span>
          <span className="truncate">{formatShowTime(show)}</span>
        </div>

        <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-[var(--ev-text)] sm:text-base">
          {/* Strukket lenke: hele kortet er klikkbart, men kun én lenke i DOM-en */}
          <Link href={href} className="line-clamp-2 after:absolute after:inset-0 after:content-['']">
            {show.title}
          </Link>
        </h3>

        {show.clubName && (
          <div className="flex items-center gap-1.5 text-[12.5px] text-[var(--ev-muted)] sm:text-[13px]">
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
            <span className="truncate">
              Av {show.clubName}
              {show.clubCity && <span className="sm:hidden"> · {show.clubCity}</span>}
            </span>
          </div>
        )}

        {place && (
          <p
            className={cn(
              'truncate text-[12.5px] text-[var(--ev-faint)] sm:text-[13px]',
              // Byen står allerede på klubblinja på mobil — ikke gjenta scenen der.
              show.clubName && 'hidden sm:block'
            )}
          >
            {place}
          </p>
        )}

        {/* Pris, kapasitet og eneste handling på én linje.
            mt-auto retter kjøpsknappene inn mot bunnen på tvers av en rad. */}
        <div className="mt-auto flex items-center gap-x-2.5 pt-2 sm:pt-2.5">
          <span className="text-[13px] font-medium tabular-nums text-[var(--ev-text)]">
            {formatTicketPrice(show)}
          </span>
          {capacity && (
            <span
              className={cn(
                'truncate text-[12.5px] sm:text-[13px]',
                capacity.urgent ? 'text-[var(--ev-accent)]' : 'text-[var(--ev-faint)]'
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
                'inline-flex h-8 items-center gap-1.5 px-3.5 text-[12.5px] font-semibold transition-colors sm:h-9 sm:px-4 sm:text-[13px]',
                'bg-[var(--ev-text)] text-[var(--ev-bg)]',
                'hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
                'disabled:cursor-not-allowed disabled:bg-[var(--ev-card-hover)] disabled:text-[var(--ev-faint)] disabled:hover:bg-[var(--ev-card-hover)]'
              )}
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              <Ticket className="size-3.5 sm:size-4" />
              {soldOut ? 'Utsolgt' : 'Kjøp'}
            </button>
          </ToastActionForm>
        </div>
      </div>
    </article>
  )
}
