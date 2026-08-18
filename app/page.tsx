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

      {/* Hero — kortet ned så første showrad bryter skjermkanten */}
      <section className="px-4 pb-10 pt-28 md:px-8 md:pb-12 md:pt-32 lg:pt-36">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-5 inline-flex flex-col items-center text-3xl font-medium sm:text-4xl md:text-5xl">
            <div className="flex items-center">
              <span
                className="animate-fade-in border border-[var(--ev-text)] px-3 py-2 md:px-6 md:py-4"
                style={{ animationDelay: '0.05s', animationFillMode: 'both' }}
              >
                Utforsk
              </span>
              <span
                className="animate-fade-in rounded-[40px] border border-l-0 border-[var(--ev-text)] bg-[#ff6bff] px-3 py-2 text-[#0b0a0d] md:px-6 md:py-4"
                style={{ animationDelay: '0.12s', animationFillMode: 'both' }}
              >
                stand-up
              </span>
            </div>
            <div className="-mt-px flex items-center">
              <span
                className="animate-fade-in border border-[var(--ev-text)] px-3 py-2 md:px-6 md:py-4"
                style={{ animationDelay: '0.19s', animationFillMode: 'both' }}
              >
                i
              </span>
              {/* City ticker — overflow:hidden klipper drop-in/out-animasjonen */}
              <span
                className="animate-fade-in relative overflow-hidden border border-l-0 border-[var(--ev-text)] px-3 py-2 md:px-6 md:py-4"
                style={{ animationDelay: '0.26s', animationFillMode: 'both' }}
              >
                {/* Usynlig lengste bynavn låser boksbredden */}
                <span aria-hidden className="invisible">Stavanger</span>
                <CityTicker />
              </span>
            </div>
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
