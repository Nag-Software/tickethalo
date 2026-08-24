import { PublicHeader } from '@/components/public/public-header'
import { HomeHero } from '@/components/public/home-hero'
import { EventsGridClient } from '@/components/public/events-grid-client'
import { getUpcomingPublishedShows } from '@/lib/public-events'
import { getOsloToday } from '@/lib/event-filters'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'Tickethalo — the easiest way to run a comedy club',
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

      <HomeHero />

      <EventsGridClient shows={shows} today={today} />

      <Footer />
    </main>
  )
}
