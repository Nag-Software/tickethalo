import Link from 'next/link'
import { ArrowRight, ChevronRight } from 'lucide-react'
import type { OpenCall } from '@/lib/open-spots'

/**
 * «Comedian?» nederst på klubbsiden: showene klubben har åpnet plasser på.
 *
 * Kortet er for komikere, ikke for publikum, så det står til slutt og sier
 * det i overskriften. Showene her er ikke nødvendigvis lagt ut for salg ennå
 * — derfor lenker de til en egen søkevisning, ikke til `/events/[slug]`.
 */

export type OpenCallsViewer = 'guest' | 'artist' | 'other'

/** «OCT» og «17» hver for seg, til datoblokken. */
function dateParts(date: string) {
  const day = new Date(`${date}T12:00:00`)
  return {
    month: new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(day).toUpperCase(),
    day: new Intl.DateTimeFormat('en-GB', { day: 'numeric' }).format(day),
    label: new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(day),
  }
}

export function openCallHref(clubSlug: string, showId: string) {
  return `/clubs/${clubSlug}/apply/${showId}`
}

export function ClubOpenCalls({
  club,
  calls,
  viewer,
}: {
  club: { name: string; slug: string; city: string | null }
  calls: OpenCall[]
  viewer: OpenCallsViewer
}) {
  // En innlogget komiker har allerede en profil — knappen tar hen dit
  // søknadene bor. Alle andre trenger en profil først.
  const profileHref = viewer === 'artist'
    ? '/artist-app/open-spots'
    : `/artist-app/signup?next=${encodeURIComponent('/artist-app/open-spots')}`

  return (
    <section id="apply" aria-labelledby="apply-heading" className="scroll-mt-24">
      <div
        className="grid gap-8 p-6 ring-1 ring-[var(--ev-line)] sm:p-8 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:gap-10 md:p-10"
        style={{ borderRadius: 'var(--ev-r-card)', background: 'var(--club-wash)' }}
      >
        <div className="flex flex-col items-start gap-4">
          <h2 id="apply-heading" className="text-[2.25rem] font-semibold leading-none tracking-[-0.035em] sm:text-5xl">
            Comedian?
          </h2>
          <p className="max-w-md text-[17px] leading-relaxed text-[var(--ev-muted)]">
            Want to perform at {club.name}{club.city ? ` in ${club.city}` : ''}? Apply for one of the shows here.
            When a line-up is full, you can still join the waitlist in case someone drops out.
          </p>
          <Link
            href={profileHref}
            className="mt-1 inline-flex h-12 items-center gap-2 rounded-full bg-[var(--ev-accent-fill)] px-6 text-[17px] font-semibold text-[var(--ev-accent-ink)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]"
          >
            {viewer === 'artist' ? 'Your open spots' : 'Send your profile'}
            <ArrowRight className="size-[18px]" aria-hidden />
          </Link>
        </div>

        <div className="flex min-w-0 flex-col md:border-l md:border-[var(--ev-line)] md:pl-10">
          <h3 className="mb-2 text-lg font-semibold tracking-[-0.01em]">Shows you can apply to now</h3>

          {calls.length === 0 ? (
            <p className="py-3 text-[15px] leading-relaxed text-[var(--ev-muted)]">
              No open spots right now. When {club.name} opens a spot on a show, it shows up here.
            </p>
          ) : (
            <ul className="flex flex-col">
              {calls.map((call) => {
                const { month, day, label } = dateParts(call.date)
                return (
                  <li key={call.showId} className="border-b border-[var(--ev-line)] last:border-0">
                    <Link
                      href={openCallHref(club.slug, call.showId)}
                      className="group flex items-center gap-4 py-3 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]"
                    >
                      <span className="flex w-11 shrink-0 flex-col items-center leading-none" aria-label={label}>
                        <span className="text-[12px] font-medium tracking-[0.08em] text-[var(--ev-faint)]">{month}</span>
                        <span className="mt-1 text-[22px] font-semibold tabular-nums">{day}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[17px] font-medium group-hover:text-[var(--ev-accent)] sm:text-[16px]">
                          {call.title}
                        </span>
                        {call.venue && (
                          <span className="block truncate text-[15px] text-[var(--ev-faint)] sm:text-[14px]">{call.venue}</span>
                        )}
                      </span>
                      {call.waitlistOnly && (
                        <span className="shrink-0 rounded-full px-2.5 py-1 text-[13px] font-medium text-[var(--ev-muted)] ring-1 ring-[var(--ev-line-strong)]">
                          Waitlist
                        </span>
                      )}
                      <ChevronRight
                        className="size-4 shrink-0 text-[var(--ev-faint)] transition-colors group-hover:text-[var(--ev-accent)]"
                        aria-hidden
                      />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
