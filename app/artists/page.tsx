import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react'
import { formatArtistRoleSummary } from '@/lib/artist-roles'
import { artistDisplayName, artistInitials, getPublicArtists } from '@/lib/public-artists'
import { shouldBypassImageOptimization } from '@/lib/utils'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'Artister — humor.events',
  description: 'Se godkjente komikere og artister i humor.events-lineupen.',
}

export const dynamic = 'force-dynamic'

export default async function ArtistsPage() {
  const artists = await getPublicArtists()

  return (
    <main className="public-shell min-h-screen bg-background text-foreground">
      <section className="">
        <PublicHeader transparent tone="light" />
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-28 md:px-6 md:pb-14 lg:px-8">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-medium transition-colors hover:text-vipps-orange-80">
            <ArrowLeft className="size-4" /> Forsiden
          </Link>
          <div className="mt-4 grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <h1 className="text-5xl font-medium sm:text-6xl md:text-7xl">Våre Komikere</h1>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 md:px-6 lg:px-8">
        <div className="mb-5 flex items-end justify-between gap-4">
          <h2 className="text-2xl font-medium">Alle artister</h2>
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-vipps-orange-80">
            Events <ArrowRight className="size-4" />
          </Link>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {artists.map((artist) => (
            <Link key={artist.id} href={`/artists/${artist.id}`} className="group relative cursor-pointer block">
              <div className="overflow-hidden mb-3 aspect-square bg-gray-100 relative">
                {artist.profile_image_url ? (
                  <Image
                    src={artist.profile_image_url}
                    alt={artistDisplayName(artist)}
                    fill
                    sizes="(max-width: 640px) 92vw, (max-width: 1024px) 45vw, 31vw"
                    unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
                    className="object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-black text-5xl font-medium text-white">
                    {artistInitials(artist)}
                  </div>
                )}
              </div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-0.5">
                    {formatArtistRoleSummary(artist.category, 'Komiker')}
                  </p>
                  <h2 className="text-lg font-medium leading-tight">{artistDisplayName(artist)}</h2>
                  {artist.stage_name && <p className="text-sm text-zinc-500">{artist.full_name}</p>}
                </div>
                <ArrowUpRight className="size-4 shrink-0 mt-1 text-zinc-400 transition group-hover:text-vipps-orange" />
              </div>
              {artist.bio && <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{artist.bio}</p>}
            </Link>
          ))}
        </div>
        {artists.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-zinc-500">
            Ingen godkjente artister ennå.
          </div>
        )}
      </section>
      <Footer/>
    </main>
  )
}


