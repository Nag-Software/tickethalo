import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { PublicShow } from '@/lib/public-events'
import { formatShowPrice, formatShowTime, remainingTickets, ticketFillPercent } from '@/lib/public-show-format'
import { parseIsoDate } from '@/lib/event-filters'
import { showVenue } from '@/lib/show-venue'

/**
 * EKSPERIMENTELL (branch experimental/landing-v2) — ikke merge til main.
 *
 * Bildet ER kortet: plakat i full flate, datomerke oppe til venstre, pris
 * oppe til høyre og tittelen lagt på en mørk toning nederst. Hele kortet er
 * én lenke til showet — kjøpet skjer der, ikke i en popover på forsiden.
 */

const FALLBACKS = ['var(--ev-accent-fill)', 'var(--ev-violet)', 'var(--ev-poster-ground)']

function hash(value: string) {
  let h = 0
  for (const c of value) h = (h * 31 + c.charCodeAt(0)) | 0
  return Math.abs(h)
}

export function dateBadge(showDate: string) {
  const d = parseIsoDate(showDate.slice(0, 10))
  return {
    weekday: new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(d),
    day: d.getDate(),
    month: new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(d),
  }
}

function hotNote(show: PublicShow) {
  if (show.soldOut) return 'Sold out'
  if (show.salesState.kind !== 'open') return null
  const remaining = remainingTickets(show)
  if (remaining !== null && remaining <= 10) return `Only ${remaining} left`
  if (ticketFillPercent(show) >= 80) return 'Selling fast'
  return null
}

export function ShowCard({ show, size = 'md', priority }: { show: PublicShow; size?: 'md' | 'lg'; priority?: boolean }) {
  const badge = dateBadge(show.date)
  const { venue } = showVenue(show)
  const place = [venue, show.clubCity].filter(Boolean).join(' · ')
  const note = hotNote(show)
  const ground = FALLBACKS[hash(show.id) % FALLBACKS.length]

  return (
    <Link
      href={`/events/${show.slug ?? show.id}`}
      className={cn(
        'group relative block overflow-hidden rounded-[20px] outline-none sm:rounded-[28px]',
        'focus-visible:ring-4 focus-visible:ring-[var(--ev-accent-fill)]',
        size === 'lg' ? 'aspect-[4/5]' : 'aspect-[3/4]'
      )}
      style={{ background: ground }}
    >
      {show.poster_url ? (
        <Image
          src={show.poster_url}
          alt=""
          fill
          priority={priority}
          sizes="(max-width: 640px) 80vw, (max-width: 1024px) 40vw, 25vw"
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
        />
      ) : (
        <span
          aria-hidden
          className="absolute -right-6 top-10 rotate-[-8deg] text-[120px] font-extrabold leading-none text-white/15 [font-family:var(--font-display)]"
        >
          ha!
        </span>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

      {/* Datomerke */}
      <div className="absolute left-2 top-2 flex flex-col items-center rounded-xl bg-white px-2 py-1 text-center leading-none text-black shadow-lg sm:left-3 sm:top-3 sm:rounded-2xl sm:px-3 sm:py-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--ev-accent)] sm:text-[11px]">{badge.weekday}</span>
        <span className="mt-0.5 text-[19px] font-extrabold [font-family:var(--font-display)] sm:text-[24px]">{badge.day}</span>
        <span className="text-[10px] font-semibold uppercase sm:text-[11px]">{badge.month}</span>
      </div>

      <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-1 text-[11px] font-semibold sm:right-3 sm:top-3 sm:px-3 sm:py-1.5 sm:text-[13px] text-white backdrop-blur-md">
        {formatShowPrice(show)}
      </span>

      <div className="absolute inset-x-0 bottom-0 p-3 text-white sm:p-5">
        {note && (
          <span className="mb-1.5 inline-flex rounded-full bg-[var(--ev-accent-fill)] px-2 py-0.5 text-[11px] font-bold text-white sm:mb-2 sm:px-2.5 sm:py-1 sm:text-[12px]">
            {note}
          </span>
        )}
        <h3
          className={cn(
            'line-clamp-2 font-bold tracking-[-0.02em] [font-family:var(--font-display)]',
            // Linjehøyden må sitte i samme klasse: twMerge fjerner en egen
            // leading-* når en text-*-størrelse kommer etter den.
            size === 'lg' ? 'text-[24px]/[1.05] sm:text-[28px]/[1.05]' : 'text-[16px]/[1.1] sm:text-[22px]/[1.05]'
          )}
        >
          {show.title}
        </h3>
        <p className="mt-1 truncate text-[12px] text-white/75 sm:mt-2 sm:text-[14px]">
          {formatShowTime(show)}
          {place && ` · ${place}`}
        </p>
      </div>
    </Link>
  )
}
