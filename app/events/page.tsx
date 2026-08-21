import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { EventCard } from '@/components/public/event-card'
import { PublicHeader } from '@/components/public/public-header'
import { getUpcomingPublishedShows } from '@/lib/public-events'
import { getOsloToday } from '@/lib/event-filters'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'Events — Tickethalo',
  description: 'Every published upcoming Tickethalo show, with posters, prices and tickets.',
}

export const dynamic = 'force-dynamic'

export default async function EventsPage() {
  const shows = await getUpcomingPublishedShows()
  const today = getOsloToday()

  return (
    <main
      // The document root is still lang="nb" for the Norwegian portals — see
      // app/page.tsx for why this page declares its own language.
      lang="en"
      className="ev-surface min-h-screen bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <section className="">
        <PublicHeader transparent tone="light" />
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-28 md:px-6 md:pb-14 lg:px-8">
          <Link href="/" className="-ml-2 mb-6 inline-flex h-11 items-center gap-2 rounded-full px-2 text-[15px] font-medium transition-colors hover:text-[var(--ev-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:ml-0 sm:mb-8 sm:h-auto sm:px-0 sm:text-sm">
            <ArrowLeft className="size-4" aria-hidden /> Back to home
          </Link>
          <div className="mt-4">
            <div className="mb-4 inline-flex border border-[var(--ev-line-strong)] px-2.5 py-1 text-[12px] font-bold uppercase tracking-[0.2em] sm:text-[10px] sm:tracking-[0.22em]">Program</div>
            <h1 className="text-5xl font-medium sm:text-6xl md:text-7xl">Upcoming events</h1>
            <p className="mt-4 max-w-xl text-[18px] text-[var(--ev-muted)] sm:text-base">Published shows, venues and tickets from today onwards.</p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-5 md:px-6 lg:px-8">
        <div className="mb-5 flex items-end justify-between gap-4 border-b border-[var(--ev-line-strong)] pb-3">
          <h2 className="text-2xl font-medium">All shows</h2>
          <Link href="/artists" className="-mr-2 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-[15px] font-medium transition-colors hover:text-[var(--ev-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:mr-0 sm:h-auto sm:px-0 sm:text-sm">
            Comedians <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-5 [&>*+*]:border-t [&>*+*]:border-[var(--ev-line)] [&>*+*]:pt-5 sm:grid-cols-2 sm:[&>*+*]:border-0 sm:[&>*+*]:pt-0 lg:grid-cols-3">
          {shows.map((show, index) => (
            <EventCard key={show.id} show={show} today={today} priority={index < 3} />
          ))}
        </div>
        {shows.length === 0 && (
          <div className="border border-dashed border-[var(--ev-line-strong)] p-10 text-center text-[17px] text-[var(--ev-muted)] sm:text-sm">
            No published upcoming events.
          </div>
        )}
      </section>
      <Footer/>
    </main>
  )
}