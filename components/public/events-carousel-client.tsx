'use client'

import Image from 'next/image'
import Link from 'next/link'
import { getPublicShowHref, type PublicShow } from '@/lib/public-events'

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

function formatCarouselDate(show: Pick<PublicShow, 'date' | 'start_time'>) {
  const dt = new Date(`${show.date}T${show.start_time}`)
  return `${MONTHS[dt.getMonth()]} ${dt.getDate()}`
}

function formatCarouselTime(show: Pick<PublicShow, 'start_time'>) {
  return show.start_time?.slice(0, 5) ?? ''
}

interface Props {
  shows: Pick<PublicShow, 'id' | 'title' | 'slug' | 'date' | 'start_time' | 'poster_url' | 'venue_name' | 'venue_address' | 'clubSlug'>[]
}

export function EventsCarouselClient({ shows }: Props) {
  if (shows.length === 0) return null

  const multiplied = [...shows, ...shows]

  return (
    <div className="w-full overflow-hidden py-12 pb-20 md:pb-24">
      <div className="relative overflow-hidden">
        <div className="flex gap-px w-max animate-scroll-left-fast will-change-transform">
          {multiplied.map((show, index) => (
            <Link
              key={`${show.id}-${index}`}
              href={getPublicShowHref(show)}
              className="relative flex-shrink-0 w-auto min-h-[400px] aspect-[3/4] max-h-[500px] overflow-hidden animate-fade-in block"
              style={{ animationDelay: `${index * 0.1}s`, animationFillMode: 'both' }}
            >
              {show.poster_url ? (
                <Image
                  src={show.poster_url}
                  alt={show.title}
                  fill
                  className="object-contain"
                  loading="lazy"
                  sizes="(max-width: 768px) 65vw, 40vw"
                />
              ) : (
                <div className="w-full h-full bg-zinc-900 flex items-end p-6">
                  <span className="text-white text-2xl font-medium">{show.title}</span>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />

              <div className="absolute top-4 left-4 flex flex-col gap-0">
                <div className="bg-white border border-border px-3 h-[23px] flex items-center">
                  <div className="text-xs font-medium uppercase leading-none">{formatCarouselDate(show)}</div>
                </div>
                <div className="bg-white border border-t-0 border-border px-3 h-[23px] flex items-center">
                  <div className="text-xs font-medium uppercase leading-none">{formatCarouselTime(show)}</div>
                </div>
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-6 md:p-8 text-white">
                <h3 className="text-xl md:text-2xl font-medium mb-1 tracking-tight">{show.title}</h3>
                <p className="text-sm md:text-base text-white/80">{show.venue_name ?? show.venue_address ?? ''}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
