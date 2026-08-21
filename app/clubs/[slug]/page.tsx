import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft, ArrowUpRight, MapPin } from 'lucide-react'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import { EventCard } from '@/components/public/event-card'
import { clubBrandStyle } from '@/lib/club-brand'
import { formatClubLocation, getPublicClubBySlug, mapsUrl } from '@/lib/public-clubs'
import { formatShortDate, formatShowTime, getClubShows, type PublicShow } from '@/lib/public-events'
import { formatDayLabel, getOsloToday } from '@/lib/event-filters'
import { shouldBypassImageOptimization } from '@/lib/utils'

type Props = {
  params: Promise<{ slug: string }>
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const club = await getPublicClubBySlug(slug)
  if (!club) return { title: 'Club not found — Tickethalo' }

  const description = club.description
    ?? `Upcoming stand-up shows from ${club.name}${club.city ? ` in ${club.city}` : ''}.`
  const canonical = `/clubs/${club.slug}`

  return {
    title: `${club.name} — Tickethalo`,
    description,
    alternates: { canonical },
    openGraph: {
      title: club.name,
      description,
      type: 'website',
      url: canonical,
      images: club.logo_url ? [{ url: club.logo_url, alt: club.name }] : undefined,
    },
  }
}

/**
 * The same one-line status the front page uses, narrowed to a single club.
 * "Next show tomorrow at Rockefeller" beats any tagline we could write for them.
 */
function clubStatus(upcoming: PublicShow[], today: string): string | null {
  if (upcoming.length === 0) return null

  const tonight = upcoming.filter((show) => show.date.slice(0, 10) === today)
  if (tonight.length > 0) {
    const first = tonight[0].start_time ? ` — doors listed for ${formatShowTime(tonight[0]).slice(0, 5)}` : ''
    return `${tonight.length} ${tonight.length === 1 ? 'show' : 'shows'} tonight${first}`
  }

  const label = formatDayLabel(upcoming[0].date, today)
  const when = label === 'Today' || label === 'Tomorrow' ? label.toLowerCase() : `on ${label}`
  return `Next show ${when} · ${upcoming.length} upcoming in total`
}

