import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { formatArtistRoleSummary } from '@/lib/artist-roles'
import { artistDisplayName, artistInitials, getPublicArtistById, getPublicArtistShows } from '@/lib/public-artists'
import { shouldBypassImageOptimization } from '@/lib/utils'
import { PublicHeader } from '@/components/public/public-header'
import { formatShowTime } from '@/lib/public-events'
import { formatDayLabel, getOsloToday } from '@/lib/event-filters'
import { Footer } from '@/components/Footer'

type Props = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const artist = await getPublicArtistById(id)
  if (!artist) return { title: 'Artist ikke funnet — Tickethalo' }
  const name = artistDisplayName(artist)

  return {
    title: `${name} — Tickethalo`,
    description: artist.bio ?? `${name} i Tickethalo-lineupen.`,
    openGraph: {
      title: name,
      description: artist.bio ?? `${name} i Tickethalo-lineupen.`,
      images: artist.profile_image_url ? [{ url: artist.profile_image_url, alt: name }] : undefined,
    },
  }
}

export default async function ArtistDetailPage({ params }: Props) {
  const { id } = await params
  const artist = await getPublicArtistById(id)
  if (!artist) notFound()

  const shows = await getPublicArtistShows(artist.id)
  const today = getOsloToday()
  const name = artistDisplayName(artist)
  const socials = Object.entries(artist.social_links ?? {}).filter(
    (entry): entry is [string, string] => Boolean(entry[1])
  )

  return (
    <main
      className="ev-surface min-h-screen bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <div className="mx-auto max-w-5xl px-4 pb-24 pt-24 md:px-8 md:pt-28">
        <Link
          href="/artists"
          className="mb-7 inline-flex items-center gap-2 text-[13px] text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)]"
        >
          <ArrowLeft className="size-4" /> Alle komikere
        </Link>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:gap-14">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div
              className="relative aspect-square overflow-hidden bg-[var(--ev-card-hover)] sm:aspect-[4/5] lg:aspect-square"
              style={{ borderRadius: 'var(--ev-r-card)' }}
            >
              {artist.profile_image_url ? (
                <Image
                  src={artist.profile_image_url}
                  alt=""
                  fill
                  priority
                  sizes="(max-width: 1024px) 100vw, 300px"
                  unoptimized={shouldBypassImageOptimization(artist.profile_image_url)}
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-5xl font-medium text-[var(--ev-faint)]">
                  {artistInitials(artist)}
                </div>
              )}
            </div>

            {socials.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {socials.map(([label, href]) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 bg-[var(--ev-card)] px-3.5 py-1.5 text-[13px] capitalize text-[var(--ev-muted)] transition-colors hover:bg-[var(--ev-card-hover)] hover:text-[var(--ev-text)]"
                    style={{ borderRadius: 'var(--ev-r-chip)' }}
                  >
                    {label} <ArrowUpRight className="size-3.5" />
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-8">
            <header className="flex flex-col gap-2">
              <p className="text-[13px] text-[var(--ev-faint)]">
                {formatArtistRoleSummary(artist.category, 'Komiker')}
                {artist.language && <> · {artist.language}</>}
              </p>
              <h1 className="text-balance text-[2rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
                {name}
              </h1>
              {artist.stage_name && (
                <p className="text-[15px] text-[var(--ev-muted)]">{artist.full_name}</p>
              )}
            </header>

            {artist.bio && (
              <Section title="Om komikeren">
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--ev-muted)]">
                  {artist.bio}
                </p>
              </Section>
            )}

            <Section
              title="Kommende show"
              aside={shows.length > 0 ? `${shows.length}` : undefined}
            >
              {shows.length === 0 ? (
                <p className="text-[15px] text-[var(--ev-faint)]">Ingen publiserte kommende show.</p>
              ) : (
                // Samme radoppsett som eventlisten, uten pris og kjøpsknapp:
                // getPublicArtistShows henter en slankere type uten billettdata.
                <ul className="flex flex-col gap-4">
                  {shows.map((show) => (
                    <li key={show.id}>
                      <Link href={`/events/${show.slug}`} className="group flex items-center gap-3.5">
                        <span
                          className="relative w-[72px] shrink-0 overflow-hidden"
                          style={{ borderRadius: 'var(--ev-r-art)' }}
                        >
                          <span className="relative block aspect-[2/3] bg-[var(--ev-poster-ground)]">
                            {show.poster_url ? (
                              <Image
                                src={show.poster_url}
                                alt=""
                                fill
                                sizes="72px"
                                className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.02]"
                              />
                            ) : (
                              <span className="flex h-full items-end p-2 text-[11px] font-medium leading-tight text-white/80">
                                {show.title}
                              </span>
                            )}
                          </span>
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] text-[var(--ev-muted)]">
                            <span className="font-medium text-[var(--ev-text)]">
                              {formatDayLabel(show.date, today)}
                            </span>
                            {' · '}
                            {formatShowTime(show)}
                          </span>
                          <span className="mt-0.5 block truncate text-[15px] font-semibold tracking-[-0.01em]">
                            {show.title}
                          </span>
                          <span className="mt-0.5 block truncate text-[12.5px] text-[var(--ev-faint)]">
                            {show.venue_name ?? show.venue_address ?? 'Sted kommer'}
                          </span>
                        </span>

                        <ArrowUpRight className="size-4 shrink-0 text-[var(--ev-faint)] transition-colors group-hover:text-[var(--ev-accent)]" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      </div>

      <Footer />
    </main>
  )
}

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4 border-b border-[var(--ev-line)] pb-2.5">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {aside && <span className="text-[13px] text-[var(--ev-faint)]">{aside}</span>}
      </div>
      {children}
    </section>
  )
}
