import Image from 'next/image'
import Link from 'next/link'
import { ArrowUpRight, MapPin } from 'lucide-react'
import { Footer } from '@/components/Footer'
import { PublicHeader } from '@/components/public/public-header'
import { RotatingBadge } from '@/components/public/rotating-badge'
import { formatShortDate } from '@/lib/public-events'
import { getPublicClubs } from '@/lib/public-clubs'
import { shouldBypassImageOptimization } from '@/lib/utils'
import { CityTicker } from '@/components/public/city-ticker'

export const metadata = {
  title: 'humor.events — velg komiklubb',
  description: 'Velg komiklubb og gå videre til klubbens egen offentlige side.',
}

export const dynamic = 'force-dynamic'

export default async function Page() {
  const clubs = await getPublicClubs()

  return (
    <main className="min-h-screen bg-white text-black">
      <PublicHeader transparent tone="light" />

      <RotatingBadge
        text="LØYE"
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
      <section className="pt-32 md:pt-40 lg:pt-48 pb-6 md:pb-16 lg:pb-24 px-4 md:px-8">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-medium mb-2 inline-flex flex-col items-center">
            <div className="flex items-center">
              <span className="border border-black px-3 md:px-6 py-2 md:py-4 animate-fade-in" style={{ animationDelay: '0.3s', animationFillMode: 'both' }}>Finn</span>
              <span className="border border-l-0 border-1.5 rounded-[40px] bg-[#ff6bff] border-black px-3 md:px-6 py-2 md:py-4 animate-fade-in" style={{ animationDelay: '0.4s', animationFillMode: 'both' }}>stand-up</span>
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

      <section className="px-4 pb-16 md:px-8 md:pb-24">
        <div className="mx-auto max-w-7xl">
          {clubs.length === 0 ? (
            <div className="border border-black bg-white px-6 py-16 text-center">
              <p className="text-sm uppercase tracking-[0.22em] text-zinc-500">Ingen klubber tilgjengelig ennå.</p>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {clubs.map((club, index) => {
                const nextShowLabel = club.nextShowDate ? formatShortDate(club.nextShowDate).replace('.', '') : null

                return (
                  <Link
                    key={club.id}
                    href={`/${club.slug}`}
                    className="group animate-fade-in overflow-hidden border border-black bg-white transition hover:-translate-y-0.5 hover:shadow-[4px_4px_0_rgba(0,0,0,0.12)]"
                    style={{ animationDelay: `${0.8 + index * 0.08}s`, animationFillMode: 'both' }}
                  >
                    <div className="relative aspect-[16/10] overflow-hidden border-b border-black bg-zinc-950">
                      {club.header_image_url ? (
                        <Image
                          src={club.header_image_url}
                          alt={club.name}
                          fill
                          sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                          unoptimized={shouldBypassImageOptimization(club.header_image_url)}
                          className="object-cover transition duration-500 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full flex-col justify-between bg-black p-5 text-white">
                          <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">humor.events</span>
                          <strong className="text-3xl font-medium leading-none">{club.name}</strong>
                        </div>
                      )}

                      <div className="absolute left-4 top-4 flex items-center gap-2 border border-black bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-black">
                        <span>{club.upcomingShowCount} show</span>
                        {nextShowLabel ? <span className="text-zinc-500">Neste {nextShowLabel}</span> : null}
                      </div>

                      {club.logo_url ? (
                        <div className="absolute bottom-4 right-4 overflow-hidden rounded-full border border-black bg-white">
                          <Image
                            src={club.logo_url}
                            alt={club.name}
                            width={56}
                            height={56}
                            unoptimized={shouldBypassImageOptimization(club.logo_url)}
                            className="h-14 w-14 object-cover"
                          />
                        </div>
                      ) : null}
                    </div>

                    <div className="flex h-full flex-col gap-5 p-5">
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="mb-2 inline-flex border border-black px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-700">
                              {club.slug}
                            </div>
                            <h2 className="text-2xl font-medium leading-tight">{club.name}</h2>
                          </div>
                          <ArrowUpRight className="size-5 shrink-0 text-zinc-500 transition group-hover:text-[#ff6bff]" />
                        </div>

                        <p className="text-sm leading-relaxed text-zinc-600">
                          {club.description ?? `Se programmet til ${club.name} og finn neste stand-up-kveld.`}
                        </p>
                      </div>

                      <div className="mt-auto flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                        {club.city ? <span className="inline-flex items-center gap-1.5 border border-black px-3 py-1.5 text-black"><MapPin className="size-3.5" /> {club.city}</span> : null}
                        {club.location_name ? <span className="border border-black px-3 py-1.5 text-black">{club.location_name}</span> : null}
                        {!club.location_name && club.address_line ? <span className="border border-black px-3 py-1.5 text-black">{club.address_line}</span> : null}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <Footer />
    </main>
  )
}


