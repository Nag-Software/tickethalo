import Image from 'next/image'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { MapPin } from 'lucide-react'
import { PublicShowFeedPage } from '@/components/public/public-show-feed-page'
import { getUpcomingPublishedShowsForClub } from '@/lib/public-events'
import { getPublicClubBySlug } from '@/lib/public-clubs'
import { shouldBypassImageOptimization } from '@/lib/utils'

type Props = {
  params: Promise<{ slug: string }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const club = await getPublicClubBySlug(slug)

  if (!club) {
    return { title: 'Klubb ikke funnet — humor.events' }
  }

  const description = club.description ?? `${club.name} på humor.events.${club.city ? ` Stand-up i ${club.city}.` : ''}`
  const canonical = `/${club.slug}`

  return {
    title: `${club.name} — humor.events`,
    description,
    alternates: { canonical },
    openGraph: {
      title: club.name,
      description,
      type: 'website',
      url: canonical,
      images: club.header_image_url || club.logo_url ? [{ url: club.header_image_url ?? club.logo_url!, alt: club.name }] : undefined,
    },
  }
}

export default async function ClubPage({ params }: Props) {
  const { slug } = await params
  const club = await getPublicClubBySlug(slug)

  if (!club) notFound()

  const shows = await getUpcomingPublishedShowsForClub(club.id, 20)

  return (
    <PublicShowFeedPage
      shows={shows}
      headerEventsHref={`/${club.slug}`}
      badgeText=""
      badgeHideText
      badgeBackgroundFill="#ffe44d"
      badgeBackgroundStroke="#ffe44d"
      badgeShowIcon={Boolean(club.logo_url)}
      badgeIcon={club.logo_url ? (
        <div className="relative h-[72%] w-[72%] md:h-[74%] md:w-[74%] lg:h-[78%] lg:w-[78%]">
          <Image
            src={club.logo_url}
            alt={club.name}
            fill
            priority
            unoptimized={shouldBypassImageOptimization(club.logo_url)}
            sizes="(max-width: 768px) 52px, 120px"
            className="object-contain"
          />
        </div>
      ) : undefined}
      heroSectionClassName="px-4 pt-24 pb-8 md:px-8 md:pt-32 md:pb-10"
      hero={
        <div className="space-y-4 md:space-y-5">

          <div className="space-y-3">
            <h1 className="mt-5 text-4xl font-medium tracking-tight text-black sm:text-5xl md:text-[4.5rem] animate-fade-in" style={{ animationDelay: '0.35s', animationFillMode: 'both' }}>
              {club.name}
            </h1>
            <p className="mx-auto max-w-xl text-base leading-relaxed text-zinc-600 sm:text-lg animate-fade-in" style={{ animationDelay: '0.45s', animationFillMode: 'both' }}>
              {club.description ?? `Utforsk kommende stand-up-kvelder hos ${club.name}.${club.city ? ` Klubbkveldene skjer i ${club.city}.` : ''}`}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-zinc-500 animate-fade-in" style={{ animationDelay: '0.55s', animationFillMode: 'both' }}>
            {club.location_name ? <span className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-1.5 text-black"><MapPin className="size-3.5" /> {club.location_name}</span> : null}
            {club.city ? <span className="rounded-xl border border-border px-3 py-1.5 text-black">{club.city}</span> : null}
          </div>
        </div>
      }
    />
  )
}