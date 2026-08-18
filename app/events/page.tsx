import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { EventCard } from '@/components/public/event-card'
import { PublicHeader } from '@/components/public/public-header'
import { getUpcomingPublishedShows } from '@/lib/public-events'
import { getOsloToday } from '@/lib/event-filters'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'Events — humor.events',
  description: 'Alle publiserte kommende humor.events-show med plakater, pris og billetter.',
}

export const dynamic = 'force-dynamic'

export default async function EventsPage() {
  const shows = await getUpcomingPublishedShows()
  const today = getOsloToday()

  return (
    <main className="ev-surface min-h-screen bg-[var(--ev-bg)] text-[var(--ev-text)]" data-tone="light">
      <section className="">
        <PublicHeader transparent tone="light" />
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-28 md:px-6 md:pb-14 lg:px-8">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-medium transition-colors hover:text-[var(--ev-accent)]">
            <ArrowLeft className="size-4" /> Til forsiden
          </Link>
          <div className="mt-4">
            <div className="mb-4 inline-flex border border-[var(--ev-line-strong)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em]">Program</div>
            <h1 className="text-5xl font-medium sm:text-6xl md:text-7xl">Kommende events</h1>
            <p className="mt-4 max-w-xl text-base text-[var(--ev-muted)]">Publiserte show, scener og billetter fra i dag og fremover.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-5 md:px-6 lg:px-8">
        <div className="mb-5 flex items-end justify-between gap-4 border-b border-[var(--ev-line-strong)] pb-3">
          <h2 className="text-2xl font-medium">Alle show</h2>
          <Link href="/artists" className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-[var(--ev-accent)]">
            Artister <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-5 [&>*+*]:border-t [&>*+*]:border-[var(--ev-line)] [&>*+*]:pt-5 sm:grid-cols-2 sm:[&>*+*]:border-0 sm:[&>*+*]:pt-0 lg:grid-cols-3">
          {shows.map((show, index) => (
            <EventCard key={show.id} show={show} today={today} priority={index < 3} />
          ))}
        </div>
        {shows.length === 0 && (
          <div className="border border-dashed border-[var(--ev-line-strong)] p-10 text-center text-sm text-[var(--ev-muted)]">
            Ingen publiserte kommende events.
          </div>
        )}
      </section>
      <Footer/>
    </main>
  )
}