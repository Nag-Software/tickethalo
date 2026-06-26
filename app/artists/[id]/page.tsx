import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft, ArrowUpRight, CalendarDays, Languages, MapPin, Mic2 } from 'lucide-react'
import { formatArtistRoleSummary } from '@/lib/artist-roles'
import { artistDisplayName, artistInitials, getPublicArtistById, getPublicArtistShows } from '@/lib/public-artists'
import { getPublicShowHref } from '@/lib/public-events'
import { getPublicAppUrl } from '@/lib/app-url'
import { shouldBypassImageOptimization } from '@/lib/utils'
import { PublicHeader } from '@/components/public/public-header'
import { formatShortDate, formatShowTime } from '@/lib/public-events'
import { Footer } from '@/components/Footer'

type Props = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const artist = await getPublicArtistById(id)
  if (!artist) return { title: 'Artist ikke funnet — humor.events' }
  const name = artistDisplayName(artist)

  return {
    title: `${name} — humor.events`,
    description: artist.bio ?? `${name} i humor.events-lineupen.`,
    openGraph: {
      title: name,
      description: artist.bio ?? `${name} i humor.events-lineupen.`,
      images: artist.profile_image_url ? [{ url: artist.profile_image_url, alt: name }] : undefined,
    },
  }
}

export default async function ArtistDetailPage({ params }: Props) {
  const { id } = await params
  // Both fetches key off the route id and are independent — run them concurrently
  // instead of serializing artist → shows.
  const [artist, shows] = await Promise.all([getPublicArtistById(id), getPublicArtistShows(id)])
  if (!artist) notFound()

  const name = artistDisplayName(artist)
  const socials = Object.entries(artist.social_links ?? {}).filter((entry): entry is [string, string] => Boolean(entry[1]))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name,
    jobTitle: 'Komiker',
    url: `${getPublicAppUrl()}/artists/${artist.id}`,
    ...(artist.bio ? { description: artist.bio } : {}),
    ...(artist.profile_image_url ? { image: artist.profile_image_url } : {}),
    ...(socials.length ? { sameAs: socials.map(([, href]) => href) } : {}),
  }

  return (
    <main className="public-shell min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="border-b border-border">
        <PublicHeader transparent tone="light" />
        <div className="mx-auto grid max-w-6xl gap-8 px-4 pb-10 pt-28 md:grid-cols-[320px_1fr] md:items-end md:px-6 md:pb-14 lg:px-8">
          <div className="relative aspect-[4/5] overflow-hidden bg-zinc-100">
            {artist.profile_image_url ? (
              <Image
                src={artist.profile_image_url}
                alt={name}
                fill
                preload
                sizes="(max-width: 768px) 92vw, 320px"
                unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
                className="object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-black text-6xl font-medium text-white">
                {artistInitials(artist)}
              </div>
            )}
          </div>
          <div className="py-4">
            <Link href="/artists" className="mb-6 inline-flex items-center gap-2 text-sm font-medium transition-colors hover:text-vipps-orange-80">
              <ArrowLeft className="size-4" /> Alle komikere
            </Link>
            <h1 className="text-5xl font-medium sm:text-6xl md:text-7xl">{name}</h1>
            {artist.stage_name && <p className="mt-3 text-lg text-zinc-600">{artist.full_name}</p>}
            <div className="mt-7 grid border-y border-border sm:grid-cols-2">
              <Info icon={<Mic2 className="size-5" />} label="Kategori" text={formatArtistRoleSummary(artist.category, 'Komiker')} />
              <Info icon={<Languages className="size-5" />} label="Språk" text={artist.language ?? 'Ukjent'} />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-12 md:grid-cols-[1fr_280px] md:px-6 lg:px-8">
        <div className="space-y-10">
          {artist.bio && (
            <div>
              <h2 className="border-b border-border pb-3 text-2xl font-medium">Om komikeren</h2>
              <p className="mt-4 whitespace-pre-wrap text-zinc-600">{artist.bio}</p>
            </div>
          )}

          <div>
            <h2 className="border-b border-border pb-3 text-2xl font-medium">Kommende events</h2>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              {shows.map((show) => (
                <Link key={show.id} href={getPublicShowHref(show)} className="group relative cursor-pointer block">
                  <div className="overflow-hidden mb-3 aspect-square bg-gray-100 relative">
                    {show.poster_url ? (
                      <Image
                        src={show.poster_url}
                        alt={show.title}
                        fill
                        sizes="(max-width: 768px) 92vw, 45vw"
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full flex-col justify-between bg-black p-4 text-white">
                        <span className="text-xs font-bold uppercase tracking-widest">humor.events</span>
                        <strong className="text-2xl font-medium leading-none">{show.title}</strong>
                      </div>
                    )}
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-medium leading-tight">{show.title}</h3>
                    <ArrowUpRight className="size-4 shrink-0 text-zinc-400 transition group-hover:text-vipps-orange" />
                  </div>
                  <div className="mt-2 grid gap-1 text-sm text-zinc-500">
                    <span className="flex items-center gap-2"><CalendarDays className="size-4" />{formatShortDate(show.date)} · {formatShowTime(show)}</span>
                    <span className="flex items-center gap-2"><MapPin className="size-4" />{show.venue_address ?? 'Sted kommer'}</span>
                  </div>
                </Link>
              ))}
              {shows.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-zinc-500">Ingen publiserte kommende events.</div>
              )}
            </div>
          </div>
        </div>

        <aside className="h-fit rounded-2xl border border-border p-5 md:sticky md:top-6">
          <h2 className="font-medium uppercase tracking-tight">Profil</h2>
          {socials.length > 0 && (
            <div className="mt-4 space-y-2">
              {socials.map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${label} (åpnes i ny fane)`}
                  className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm font-medium transition hover:bg-black hover:text-white"
                >
                  <span className="capitalize">{label}</span>
                  <ArrowUpRight className="size-4" aria-hidden />
                </a>
              ))}
            </div>
          )}
        </aside>
      </section>
      <Footer/>
    </main>
  )
}

function Info({ icon, text, label }: { icon: React.ReactNode; text: string; label: string }) {
  return (
    <div className="flex items-center gap-3 border-border p-3 text-sm last:border-b-0 sm:border-r sm:even:border-r-0">
      <span className="text-zinc-400">{icon}</span>
      <span>
        <span className="block text-xs font-bold uppercase tracking-widest text-zinc-500">{label}</span>
        <span className="font-medium">{text}</span>
      </span>
    </div>
  )
}
