import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { formatArtistRoleSummary } from '@/lib/artist-roles'
import { artistDisplayName, artistInitials, getPublicArtists } from '@/lib/public-artists'
import { shouldBypassImageOptimization } from '@/lib/utils'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'

export const metadata = {
  title: 'Komikere — humor.events',
  description: 'Se godkjente komikere og artister i humor.events-lineupen.',
}

export const dynamic = 'force-dynamic'

export default async function ArtistsPage() {
  const artists = await getPublicArtists()

  return (
    <main
      className="ev-surface min-h-screen bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <div className="mx-auto max-w-6xl px-4 pb-24 pt-24 md:px-8 md:pt-28">
        <Link
          href="/"
          className="mb-7 inline-flex items-center gap-2 text-[13px] text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)]"
        >
          <ArrowLeft className="size-4" /> Forsiden
        </Link>

        <header className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-balance text-[2rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
              Våre komikere
            </h1>
            <p className="mt-2 text-[15px] text-[var(--ev-muted)]">
              {artists.length} {artists.length === 1 ? 'komiker' : 'komikere'} i lineupen.
            </p>
          </div>
          <Link
            href="/events"
            className="inline-flex items-center gap-1.5 text-[13px] text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)]"
          >
            Se show <ArrowRight className="size-4" />
          </Link>
        </header>

        {artists.length === 0 ? (
          <div
            className="border border-dashed border-[var(--ev-line-strong)] px-6 py-16 text-center text-[15px] text-[var(--ev-muted)]"
            style={{ borderRadius: 'var(--ev-r-card)' }}
          >
            Ingen godkjente komikere ennå.
          </div>
        ) : (
          // To i bredden på mobil: portretter leses fint i par, i motsetning
          // til plakatene i eventlisten som trenger full radbredde.
          <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
            {artists.map((artist, index) => (
              <Link key={artist.id} href={`/artists/${artist.id}`} className="group block">
                <div
                  className="relative mb-3 aspect-square overflow-hidden bg-[var(--ev-card-hover)]"
                  style={{ borderRadius: 'var(--ev-r-art)' }}
                >
                  {artist.profile_image_url ? (
                    <Image
                      src={artist.profile_image_url}
                      alt=""
                      fill
                      priority={index < 4}
                      sizes="(max-width: 640px) 46vw, (max-width: 1024px) 30vw, 23vw"
                      unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
                      className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-3xl font-medium text-[var(--ev-faint)]">
                      {artistInitials(artist)}
                    </div>
                  )}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-black/5 transition-colors duration-300 group-hover:ring-[var(--ev-accent-fill)]/60"
                    style={{ borderRadius: 'var(--ev-r-art)' }}
                  />
                </div>

                <p className="text-[12.5px] text-[var(--ev-faint)]">
                  {formatArtistRoleSummary(artist.category, 'Komiker')}
                </p>
                <h2 className="mt-0.5 truncate text-[15px] font-semibold leading-snug tracking-[-0.01em]">
                  {artistDisplayName(artist)}
                </h2>
                {artist.stage_name && (
                  <p className="truncate text-[13px] text-[var(--ev-muted)]">{artist.full_name}</p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>

      <Footer />
    </main>
  )
}
