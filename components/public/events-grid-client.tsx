'use client'

import { useMemo, useState } from 'react'
import { CalendarIcon, X } from 'lucide-react'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { EventCard } from '@/components/public/event-card'
import { CitySignup } from '@/components/public/city-signup'
import type { PublicShow } from '@/lib/public-events'
import { TIME_RANGES, type TimeRange, isInRange, toIsoDate } from '@/lib/event-filters'
import { nb } from 'date-fns/locale'

interface Props {
  shows: PublicShow[]
  /** Dagens dato i Europe/Oslo, satt på serveren så filtertellingene ikke spriker ved hydrering. */
  today: string
}

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
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-1.5 text-[13px] transition-colors',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
        active
          ? 'bg-[var(--ev-accent-fill)] font-semibold text-[var(--ev-accent-ink)]'
          : 'bg-[var(--ev-card)] text-[var(--ev-muted)] hover:bg-[var(--ev-card-hover)] hover:text-[var(--ev-text)]'
      )}
      style={{ borderRadius: 'var(--ev-r-chip)' }}
    >
      {children}
      {count !== undefined && (
        <span className={cn('tabular-nums', active ? 'opacity-70' : 'text-[var(--ev-faint)]')}>{count}</span>
      )}
    </button>
  )
}

export function EventsGridClient({ shows, today }: Props) {
  const [range, setRange] = useState<TimeRange>('alle')
  const [city, setCity] = useState('Alle')
  const [date, setDate] = useState<Date | undefined>(undefined)

  const cityOptions = useMemo(
    () => [
      'Alle',
      ...new Set(
        shows
          .map((show) => show.clubCity?.trim())
          .filter((value): value is string => Boolean(value))
          .sort((a, b) => a.localeCompare(b, 'nb-NO'))
      ),
    ],
    [shows]
  )

  const matchesCity = (show: PublicShow, value: string) => value === 'Alle' || show.clubCity === value
  const matchesDate = (show: PublicShow, value: Date | undefined) =>
    !value || show.date.slice(0, 10) === toIsoDate(value)

  const filtered = shows.filter(
    (show) => matchesCity(show, city) && matchesDate(show, date) && (date ? true : isInRange(show.date, range, today))
  )

  // Tellingene krysser hverandre: bytelling tar hensyn til valgt tid, og omvendt.
  const countForCity = (value: string) =>
    shows.filter((show) => matchesCity(show, value) && matchesDate(show, date) && (date ? true : isInRange(show.date, range, today))).length
  const countForRange = (value: TimeRange) =>
    shows.filter((show) => matchesCity(show, city) && isInRange(show.date, value, today)).length

  const hasFilters = city !== 'Alle' || range !== 'alle' || date !== undefined

  const resetAll = () => {
    setCity('Alle')
    setRange('alle')
    setDate(undefined)
  }

  return (
    <section id="events-section" className="px-4 pb-24 md:px-8">
      {/* Verktøylinje — fester seg under den flytende headeren ved scroll */}
      <div className="sticky top-[74px] z-30 -mx-4 mb-8 bg-[var(--ev-bg)]/85 px-4 py-3 backdrop-blur-md md:-mx-8 md:px-8">
        <div className="flex flex-col gap-2.5">
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] md:-mx-8 md:px-8 md:[mask-image:none] [&::-webkit-scrollbar]:hidden">
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
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-1.5 text-[13px] transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
                    date
                      ? 'bg-[var(--ev-accent-fill)] font-semibold text-[var(--ev-accent-ink)]'
                      : 'bg-[var(--ev-card)] text-[var(--ev-muted)] hover:bg-[var(--ev-card-hover)] hover:text-[var(--ev-text)]'
                  )}
                  style={{ borderRadius: 'var(--ev-r-chip)' }}
                >
                  <CalendarIcon className="size-3.5" />
                  {date
                    ? date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })
                    : 'Velg dato'}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(value) => {
                    setDate(value)
                    if (value) setRange('alle')
                  }}
                  locale={nb}
                />
              </PopoverContent>
            </Popover>
          </div>

          {cityOptions.length > 1 && (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] md:-mx-8 md:px-8 md:[mask-image:none] [&::-webkit-scrollbar]:hidden">
              {cityOptions.map((option) => (
                <Chip
                  key={option}
                  active={option === city}
                  count={countForCity(option)}
                  onClick={() => setCity(option)}
                >
                  {/* Skiller den fra 'Alle' i tidsraden rett over */}
                  {option === 'Alle' ? 'Alle byer' : option}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-medium tracking-[-0.01em] text-[var(--ev-text)]">
          {filtered.length} {filtered.length === 1 ? 'show' : 'show'}
          {city !== 'Alle' && <span className="text-[var(--ev-muted)]"> i {city}</span>}
        </h2>
        {hasFilters && (
          <button
            type="button"
            onClick={resetAll}
            className="inline-flex items-center gap-1 text-[13px] text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)]"
          >
            <X className="size-3.5" /> Nullstill
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div
          className="border border-dashed border-[var(--ev-line-strong)] px-6 py-16 text-center"
          style={{ borderRadius: 'var(--ev-r-card)' }}
        >
          <p className="text-[var(--ev-text)]">Ingen show med disse filtrene.</p>
          <button
            type="button"
            onClick={resetAll}
            className="mt-3 text-[13px] text-[var(--ev-accent)] underline underline-offset-4"
          >
            Vis alle kommende show
          </button>
        </div>
      ) : (
        // Hårlinje mellom radene på mobil, der kortene leses som en liste.
        // Fra sm og opp er de frittstående kort og trenger ingen strek.
        <div className="grid grid-cols-1 gap-5 [&>*+*]:border-t [&>*+*]:border-[var(--ev-line)] [&>*+*]:pt-5 sm:grid-cols-3 sm:gap-7 sm:[&>*+*]:border-0 sm:[&>*+*]:pt-0 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((show, index) => (
            <div
              key={show.id}
              className="animate-fade-in"
              // Stram kaskade: alt er på plass innen 300 ms, uansett hvor mange show.
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
