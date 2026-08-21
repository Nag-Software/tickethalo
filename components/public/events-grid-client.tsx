'use client'

import { useMemo, useState } from 'react'
import { CalendarIcon, X } from 'lucide-react'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { EventCard } from '@/components/public/event-card'
import { CitySignup } from '@/components/public/city-signup'
import type { PublicShow } from '@/lib/public-events'
import { ALL_CITIES, TIME_RANGES, type TimeRange, isInRange, toIsoDate } from '@/lib/event-filters'
import { enGB } from 'date-fns/locale'

interface Props {
  shows: PublicShow[]
  /** Today in Europe/Oslo, set on the server so the filter counts do not diverge on hydration. */
  today: string
}

/**
 * Shared shape for every filter button, including the date picker below.
 * 44px and 15px on mobile, the original tighter pill from `sm` up — at full
 * screen width they sit seven in a row and should not dominate the page.
 */
const chipBase =
  'inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap px-4 text-[15px] font-medium transition-colors ' +
  'sm:h-auto sm:gap-1.5 sm:px-3.5 sm:py-1.5 sm:text-[13px] sm:font-normal ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]'

const chipTone = (active: boolean) =>
  active
    ? 'bg-[var(--ev-accent-fill)] font-semibold text-[var(--ev-accent-ink)]'
    : 'bg-[var(--ev-card)] text-[var(--ev-muted)] hover:bg-[var(--ev-card-hover)] hover:text-[var(--ev-text)]'

function Chip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean
  count?: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(chipBase, chipTone(active), "cursor-pointer")}
      style={{ borderRadius: 'var(--ev-r-chip)' }}
    >
      {children}
      {count !== undefined && (
        <span className={cn('tabular-nums', active ? 'opacity-80' : 'text-[var(--ev-faint)]')}>
          {count}
          {/* Otherwise the button reads as "Tonight 0" — the number needs a unit. */}
          <span className="sr-only"> {count === 1 ? 'show' : 'shows'}</span>
        </span>
      )}
    </button>
  )
}

