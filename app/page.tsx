import { Bricolage_Grotesque } from 'next/font/google'
import { Discover } from '@/components/landing/discover'
import { ForClubs, ForComedians, LandingFooter } from '@/components/landing/sections'
import { getUpcomingPublishedShows } from '@/lib/public-events'
import { getOsloToday } from '@/lib/event-filters'
import { cn } from '@/lib/utils'

// EKSPERIMENTELL forside (branch experimental/landing-v2) — ikke merge til main.

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display' })

export const metadata = {
  title: 'Tickethalo — comedy nights near you',
  description: 'The best stand-up comedy nights in your city. Pick a show, grab a ticket, done.',
}

export const dynamic = 'force-dynamic'

export default async function Page() {
  const shows = await getUpcomingPublishedShows(24)
  const today = getOsloToday()

  return (
    <main
      lang="en"
      className={cn(display.variable, 'ev-surface min-h-screen bg-[var(--ev-bg)] text-[var(--ev-text)]')}
      data-tone="light"
    >
      <Discover shows={shows} today={today} />
      <ForClubs />
      <ForComedians />
      <LandingFooter />
    </main>
  )
}
