import Image from 'next/image'
import { PublicHeader } from '@/components/public/public-header'
import { RotatingBadge } from '@/components/public/rotating-badge'
import { EventsGridClient } from '@/components/public/events-grid-client'
import { PublicEventCard } from '@/components/public/public-event-card'
import { CityTicker } from '@/components/public/city-ticker'
import { getUpcomingPublishedShows } from '@/lib/public-events'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'humor.events — finn stand-up nær deg',
  description: 'Se kommende stand-up show og kjøp billetter til humor.events-arrangementer.',
}

export const dynamic = 'force-dynamic'

export default async function Page() {
  const shows = await getUpcomingPublishedShows(20)

  return (
    <main className="min-h-screen bg-white text-black">
      <PublicHeader transparent tone="light" />

      {/* Rotating badge */}
      <RotatingBadge
        text="BROWSE"
        showIcon
        icon={
          <Image
            src="/arrow-down.png"
            alt="Arrow down"
            width={48}
            height={48}
            className="w-6 h-6 md:w-7 md:h-7 lg:w-12 lg:h-12"
          />
        }
      />

      {/* Hero */}
      <section className="pt-32 md:pt-44 pb-14 md:pb-20 px-4 md:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-medium inline-flex flex-col items-center">
            <div className="flex items-center">
              <span className="border border-black px-3 md:px-6 py-2 md:py-4 animate-fade-in" style={{ animationDelay: '0.3s', animationFillMode: 'both' }}>Utforsk</span>
              <span className="border border-l-0 rounded-[40px] bg-[#ff6bff] border-black px-3 md:px-6 py-2 md:py-4 animate-fade-in" style={{ animationDelay: '0.4s', animationFillMode: 'both' }}>stand-up</span>
            </div>
            <div className="flex items-center -mt-px">
              <span className="border border-black px-3 md:px-6 py-2 md:py-4 animate-fade-in" style={{ animationDelay: '0.5s', animationFillMode: 'both' }}>i</span>
              {/* City ticker — overflow:hidden clips the drop-in/out animation */}
              <span className="relative border border-l-0 border-black overflow-hidden px-3 md:px-6 py-2 md:py-4 animate-fade-in" style={{ animationDelay: '0.6s', animationFillMode: 'both' }}>
                {/* Invisible widest city to fix box size */}
                <span aria-hidden className="invisible">Stavanger</span>
                <CityTicker />
              </span>
            </div>
          </h1>
        </div>
      </section>

      {/* Kommende show — featured spotlight */}
      {shows.length > 0 && (
        <section className="px-4 md:px-8 pt-2 pb-4">
          <div className="max-w-6xl mx-auto">
          <p className="hidden sm:block text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-400 mb-5 animate-fade-in" style={{ animationDelay: '0.7s', animationFillMode: 'both' }}>
            Kommende show
          </p>
          <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {shows.slice(0, 3).map((show, i) => (
              <div
                key={show.id}
                className="animate-fade-in"
                style={{ animationDelay: `${0.75 + i * 0.1}s`, animationFillMode: 'both' }}
              >
                <PublicEventCard show={show} priority={i === 0} />
              </div>
            ))}
          </div>
          </div>
        </section>
      )}

      {/* Date-filtered event grid */}
      <EventsGridClient shows={shows} />

      <Footer />
    </main>
  )
}


