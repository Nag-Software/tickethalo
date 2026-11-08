'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { TicketOrder } from '@/components/public/ticket-order'
import type { PublicShow } from '@/lib/public-events'
import { formatShowPrice, formatShowTime, remainingTickets, ticketFillPercent } from '@/lib/public-show-format'
import { formatDayLabel, parseIsoDate } from '@/lib/event-filters'
import { showVenue } from '@/lib/show-venue'

/**
 * EKSPERIMENTELL (branch experimental/landing-v2) — ikke merge til main.
 *
 * Showlisten som en tidslinje, gruppert per dag. Ett valg å ta (by), og bare
 * når det finnes mer enn én by. Ingen tellere, ingen datovelger, ingen
 * geolokasjon — de fleste har bare én beslutning: «hva skjer snart der jeg er?».
 */

const ALL = 'all'

function weekday(showDate: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(parseIsoDate(showDate.slice(0, 10)))
}

function urgency(show: PublicShow): string | null {
  if (show.soldOut) return 'Sold out'
  if (show.salesState.kind !== 'open') return null
  const remaining = remainingTickets(show)
  if (remaining !== null && remaining <= 10) return `${remaining} left`
  if (ticketFillPercent(show) >= 80) return 'Almost sold out'
  return null
}

export function ShowList({ shows, today }: { shows: PublicShow[]; today: string }) {
  const [city, setCity] = useState(ALL)

  const cities = useMemo(
    () =>
      [...new Set(shows.map((s) => s.clubCity?.trim()).filter((c): c is string => Boolean(c)))].sort((a, b) =>
        a.localeCompare(b, 'nb-NO')
      ),
    [shows]
  )

  const visible = city === ALL ? shows : shows.filter((s) => s.clubCity === city)

  // `shows` kommer sortert på dato, så gruppene blir det også.
  const days = useMemo(() => {
    const map = new Map<string, PublicShow[]>()
    for (const show of visible) {
      const key = show.date.slice(0, 10)
      map.set(key, [...(map.get(key) ?? []), show])
    }
    return [...map.entries()]
  }, [visible])

  return (
    <section id="shows" className="mx-auto w-full max-w-3xl scroll-mt-6 px-4 pb-24 md:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-[var(--ev-line)] pb-4">
        <h2 className="text-[26px] font-semibold tracking-[-0.025em] text-[var(--ev-text)] md:text-[30px]">
          Upcoming shows
        </h2>

        {cities.length > 1 && (
          <div role="group" aria-label="Filter by city" className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
            {[ALL, ...cities].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={city === value}
                onClick={() => setCity(value)}
                className={cn(
                  'h-9 shrink-0 cursor-pointer rounded-full px-3.5 text-[14px] font-medium transition-colors',
                  city === value
                    ? 'bg-[var(--ev-text)] text-[var(--ev-bg)]'
                    : 'text-[var(--ev-muted)] hover:bg-[var(--ev-card)] hover:text-[var(--ev-text)]'
                )}
              >
                {value === ALL ? 'All cities' : value}
              </button>
            ))}
          </div>
        )}
      </div>

      {days.length === 0 ? (
        <div className="rounded-2xl bg-[var(--ev-card)] px-6 py-14 text-center">
          <p className="text-[17px] font-medium text-[var(--ev-text)]">No shows on sale right now.</p>
          <p className="mt-1 text-[15px] text-[var(--ev-muted)]">New nights are added every week — check back soon.</p>
        </div>
      ) : (
        <ol className="flex flex-col gap-10">
          {days.map(([date, dayShows]) => (
            <li key={date} className="grid gap-3 md:grid-cols-[140px_1fr] md:gap-6">
              <div className="md:sticky md:top-6 md:self-start">
                <p className="text-[15px] font-semibold text-[var(--ev-text)]">{formatDayLabel(date, today)}</p>
                <p className="text-[14px] text-[var(--ev-faint)]">{weekday(date)}</p>
              </div>

              <ul className="flex flex-col gap-3">
                {dayShows.map((show) => (
                  <li key={show.id}>
                    <ShowRow show={show} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function ShowRow({ show }: { show: PublicShow }) {
  const href = `/events/${show.slug ?? show.id}`
  const { venue } = showVenue(show)
  const place = [venue, show.clubCity].filter(Boolean).join(', ')
  const note = urgency(show)
  const allFree = show.ticketTypes.length > 0 && show.ticketTypes.every((t) => t.unitAmount === 0)

  return (
    <article className="group relative flex gap-4 rounded-2xl bg-[var(--ev-card)] p-3 transition-colors hover:bg-[var(--ev-card-hover)] sm:p-4">
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[14px] text-[var(--ev-muted)]">{formatShowTime(show)}</p>

        <h3 className="mt-0.5 text-[18px] font-semibold leading-snug tracking-[-0.01em] text-[var(--ev-text)]">
          {/* Strukket lenke: hele raden er klikkbar, men bare én lenke i DOM-en. */}
          <Link href={href} className="line-clamp-2 after:absolute after:inset-0 after:rounded-2xl after:content-['']">
            {show.title}
          </Link>
        </h3>

        {(show.clubName || place) && (
          <p className="mt-1 truncate text-[14px] text-[var(--ev-muted)]">
            {[show.clubName, place].filter(Boolean).join(' · ')}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
          <TicketOrder
            showId={show.id}
            slug={show.slug ?? show.id}
            title={show.title}
            currency={show.currency}
            ticketTypes={show.ticketTypes}
            hasLockedTypes={show.hasLockedTypes}
            external={Boolean(show.ticket_url)}
            soldOut={show.soldOut}
            salesState={show.salesState}
            remaining={remainingTickets(show)}
            clubName={show.clubName}
            triggerLabel={allFree && !show.ticket_url ? 'Reserve' : 'Get tickets'}
            triggerClassName={cn(
              'relative z-10 inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-colors',
              'bg-[var(--ev-text)] text-[var(--ev-bg)] hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
              'disabled:cursor-not-allowed disabled:bg-[var(--ev-card-hover)] disabled:text-[var(--ev-faint)]'
            )}
          />
          <span className="text-[14px] font-medium tabular-nums text-[var(--ev-text)]">{formatShowPrice(show)}</span>
          {note && <span className="text-[14px] font-medium text-[var(--ev-accent)]">{note}</span>}
        </div>
      </div>

      <div
        className="relative w-[84px] shrink-0 self-start overflow-hidden bg-[var(--ev-poster-ground)] sm:w-[104px]"
        style={{ borderRadius: 'var(--ev-r-art)' }}
      >
        <div className="relative aspect-[2/3]">
          {show.poster_url ? (
            <Image src={show.poster_url} alt="" fill sizes="104px" className="object-cover" />
          ) : (
            <div className="flex h-full items-end p-2 text-[12px] font-medium leading-tight text-white">{show.title}</div>
          )}
        </div>
      </div>
    </article>
  )
}