export default async function ClubPage({ params }: Props) {
  const { slug } = await params
  const club = await getPublicClubBySlug(slug)
  if (!club) notFound()

  const { upcoming, past } = await getClubShows(club.id)
  const today = getOsloToday()
  const status = clubStatus(upcoming, today)

  return (
    <main
      // The document root is still lang="nb" for the Norwegian portals — see
      // app/page.tsx for why the public pages declare their own language.
      lang="en"
      className="ev-surface min-h-screen bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
      // The club's own colour, pushed into the tokens every public component
      // already reads. Nothing below this line knows it is not the default.
      style={clubBrandStyle(club.brand_color)}
    >
      <PublicHeader tone="light" />

      {/* Hero. One tinted band instead of a header image — the logo carries the
          brand, and a wash in the club's colour carries the rest. */}
      <section
        className="px-4 pb-10 pt-24 md:px-8 md:pb-14 md:pt-28"
        style={{ background: 'linear-gradient(180deg, var(--club-wash), transparent 85%)' }}
      >
        <div className="mx-auto max-w-5xl">
          <Link
            href="/events"
            className="-ml-2 mb-7 inline-flex h-11 w-fit items-center gap-2 rounded-full px-2 text-[15px] font-medium text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:ml-0 sm:h-auto sm:px-0 sm:text-[13px] sm:font-normal"
          >
            <ArrowLeft className="size-4" aria-hidden /> All shows
          </Link>

          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-7">
            <ClubMark name={club.name} logoUrl={club.logo_url} />

            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <p className="text-[13px] font-bold uppercase tracking-[0.22em] text-[var(--ev-accent)]">
                  Comedy club{club.city ? ` · ${club.city}` : ''}
                </p>
                <h1 className="text-balance text-[2.25rem] font-semibold leading-[1.03] tracking-[-0.035em] sm:text-6xl">
                  {club.name}
                </h1>
              </div>

              {status && (
                <p className="flex items-start gap-2 text-[17px] text-[var(--ev-muted)] sm:text-[14px]">
                  {/* The contrast-safe accent, not the fill: a yellow dot on
                      near-white disappears, and the dot is the status. */}
                  <span
                    aria-hidden
                    className="mt-[0.5em] inline-block size-2 shrink-0 rounded-full bg-[var(--ev-accent)] sm:size-1.5"
                  />
                  {status}
                </p>
              )}

              {club.description && (
                <p className="max-w-2xl whitespace-pre-wrap text-[17px] leading-relaxed text-[var(--ev-muted)] sm:text-[15px]">
                  {club.description}
                </p>
              )}
              
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-5xl flex-col gap-14 px-4 pb-24 pt-0 md:px-8">
        <section id="club-shows" className="scroll-mt-24">
          <SectionHead
            title="Upcoming shows"
            aside={upcoming.length > 0 ? `${upcoming.length} ${upcoming.length === 1 ? 'show' : 'shows'}` : undefined}
          />

          {upcoming.length === 0 ? (
            <EmptyNote>
              No published shows right now. New dates from {club.name} land here first.
            </EmptyNote>
          ) : (
            <div className="grid grid-cols-1 gap-5 [&>*+*]:border-t [&>*+*]:border-[var(--ev-line)] [&>*+*]:pt-5 sm:grid-cols-2 sm:[&>*+*]:border-0 sm:[&>*+*]:pt-0 lg:grid-cols-3">
              {upcoming.map((show, index) => (
                <EventCard key={show.id} show={show} today={today} priority={index < 3} />
              ))}
            </div>
          )}
        </section>

        {club.locations.length > 0 && (
          <section>
            <SectionHead
              title="Where we play"
              aside={club.locations.length > 1 ? `${club.locations.length} venues` : undefined}
            />

            {/* A single venue in a two-column grid just hangs halfway into
                nothing — one column is the right shape for one card. */}
            <ul className={club.locations.length > 1 ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3'}>
              {club.locations.map((location) => {
                const address = formatClubLocation(location, club.city)

                return (
                  <li key={location.id}>
                    <a
                      href={mapsUrl(location, club.city)}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-start gap-3 bg-[var(--ev-card)] p-4 transition-colors hover:bg-[var(--ev-card-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]"
                      style={{ borderRadius: 'var(--ev-r-card)' }}
                    >
                      <span
                        aria-hidden
                        className="mt-0.5 grid size-9 shrink-0 place-content-center rounded-full text-[var(--ev-accent)]"
                        style={{ background: 'var(--club-wash-strong)' }}
                      >
                        <MapPin className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[17px] font-medium sm:text-[15px]">{location.name}</span>
                        {address && (
                          <span className="block text-[15px] text-[var(--ev-faint)] sm:text-[13px]">{address}</span>
                        )}
                      </span>
                      <ArrowUpRight
                        className="size-4 shrink-0 text-[var(--ev-faint)] transition-colors group-hover:text-[var(--ev-accent)]"
                        aria-hidden
                      />
                      <span className="sr-only">Open {location.name} in Google Maps</span>
                    </a>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {past.length > 0 && (
          <section>
            <SectionHead title="Previously" aside="Recent nights" />

            <ul className="flex flex-col">
              {past.map((show) => {
                const venue = show.venue_name ?? show.venue_address
                const row = (
                  <>
                    <span className="w-[68px] shrink-0 tabular-nums text-[var(--ev-faint)]">
                      {formatShortDate(show.date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{show.title}</span>
                    {venue && (
                      <span className="hidden shrink-0 truncate text-[var(--ev-faint)] sm:block">{venue}</span>
                    )}
                  </>
                )

                return (
                  <li key={show.id} className="border-b border-[var(--ev-line)] last:border-0">
                    {show.status === 'published' ? (
                      <Link
                        href={`/events/${show.slug}`}
                        className="flex items-center gap-3 py-3.5 text-[16px] transition-colors hover:text-[var(--ev-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:text-[14px]"
                      >
                        {row}
                      </Link>
                    ) : (
                      // A completed show has no public page left to link to.
                      <div className="flex items-center gap-3 py-3.5 text-[16px] text-[var(--ev-muted)] sm:text-[14px]">
                        {row}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>

      <Footer />
    </main>
  )
}

/** The logo, or the club's initials on a tile in its own colour. */
function ClubMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()

  return (
    <div
      className="relative size-20 shrink-0 overflow-hidden bg-[var(--ev-bg)] ring-1 ring-[var(--ev-line)] sm:size-24"
      style={{ borderRadius: 'var(--ev-r-card)' }}
    >
      {logoUrl ? (
        <Image
          src={logoUrl}
          alt=""
          fill
          priority
          sizes="96px"
          unoptimized={shouldBypassImageOptimization(logoUrl)}
          className="object-contain p-2"
        />
      ) : (
        <span
          className="grid h-full place-content-center text-2xl font-semibold text-[var(--ev-accent)]"
          style={{ background: 'var(--club-wash-strong)' }}
        >
          {initials}
        </span>
      )}
    </div>
  )
}

function SectionHead({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className="mb-5 flex items-baseline justify-between gap-4 border-b border-[var(--ev-line-strong)] pb-3">
      <h2 className="text-2xl font-medium tracking-[-0.01em]">{title}</h2>
      {aside && <span className="text-[15px] text-[var(--ev-faint)] sm:text-[13px]">{aside}</span>}
    </div>
  )
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-[var(--ev-line-strong)] p-10 text-center text-[17px] text-[var(--ev-muted)] sm:text-sm">
      {children}
    </div>
  )
}
