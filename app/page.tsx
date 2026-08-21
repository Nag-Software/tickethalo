import Image from 'next/image'
import { PublicHeader } from '@/components/public/public-header'
import { RotatingBadge } from '@/components/public/rotating-badge'
import { EventsGridClient } from '@/components/public/events-grid-client'
import { CityTicker } from '@/components/public/city-ticker'
import { getUpcomingPublishedShows, formatShowTime, type PublicShow } from '@/lib/public-events'
import { getOsloToday, formatDayLabel } from '@/lib/event-filters'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'Tickethalo — find stand-up near you',
  description: 'Browse upcoming stand-up shows and buy tickets to Tickethalo events.',
}

export const dynamic = 'force-dynamic'

/**
 * One line of real status under the title, instead of a static subtitle.
 * "3 shows tonight — first at 19:30" says more in half a second than any
 * marketing sentence does in five.
 */
function heroStatus(shows: PublicShow[], today: string): string | null {
  if (shows.length === 0) return null

  const tonight = shows
    .filter((show) => show.date.slice(0, 10) === today)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))

  if (tonight.length > 0) {
    const cities = new Set(tonight.map((show) => show.clubCity).filter(Boolean))
    const where = cities.size === 1 ? ` in ${[...cities][0]}` : cities.size > 1 ? ` in ${cities.size} cities` : ''
    const first = tonight[0].start_time ? ` — first at ${formatShowTime(tonight[0]).slice(0, 5)}` : ''
    return `${tonight.length} ${tonight.length === 1 ? 'show' : 'shows'} tonight${where}${first}`
  }

  const next = shows[0]
  const where = next.clubCity ? ` in ${next.clubCity}` : ''
  // "Today"/"Tomorrow" read best lowercased mid-sentence; a dated label
  // ("Wed 21 Aug") keeps its capitals and takes a preposition instead.
  const label = formatDayLabel(next.date, today)
  const when = label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : `on ${label}`
  return `Next show ${when}${where}`
}

export default async function Page() {
  const shows = await getUpcomingPublishedShows(20)
  const today = getOsloToday()
  const status = heroStatus(shows, today)

  return (
    <main
      // The document root is still lang="nb" for the Norwegian portals. This
      // page is English, and without its own language code screen readers
      // would read it with Norwegian pronunciation — WCAG 3.1.2.
      lang="en"
      className="ev-surface min-h-screen bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      {/* Rotating badge — scroll-to-events */}
      <RotatingBadge
        text="BROWSE"
        hideAfter={160}
        showIcon
        icon={
          <Image
            src="/arrow-down.png"
            alt=""
            width={48}
            height={48}
            className="w-6 h-6 md:w-7 md:h-7 lg:w-12 lg:h-12"
          />
        }
      />

      {/* Hero — cut short so the first show row breaks the fold.
          One highlighted surface instead of four boxes bolted together: the
          city is the only coloured thing, and the only thing that moves. */}
      <section className="px-4 pb-6 pt-20 md:px-8 md:pb-12 md:pt-32 lg:pt-36">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-4 text-balance text-[2rem] font-medium leading-[1.05] tracking-[-0.035em] sm:text-6xl md:text-7xl">
            <span
              className="animate-fade-in block"
              style={{ animationDelay: '0.05s', animationFillMode: 'both' }}
            >
              Explore stand-up
            </span>
            <span
              className="animate-fade-in mt-1 flex items-baseline justify-center gap-[0.22em] leading-[1.3] sm:mt-2"
              style={{ animationDelay: '0.14s', animationFillMode: 'both' }}
            >
              <span>in</span>
              {/* No overflow-hidden here — CityTicker clips itself, and a clip
                  at this level would also constrain the width measurement inside. */}
              {/* White on orange only holds 3.1:1 — enough for display type
                  (WCAG "large text"), but not otherwise. Hence it is set here
                  rather than via --ev-accent-ink, which the rest of the site
                  uses for small text on the same surface. */}
              <span className="rounded-full bg-[var(--ev-accent-fill)] px-[0.3em] pb-[0.1em] pt-[0.04em] text-white">
                <CityTicker />
              </span>
            </span>
          </h1>

          {status && (
            <p
              className="animate-fade-in flex items-center justify-center gap-2 text-[17px] text-[var(--ev-muted)] sm:text-[14px]"
              style={{ animationDelay: '0.33s', animationFillMode: 'both' }}
            >
              <span
                aria-hidden
                className="inline-block size-2 rounded-full bg-[var(--ev-accent-fill)] sm:size-1.5"
              />
              {status}
            </p>
          )}
        </div>
      </section>

      <EventsGridClient shows={shows} today={today} />

      <Footer />
    </main>
  )
}
