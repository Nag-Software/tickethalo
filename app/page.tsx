import { SiteHeader } from '@/components/public/v2/site-header'
import { HeroV2, AudienceSections } from '@/components/public/v2/home-sections'
import { ShowList } from '@/components/public/v2/show-list'
import { getUpcomingPublishedShows } from '@/lib/public-events'
import { getOsloToday } from '@/lib/event-filters'
import { Footer } from '@/components/Footer'

// EKSPERIMENTELL forside (branch experimental/landing-v2) — ikke merge til main.
// Gammel versjon: se app/page.tsx på main.

export const metadata = {
  title: 'Tickethalo — great comedy nights, one tap away',
  description: 'Find stand-up comedy near you and get tickets in seconds.',
}

export const dynamic = 'force-dynamic'

export default async function Page() {
  const shows = await getUpcomingPublishedShows(20)
  const today = getOsloToday()

  return (
    <main lang="en" className="ev-surface min-h-screen bg-[var(--ev-bg)] text-[var(--ev-text)]" data-tone="light">
      <SiteHeader />
      <HeroV2 showCount={shows.length} />
      <ShowList shows={shows} today={today} />
      <AudienceSections />
      <Footer />
    </main>
  )
}
