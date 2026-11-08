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
        'group relative block overflow-hidden rounded-[28px] outline-none',
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
      <div className="absolute left-3 top-3 flex flex-col items-center rounded-2xl bg-white px-3 py-1.5 text-center leading-none text-black shadow-lg">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--ev-accent)]">{badge.weekday}</span>
        <span className="mt-0.5 text-[24px] font-extrabold [font-family:var(--font-display)]">{badge.day}</span>
        <span className="text-[11px] font-semibold uppercase">{badge.month}</span>
      </div>

      <span className="absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1.5 text-[13px] font-semibold text-white backdrop-blur-md">
        {formatShowPrice(show)}
      </span>

      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        {note && (
          <span className="mb-2 inline-flex rounded-full bg-[var(--ev-accent-fill)] px-2.5 py-1 text-[12px] font-bold text-white">
            {note}
          </span>
        )}
        <h3
          className={cn(
            'line-clamp-2 font-bold tracking-[-0.02em] [font-family:var(--font-display)]',
            // Linjehøyden må sitte i samme klasse: twMerge fjerner en egen
            // leading-* når en text-*-størrelse kommer etter den.
            size === 'lg' ? 'text-[28px]/[1.05]' : 'text-[22px]/[1.05]'
          )}
        >
          {show.title}
        </h3>
        <p className="mt-2 truncate text-[14px] text-white/75">
          {formatShowTime(show)}
          {place && ` · ${place}`}
        </p>
      </div>
    </Link>
  )
}
