import Image from 'next/image'
import { PublicHeader } from '@/components/public/public-header'
import { RotatingBadge } from '@/components/public/rotating-badge'
import { EventsGridClient } from '@/components/public/events-grid-client'
import { CityTicker } from '@/components/public/city-ticker'
import { getUpcomingPublishedShows, formatShowTime, type PublicShow } from '@/lib/public-events'
import { getOsloToday, formatDayLabel } from '@/lib/event-filters'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'humor.events — finn stand-up nær deg',
  description: 'Se kommende stand-up show og kjøp billetter til humor.events-arrangementer.',
}

export const dynamic = 'force-dynamic'

/**
 * Én linje ekte status under tittelen, i stedet for en statisk undertekst.
 * «3 show i kveld — første kl. 19:30» sier mer på et halvt sekund enn
 * noen markedsføringssetning gjør på fem.
 */
function heroStatus(shows: PublicShow[], today: string): string | null {
  if (shows.length === 0) return null

  const tonight = shows
    .filter((show) => show.date.slice(0, 10) === today)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))

  if (tonight.length > 0) {
    const cities = new Set(tonight.map((show) => show.clubCity).filter(Boolean))
    const where = cities.size === 1 ? ` i ${[...cities][0]}` : cities.size > 1 ? ` i ${cities.size} byer` : ''
    const first = tonight[0].start_time ? ` — første kl. ${formatShowTime(tonight[0]).slice(0, 5)}` : ''
    return `${tonight.length} show i kveld${where}${first}`
  }

  const next = shows[0]
  const where = next.clubCity ? ` i ${next.clubCity}` : ''
  return `Neste show ${formatDayLabel(next.date, today).toLowerCase()}${where}`
}

export default async function Page() {
  const shows = await getUpcomingPublishedShows(20)
  const today = getOsloToday()
  const status = heroStatus(shows, today)

  return (
    <main
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

      {/* Hero — kortet ned så første showrad bryter skjermkanten.
          Én uthevet flate i stedet for fire sammenskrudde bokser: byen
          er det eneste som er farget, og det er også det eneste som beveger seg. */}
      <section className="px-4 pb-10 pt-28 md:px-8 md:pb-12 md:pt-32 lg:pt-36">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-5 text-balance text-[2.5rem] font-medium leading-[1.05] tracking-[-0.035em] sm:text-6xl md:text-7xl">
            <span
              className="animate-fade-in block"
              style={{ animationDelay: '0.05s', animationFillMode: 'both' }}
            >
              Utforsk stand-up
            </span>
            <span
              className="animate-fade-in mt-1 flex items-baseline justify-center gap-[0.22em] leading-[1.3] sm:mt-2"
              style={{ animationDelay: '0.14s', animationFillMode: 'both' }}
            >
              <span>i</span>
              {/* Ingen overflow-hidden her — CityTicker klipper selv, og et klipp
                  på dette nivået ville også begrenset breddemålingen inni. */}
              <span className="rounded-full bg-[var(--ev-accent-fill)] px-[0.3em] pb-[0.1em] pt-[0.04em] text-[var(--ev-accent-ink)]">
                <CityTicker />
              </span>
            </span>
          </h1>

          {status && (
            <p
              className="animate-fade-in flex items-center justify-center gap-2 text-[14px] text-[var(--ev-muted)]"
              style={{ animationDelay: '0.33s', animationFillMode: 'both' }}
            >
              <span
                aria-hidden
                className="inline-block size-1.5 rounded-full bg-[var(--ev-accent-fill)]"
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