export function EventsGridClient({ shows, today }: Props) {
  const [range, setRange] = useState<TimeRange>('all')
  const [city, setCity] = useState(ALL_CITIES)
  const [date, setDate] = useState<Date | undefined>(undefined)

  const cityOptions = useMemo(
    () => [
      ALL_CITIES,
      ...new Set(
        shows
          .map((show) => show.clubCity?.trim())
          .filter((value): value is string => Boolean(value))
          // City names stay Norwegian, so they still sort by Norwegian rules.
          .sort((a, b) => a.localeCompare(b, 'nb-NO'))
      ),
    ],
    [shows]
  )

  const matchesCity = (show: PublicShow, value: string) => value === ALL_CITIES || show.clubCity === value
  const matchesDate = (show: PublicShow, value: Date | undefined) =>
    !value || show.date.slice(0, 10) === toIsoDate(value)

  const filtered = shows.filter(
    (show) => matchesCity(show, city) && matchesDate(show, date) && (date ? true : isInRange(show.date, range, today))
  )

  // The counts cross-reference each other: the city count respects the selected time range, and vice versa.
  const countForCity = (value: string) =>
    shows.filter((show) => matchesCity(show, value) && matchesDate(show, date) && (date ? true : isInRange(show.date, range, today))).length
  const countForRange = (value: TimeRange) =>
    shows.filter((show) => matchesCity(show, city) && isInRange(show.date, value, today)).length

  const hasFilters = city !== ALL_CITIES || range !== 'all' || date !== undefined

  const resetAll = () => {
    setCity(ALL_CITIES)
    setRange('all')
    setDate(undefined)
  }

  return (
    <section id="events-section" className="px-4 pb-24 md:px-8">
      {/* Toolbar — sticks below the floating header on scroll */}
      <div className="sticky top-[49px] w-fit rounded-lg z-30 -mx-4 mb-6 bg-[var(--ev-bg)]/85 sm:mb-8 px-4 py-3 backdrop-blur-xs md:-mx-8 md:px-8">
        <div className="flex flex-col gap-2.5">
          <div
            role="group"
            aria-label="Filter by time"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:gap-1.5 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] md:-mx-8 md:px-8 md:[mask-image:none] [&::-webkit-scrollbar]:hidden"
          >
            {TIME_RANGES.map((option) => (
              <Chip
                key={option.value}
                active={!date && range === option.value}
                count={countForRange(option.value)}
                onClick={() => {
                  setRange(option.value)
                  setDate(undefined)
                }}
              >
                {option.label}
              </Chip>
            ))}

            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(chipBase, chipTone(Boolean(date)))}
                  style={{ borderRadius: 'var(--ev-r-chip)' }}
                >
                  <CalendarIcon className="size-4 sm:size-3.5" aria-hidden />
                  {date
                    ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                    : 'Pick a date'}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(value) => {
                    setDate(value)
                    if (value) setRange('all')
                  }}
                  locale={enGB}
                />
              </PopoverContent>
            </Popover>
          </div>

          {cityOptions.length > 1 && (
            <div
              role="group"
              aria-label="Filter by city"
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:gap-1.5 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] md:-mx-8 md:px-8 md:[mask-image:none] [&::-webkit-scrollbar]:hidden"
            >
              {cityOptions.map((option) => (
                <Chip
                  key={option}
                  active={option === city}
                  count={countForCity(option)}
                  onClick={() => setCity(option)}
                >
                  {/* Sets it apart from 'All' in the time row right above */}
                  {option === ALL_CITIES ? 'All cities' : option}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-6 flex items-center justify-between gap-4 sm:items-baseline">
        {/* aria-live: filtering happens without a page load, so the count is the
            only notice a screen reader user gets that anything happened. */}
        <h2
          aria-live="polite"
          className="text-[22px] font-semibold tracking-[-0.015em] text-[var(--ev-text)] sm:text-lg sm:font-medium sm:tracking-[-0.01em]"
        >
          {filtered.length} {filtered.length === 1 ? 'show' : 'shows'}
          {city !== ALL_CITIES && <span className="font-medium text-[var(--ev-muted)]"> in {city}</span>}
        </h2>
        {hasFilters && (
          <button
            type="button"
            onClick={resetAll}
            className="-mr-2 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-2 text-[15px] font-medium text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:mr-0 sm:h-auto sm:px-0 sm:text-[13px] sm:font-normal"
          >
            <X className="size-4 sm:size-3.5" aria-hidden /> Reset
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div
          className="border border-dashed border-[var(--ev-line-strong)] px-6 py-16 text-center"
          style={{ borderRadius: 'var(--ev-r-card)' }}
        >
          <p className="text-[17px] text-[var(--ev-text)] sm:text-base">No shows match these filters.</p>
          <button
            type="button"
            onClick={resetAll}
            className="mt-3 inline-flex h-11 items-center px-2 text-[15px] font-medium text-[var(--ev-accent)] underline underline-offset-4 sm:h-auto sm:px-0 sm:text-[13px] sm:font-normal"
          >
            Show all upcoming shows
          </button>
        </div>
      ) : (
        // Hairline between rows on mobile, where the cards read as a list.
        // From sm up they are free-standing cards and need no rule.
        <div className="grid grid-cols-1 gap-5 [&>*+*]:border-t [&>*+*]:border-[var(--ev-line)] [&>*+*]:pt-5 sm:grid-cols-3 sm:gap-7 sm:[&>*+*]:border-0 sm:[&>*+*]:pt-0 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((show, index) => (
            <div
              key={show.id}
              className="animate-fade-in"
              // Tight cascade: everything is in place within 300 ms, however many shows.
              style={{ animationDelay: `${Math.min(index * 30, 300)}ms`, animationFillMode: 'both' }}
            >
              <EventCard show={show} today={today} priority={index < 4} />
            </div>
          ))}
        </div>
      )}

      <CitySignup city={city} />
    </section>
  )
}
