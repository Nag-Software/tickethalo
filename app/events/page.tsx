import { PublicHeader } from '@/components/public/public-header'
import { EventsGridClient } from '@/components/public/events-grid-client'
import { CityTicker } from '@/components/public/city-ticker'
import { getUpcomingPublishedShows } from '@/lib/public-events'
import { getOsloToday } from '@/lib/event-filters'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'Tickethalo — find stand-up near you',
  description: 'Browse upcoming stand-up shows and buy tickets to Tickethalo events.',
}

export const dynamic = 'force-dynamic'

export default async function Page() {
  const shows = await getUpcomingPublishedShows(20)
  const today = getOsloToday()

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

      {/* Hero — cut short so the first show row breaks the fold.
          One highlighted surface instead of four boxes bolted together: the
          city is the only coloured thing, and the only thing that moves. */}
      <section className="px-4 pb-6 pt-25 md:px-8 md:pb-12 md:pt-32 lg:pt-36">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="mb-4 text-balance text-[2rem] font-medium leading-[1.05] tracking-[-0.035em] sm:text-6xl md:text-7xl">
            <span
              className="animate-fade-in block"
              style={{ animationDelay: '0.05s', animationFillMode: 'both' }}
            >
              Explore comedy
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
        </div>
      </section>

      <EventsGridClient shows={shows} today={today} />

      <Footer />
    </main>
  )
}
