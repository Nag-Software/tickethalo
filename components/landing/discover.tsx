'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PublicShow } from '@/lib/public-events'
import { formatShowPrice, formatShowTime } from '@/lib/public-show-format'
import { isInRange, parseIsoDate, toIsoDate, type TimeRange } from '@/lib/event-filters'
import { ShowCard, dateBadge } from '@/components/landing/show-card'
import { BrandLogoResponsive } from '@/components/brand/brand-logo'
import { CityCombobox } from '@/components/landing/city-combobox'
import { WhenPicker, whenLabel } from '@/components/landing/when-picker'
import { showVenue } from '@/lib/show-venue'

/**
 * EKSPERIMENTELL (branch experimental/landing-v2) — ikke merge til main.
 *
 * Lys hero med et ordentlig søk: søkbar by og en kalender for «when». Valgene
 * filtrerer listen under med en gang; knappen tar deg bare ned til den.
 */

export function Discover({ shows, today }: { shows: PublicShow[]; today: string }) {
  const [city, setCity] = useState('')
  const [when, setWhen] = useState<TimeRange>('all')
  const [date, setDate] = useState<Date | undefined>(undefined)

  const cityOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of shows) {
      const c = s.clubCity?.trim()
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([c, count]) => ({ city: c, count }))
      .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city, 'nb-NO'))
  }, [shows])

  const inCity = (s: PublicShow) => !city || s.clubCity === city
  const inWhen = (s: PublicShow) => (date ? s.date.slice(0, 10) === toIsoDate(date) : isInRange(s.date, when, today))

  const showDates = useMemo(
    () => [...new Set(shows.filter(inCity).map((s) => s.date.slice(0, 10)))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shows, city]
  )

  const tonight = shows.filter((s) => s.date.slice(0, 10) === today)
  const filtered = Boolean(city) || when !== 'all' || Boolean(date)
  // Uten filter står kveldens show i skinnen over, så rutenettet tar resten.
  const showRail = !filtered && tonight.length > 0
  const results = shows.filter(
    (s) => inCity(s) && inWhen(s) && !(showRail && s.date.slice(0, 10) === today)
  )
  const next = shows[0]

  const todayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    parseIsoDate(today)
  )

  const goToShows = () => document.getElementById('shows')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <>
      {/* ───────── Hero (lys) ───────── */}
      <div className="relative overflow-hidden">
        <header className="relative z-20 mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:h-20 md:px-10">
          <Link href="/" aria-label="Tickethalo home" className="flex h-9 items-center rounded-full bg-[var(--ev-accent-fill)] px-3">
            <BrandLogoResponsive tone="dark" priority className="h-5" />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 text-[14px] font-semibold">
            <Link href="/artist-app/login" className="hidden rounded-full px-4 py-2 text-[var(--ev-muted)] hover:text-[var(--ev-text)] sm:block">
              For comedians
            </Link>
            <Link href="/arranger" className="hidden rounded-full px-4 py-2 text-[var(--ev-muted)] hover:text-[var(--ev-text)] sm:block">
              For clubs
            </Link>
            <Link
              href="/arranger"
              className="inline-flex h-10 items-center rounded-full bg-[var(--ev-text)] px-4 text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
            >
              Sell tickets
            </Link>
          </nav>
        </header>

        <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] items-center gap-6 px-4 pb-10 pt-2 sm:gap-10 md:px-10 md:pb-24 md:pt-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div className="order-2 min-w-0 lg:order-1">
            <p className="text-[13px] font-medium text-[var(--ev-muted)] sm:text-[14px]">
              {todayLabel}
              {tonight.length > 0 && (
                <span className="text-[var(--ev-text)]">
                  {' · '}
                  {tonight.length} {tonight.length === 1 ? 'show' : 'shows'} tonight
                </span>
              )}
            </p>
            <h1 className="mt-2 text-[36px] font-bold leading-[1.02] tracking-[-0.035em] [font-family:var(--font-display)] sm:mt-4 sm:text-[52px] lg:text-[64px]">
              What&rsquo;s{' '}
              <span className="relative inline-block">
                funny
                <Squiggle />
              </span>
              <br />
              tonight?
            </h1>
            <p className="mt-3 max-w-md text-[16px] leading-[1.45] text-[var(--ev-muted)] sm:mt-5 sm:text-[17px]">
              Stand-up from comedy clubs across Norway. Pick a city and a night.
            </p>

            {/* Søkefeltet */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                goToShows()
              }}
              className="mt-5 grid grid-cols-2 gap-1 rounded-[26px] bg-white p-1.5 shadow-[0_24px_60px_-28px_rgba(46,12,1,0.35)] ring-1 ring-black/[0.06] sm:mt-8 sm:flex sm:items-center sm:rounded-full sm:p-2"
            >
              <div className="min-w-0 border-r border-black/[0.08] sm:flex-1 sm:border-0">
                <CityCombobox options={cityOptions} total={shows.length} value={city} onChange={setCity} />
              </div>
              <span aria-hidden className="hidden h-8 w-px shrink-0 bg-black/10 sm:block" />
              <div className="min-w-0 sm:flex-1">
                <WhenPicker
                  range={when}
                  date={date}
                  today={today}
                  showDates={showDates}
                  onRange={setWhen}
                  onDate={setDate}
                />
              </div>
              <button
                type="submit"
                className="col-span-2 flex h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--ev-accent-fill)] px-6 text-[16px] font-bold sm:h-13 text-[var(--ev-accent-ink)] transition-transform hover:scale-[1.03]"
              >
                <Search className="size-5" aria-hidden />
                <span>Search</span>
              </button>
            </form>

            {/* Snarveier — ett trykk, ingen popover */}
            <div className="-mx-4 mt-3 flex items-center gap-2 overflow-x-auto px-4 text-[14px] [scrollbar-width:none] sm:mx-0 sm:mt-4 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
              <span className="mr-1 hidden text-[var(--ev-faint)] sm:inline">Quick picks:</span>
              {[
                { label: 'Tonight', on: !date && when === 'tonight', act: () => { setDate(undefined); setWhen('tonight') } },
                { label: 'This weekend', on: !date && when === 'this-weekend', act: () => { setDate(undefined); setWhen('this-weekend') } },
                ...cityOptions.slice(0, 3).map((c) => ({
                  label: c.city,
                  on: city === c.city,
                  act: () => setCity(city === c.city ? '' : c.city),
                })),
              ].map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  aria-pressed={chip.on}
                  onClick={chip.act}
                  className={cn(
                    'h-9 shrink-0 cursor-pointer whitespace-nowrap rounded-full px-3.5 font-medium transition-colors',
                    chip.on
                      ? 'bg-[var(--ev-text)] text-[var(--ev-bg)]'
                      : 'bg-[var(--ev-card)] text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line)] hover:text-[var(--ev-text)]'
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          <HeroVisual next={next} />
        </div>
      </div>

      {/* ───────── Shows ───────── */}
      <section id="shows" className="mx-auto max-w-7xl scroll-mt-4 px-4 py-10 md:px-10 md:py-24">
        {showRail && (
          <div className="mb-10 md:mb-16">
            <SectionTitle eyebrow="Don't stay home" title="Tonight" />
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:gap-4 [scrollbar-width:none] md:-mx-10 md:px-10">
              {tonight.map((show) => (
                <div key={show.id} className="w-[78%] shrink-0 snap-start sm:w-[44%] lg:w-[31%]">
                  <ShowCard show={show} size="lg" />
                </div>
              ))}
            </div>
          </div>
        )}

        <SectionTitle
          eyebrow={filtered ? `${results.length} ${results.length === 1 ? 'show' : 'shows'} found` : 'Coming up'}
          title={
            date
              ? `${whenLabel(when, date)}${city ? ` in ${city}` : ''}`
              : city
                ? `Comedy in ${city}`
                : showRail
                  ? 'Later on'
                  : 'All upcoming shows'
          }
          action={
            filtered ? (
              <button
                type="button"
                onClick={() => {
                  setCity('')
                  setWhen('all')
                  setDate(undefined)
                }}
                className="h-10 shrink-0 rounded-full border border-[var(--ev-line-strong)] px-4 text-[14px] font-semibold hover:bg-[var(--ev-text)] hover:text-[var(--ev-bg)]"
              >
                Clear filters
              </button>
            ) : null
          }
        />

        {results.length === 0 ? (
          <div className="rounded-[32px] bg-[var(--ev-card)] px-6 py-20 text-center">
            <p className="text-[40px]" aria-hidden>
              🎤
            </p>
            <p className="mt-3 text-[22px] font-bold [font-family:var(--font-display)]">The stage is empty — for now.</p>
            <p className="mt-1 text-[16px] text-[var(--ev-muted)]">New shows drop every week. Check back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
            {results.map((show) => (
              <ShowCard key={show.id} show={show} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function SectionTitle({ eyebrow, title, action }: { eyebrow: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4 md:mb-7">
      <div>
        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ev-accent)] sm:text-[14px]">{eyebrow}</p>
        <h2 className="mt-1 text-[30px] font-extrabold leading-none tracking-[-0.035em] [font-family:var(--font-display)] sm:text-[40px] md:text-[52px]">
          {title}
        </h2>
      </div>
      {action}
    </div>
  )
}

/** Håndtegnet strek under «funny». */
function Squiggle() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 20"
      preserveAspectRatio="none"
      className="absolute -bottom-2 left-0 h-[0.28em] w-full text-[var(--ev-accent-fill)]"
    >
      <path
        d="M3 14 C 30 4, 50 4, 70 12 S 110 20, 130 10 S 175 2, 197 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * Bildet i heroen: et ekte publikumsbilde, en billett til neste show som
 * flyter over det, og et roterende klistremerke.
 */
function HeroVisual({ next }: { next: PublicShow | undefined }) {
  return (
    <div className="relative order-1 mx-auto w-full max-w-[520px] pb-16 sm:pb-14 lg:order-2 lg:pb-8">
      <div className="relative aspect-[16/10] overflow-hidden rounded-[24px] bg-[var(--ev-poster-ground)] shadow-[0_40px_80px_-40px_rgba(46,12,1,0.55)] sm:aspect-[4/3] sm:rounded-[32px] lg:aspect-[5/6] lg:rotate-[2deg] lg:rounded-[36px]">
        <Image
          src="/hero-audience-mobile.webp"
          alt="Two people laughing in the audience at a comedy club"
          fill
          priority
          sizes="(max-width: 1024px) 92vw, 520px"
          className="object-cover object-[50%_35%]"
        />
      </div>

      <Sticker />

      {next && <NextTicket show={next} />}
    </div>
  )
}

function Sticker() {
  return (
    <div aria-hidden className="absolute -right-1 -top-4 size-20 sm:-right-6 sm:-top-6 sm:size-32">
      <svg viewBox="0 0 120 120" className="size-full animate-[spin_18s_linear_infinite] motion-reduce:animate-none">
        <defs>
          <path id="sticker-circle" d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" />
        </defs>
        <circle cx="60" cy="60" r="60" fill="var(--ev-violet)" />
        <text fill="white" fontSize="12.5" fontWeight="700" letterSpacing="2.2">
          <textPath href="#sticker-circle">LIVE COMEDY • EVERY WEEK • </textPath>
        </text>
      </svg>
      <span className="absolute inset-0 grid place-items-center text-[22px] sm:text-[30px]">🎤</span>
    </div>
  )
}

/** Neste show som en billett — hakk i sidene og stiplet skille. */
function NextTicket({ show }: { show: PublicShow }) {
  const badge = dateBadge(show.date)
  const { venue } = showVenue(show)
  const place = [venue, show.clubCity].filter(Boolean).join(', ')

  return (
    <Link
      href={`/events/${show.slug ?? show.id}`}
      className="group absolute bottom-0 left-3 flex w-[min(340px,calc(100%-24px))] -rotate-[2deg] overflow-hidden rounded-3xl bg-white text-black shadow-[0_30px_60px_-24px_rgba(46,12,1,0.5)] transition-transform hover:rotate-0 sm:-rotate-[3deg] lg:-left-8"
    >
      <div className="flex w-[68px] shrink-0 flex-col items-center justify-center bg-[var(--ev-accent-fill)] py-3 text-white sm:w-[84px] sm:py-4">
        <span className="text-[12px] font-bold uppercase">{badge.weekday}</span>
        <span className="text-[26px] font-bold leading-none [font-family:var(--font-display)] sm:text-[30px]">{badge.day}</span>
        <span className="text-[12px] font-semibold uppercase">{badge.month}</span>
      </div>
      <div className="relative min-w-0 flex-1 border-l-2 border-dashed border-black/10 px-3.5 py-3 sm:px-4 sm:py-3.5">
        <span className="absolute -left-[9px] -top-2 size-4 rounded-full bg-[var(--ev-bg)]" aria-hidden />
        <span className="absolute -bottom-2 -left-[9px] size-4 rounded-full bg-[var(--ev-bg)]" aria-hidden />
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ev-accent)]">Next up</p>
        <p className="mt-0.5 truncate text-[16px] font-bold [font-family:var(--font-display)]">{show.title}</p>
        <p className="truncate text-[13px] text-black/55">
          {formatShowTime(show)}
          {place && ` · ${place}`}
        </p>
        <p className="mt-2 flex items-center justify-between text-[13px] font-semibold">
          {formatShowPrice(show)}
          <span className="flex items-center gap-1 text-[var(--ev-accent)]">
            Get tickets <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </span>
        </p>
      </div>
    </Link>
  )
}
