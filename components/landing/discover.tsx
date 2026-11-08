'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CalendarDays, MapPin, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PublicShow } from '@/lib/public-events'
import { isInRange, type TimeRange } from '@/lib/event-filters'
import { ShowCard } from '@/components/landing/show-card'
import { BrandLogoResponsive } from '@/components/brand/brand-logo'

/**
 * EKSPERIMENTELL (branch experimental/landing-v2) — ikke merge til main.
 *
 * Hero og showliste i én klientkomponent, fordi søkefeltet i heroen styrer
 * listen under. To valg — hvor og når — og ett trykk.
 */

const WHEN: Array<{ value: TimeRange; label: string }> = [
  { value: 'all', label: 'Anytime' },
  { value: 'tonight', label: 'Tonight' },
  { value: 'this-weekend', label: 'This weekend' },
  { value: 'this-month', label: 'This month' },
]

export function Discover({ shows, today }: { shows: PublicShow[]; today: string }) {
  const [city, setCity] = useState('')
  const [when, setWhen] = useState<TimeRange>('all')

  const cities = useMemo(
    () =>
      [...new Set(shows.map((s) => s.clubCity?.trim()).filter((c): c is string => Boolean(c)))].sort((a, b) =>
        a.localeCompare(b, 'nb-NO')
      ),
    [shows]
  )

  const tonight = shows.filter((s) => s.date.slice(0, 10) === today)
  const filtered = Boolean(city) || when !== 'all'
  // Uten filter står kveldens show i skinnen over, så rutenettet tar resten.
  const showRail = !filtered && tonight.length > 0
  const results = shows.filter(
    (s) =>
      (!city || s.clubCity === city) &&
      isInRange(s.date, when, today) &&
      !(showRail && s.date.slice(0, 10) === today)
  )
  const collage = shows.slice(0, 3)

  return (
    <>
      {/* ───────── Hero (mørk tone) ───────── */}
      <div className="ev-surface relative overflow-hidden bg-[var(--ev-bg)] text-[var(--ev-text)] md:rounded-b-[48px]" data-tone="dark">
        <header className="relative z-20 mx-auto flex h-20 max-w-7xl items-center justify-between px-5 md:px-10">
          <Link href="/" aria-label="Tickethalo home" className="flex items-center">
            <BrandLogoResponsive tone="dark" priority className="h-6" />
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 text-[14px] font-semibold">
            <Link href="/artist-app/login" className="hidden rounded-full px-4 py-2 text-[var(--ev-muted)] hover:text-[var(--ev-text)] sm:block">
              Comedians
            </Link>
            <Link href="/admin-app" prefetch={false} className="hidden rounded-full px-4 py-2 text-[var(--ev-muted)] hover:text-[var(--ev-text)] sm:block">
              Clubs
            </Link>
            <Link
              href="/admin-app"
              prefetch={false}
              className="rounded-full bg-[var(--ev-text)] px-4 py-2 text-[var(--ev-accent-ink)] transition-transform hover:scale-105"
            >
              Sell tickets
            </Link>
          </nav>
        </header>

        <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-10 px-5 pb-16 pt-6 md:px-10 md:pb-24 md:pt-12 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-[var(--ev-card-hover)] px-3 py-1.5 text-[13px] font-semibold text-[var(--ev-muted)]">
              <span className="size-2 animate-pulse rounded-full bg-[var(--ev-accent-fill)]" />
              {tonight.length > 0 ? `${tonight.length} ${tonight.length === 1 ? 'show' : 'shows'} tonight` : 'Live stand-up across Norway'}
            </p>
            <h1 className="mt-6 text-[56px] font-extrabold leading-[0.9] tracking-[-0.045em] [font-family:var(--font-display)] sm:text-[80px] lg:text-[104px]">
              Go out.
              <br />
              <span className="text-[var(--ev-accent-fill)]">Laugh</span> loud.
            </h1>
            <p className="mt-6 max-w-md text-[18px] leading-[1.45] text-[var(--ev-muted)]">
              The best stand-up nights in your city. Pick a show, grab a ticket, done.
            </p>

            {/* Søkefeltet */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                document.getElementById('shows')?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="mt-9 flex flex-col gap-1 rounded-[28px] bg-white p-2 text-black shadow-[0_30px_80px_-30px_rgba(255,91,36,0.55)] sm:flex-row sm:items-center sm:rounded-full"
            >
              <label className="flex flex-1 items-center gap-3 rounded-full px-4 py-2.5 hover:bg-black/5">
                <MapPin className="size-5 shrink-0 text-[var(--ev-accent-fill)]" aria-hidden />
                <span className="flex flex-col">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-black/50">Where</span>
                  <select
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="-ml-1 cursor-pointer bg-transparent text-[15px] font-semibold outline-none"
                  >
                    <option value="">All cities</option>
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <span aria-hidden className="hidden h-8 w-px bg-black/10 sm:block" />
              <label className="flex flex-1 items-center gap-3 rounded-full px-4 py-2.5 hover:bg-black/5">
                <CalendarDays className="size-5 shrink-0 text-[var(--ev-accent-fill)]" aria-hidden />
                <span className="flex flex-col">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-black/50">When</span>
                  <select
                    value={when}
                    onChange={(e) => setWhen(e.target.value as TimeRange)}
                    className="-ml-1 cursor-pointer bg-transparent text-[15px] font-semibold outline-none"
                  >
                    {WHEN.map((w) => (
                      <option key={w.value} value={w.value}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <button
                type="submit"
                className="flex h-14 items-center justify-center gap-2 rounded-full bg-[var(--ev-accent-fill)] px-7 text-[16px] font-bold text-white transition-transform hover:scale-[1.03]"
              >
                <Search className="size-5" aria-hidden />
                Find shows
              </button>
            </form>
          </div>

          {/* Plakatkollasj — bare fra lg, der det er plass ved siden av teksten */}
          {collage.length > 0 && (
            <div aria-hidden className="relative hidden h-[540px] lg:block">
              {collage.map((show, i) => (
                <div
                  key={show.id}
                  className={cn(
                    'absolute top-1/2 w-[46%] max-w-[260px] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)] transition-transform duration-500 hover:z-40 hover:scale-105',
                    i === 0 && 'left-0 z-10 -translate-y-[44%] -rotate-[9deg]',
                    i === 1 && 'left-1/2 z-20 -translate-x-1/2 -translate-y-[58%]',
                    i === 2 && 'right-0 z-10 -translate-y-[44%] rotate-[9deg]'
                  )}
                >
                  <ShowCard show={show} priority />
                </div>
              ))}
              <div className="absolute bottom-[4%] left-[38%] z-30 grid size-28 rotate-[-14deg] place-items-center rounded-full bg-[var(--ev-violet)] text-center text-[15px] font-extrabold leading-tight text-white [font-family:var(--font-display)]">
                No boring
                <br />
                nights.
              </div>
            </div>
          )}
        </div>

        {/* Glød bak overskriften */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-40 top-20 size-[620px] rounded-full bg-[var(--ev-accent-fill)] opacity-25 blur-[140px]"
        />
      </div>

      {/* ───────── Shows ───────── */}
      <section id="shows" className="mx-auto max-w-7xl scroll-mt-4 px-5 py-16 md:px-10 md:py-24">
        {showRail && (
          <div className="mb-16">
            <SectionTitle eyebrow="Don't stay home" title="Tonight" />
            <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-4 [scrollbar-width:none] md:-mx-10 md:px-10">
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
          title={city ? `Comedy in ${city}` : showRail ? 'Later on' : 'All upcoming shows'}
          action={
            filtered ? (
              <button
                type="button"
                onClick={() => {
                  setCity('')
                  setWhen('all')
                }}
                className="rounded-full border border-[var(--ev-line-strong)] px-4 py-2 text-[14px] font-semibold hover:bg-[var(--ev-text)] hover:text-[var(--ev-bg)]"
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
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
    <div className="mb-7 flex items-end justify-between gap-4">
      <div>
        <p className="text-[14px] font-bold uppercase tracking-[0.12em] text-[var(--ev-accent)]">{eyebrow}</p>
        <h2 className="mt-1 text-[40px] font-extrabold leading-none tracking-[-0.035em] [font-family:var(--font-display)] md:text-[56px]">
          {title}
        </h2>
      </div>
      {action}
    </div>
  )
}
