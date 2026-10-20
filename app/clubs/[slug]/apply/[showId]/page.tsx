import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ArrowLeft, CalendarDays, Clock, MapPin } from 'lucide-react'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import { clubBrandStyle } from '@/lib/club-brand'
import { getPublicClubBySlug } from '@/lib/public-clubs'
import { formatShowDate, formatShowTime } from '@/lib/public-show-format'
import {
  getClubOpenCalls,
  getOpenCallStateForArtist,
  submissionStatusLabel,
  type OpenCallSpot,
  type OpenCallSpotState,
} from '@/lib/open-spots'
import { getOpenCallViewer } from '@/lib/open-call-viewer'
import { applyForSpotAction } from '@/app/artist-app/open-spots/actions'

/**
 * Ett show fra «Apply for a spot» på klubbsiden: det en komiker trenger for
 * å bestemme seg, og knappen.
 *
 * Showet er ofte ikke lagt ut for salg ennå, så siden er ikke `/events/…` og
 * skal ikke indekseres. Den viser bare det `getClubOpenCalls` slipper gjennom
 * for seeren — et roster-show eller et utkast gir 404, ikke en side som sier
 * «ikke for deg».
 */

type Props = {
  params: Promise<{ slug: string; showId: string }>
}

export const dynamic = 'force-dynamic'

async function load(slug: string, showId: string) {
  const club = await getPublicClubBySlug(slug)
  if (!club) return null

  const { kind, viewer } = await getOpenCallViewer()
  const [call] = await getClubOpenCalls(club.id, viewer, { showId })
  if (!call) return null

  return { club, call, kind, viewer }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, showId } = await params
  const loaded = await load(slug, showId)
  if (!loaded) return { title: 'Show not found — Tickethalo' }

  return {
    title: `Apply: ${loaded.call.title} — ${loaded.club.name}`,
    description: `Open spots on ${loaded.call.title} at ${loaded.club.name}. For comedians.`,
    robots: { index: false },
  }
}

export default async function ApplyForShowPage({ params }: Props) {
  const { slug, showId } = await params
  const loaded = await load(slug, showId)
  if (!loaded) notFound()

  const { club, call, kind, viewer } = loaded
  const states = viewer ? await getOpenCallStateForArtist(call, viewer) : null

  // Samme sperre gjelder hver plass (profilen, opptatt dag, allerede booket),
  // så den står én gang over listen i stedet for på hver rad.
  const blocker = states
    ? [...states.values()].find((state): state is Extract<OpenCallSpotState, { kind: 'blocked' }> => state.kind === 'blocked')?.reason ?? null
    : null

  // Innloggingen godtar bare stier under /artist-app, så komikeren lander
  // på «Open spots» med dette showet øverst — der knappen er den samme.
  const returnTo = `/artist-app/open-spots?show=${call.showId}`
  const loginHref = `/artist-app/login?next=${encodeURIComponent(returnTo)}`
  const signupHref = `/artist-app/signup?next=${encodeURIComponent(returnTo)}`

  const time = call.startTime ? formatShowTime({ start_time: call.startTime, end_time: call.endTime }) : null

  return (
    <main
      lang="en"
      className="ev-surface min-h-screen bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
      style={clubBrandStyle(club.brand_color)}
    >
      <PublicHeader tone="light" />

      <section
        className="px-4 pb-8 pt-24 md:px-8 md:pb-10 md:pt-28"
        style={{ background: 'linear-gradient(180deg, var(--club-wash), transparent 85%)' }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <Link
            href={`/clubs/${club.slug}#apply`}
            className="-ml-2 inline-flex h-11 w-fit items-center gap-2 rounded-full px-2 text-[15px] font-medium text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]"
          >
            <ArrowLeft className="size-4" aria-hidden /> {club.name}
          </Link>

          <p className="text-[13px] font-bold uppercase tracking-[0.22em] text-[var(--ev-accent)]">
            Open call for comedians
          </p>
          <h1 className="text-balance text-[2.25rem] font-semibold leading-[1.03] tracking-[-0.035em] sm:text-5xl">
            {call.title}
          </h1>

          <ul className="flex flex-col gap-2 text-[17px] text-[var(--ev-muted)] sm:text-[15px]">
            <li className="flex items-center gap-2.5">
              <CalendarDays className="size-4 shrink-0 text-[var(--ev-accent)]" aria-hidden />
              {formatShowDate(call.date)}
            </li>
            {time && (
              <li className="flex items-center gap-2.5">
                <Clock className="size-4 shrink-0 text-[var(--ev-accent)]" aria-hidden />
                {time}
              </li>
            )}
            {call.venue && (
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-[0.2em] size-4 shrink-0 text-[var(--ev-accent)]" aria-hidden />
                <span>
                  {call.venue}
                  {call.address && <span className="block text-[var(--ev-faint)]">{call.address}</span>}
                </span>
              </li>
            )}
          </ul>

          {call.closeAt && (
            <p className="text-[15px] text-[var(--ev-faint)]">
              Applications close {formatShowDate(call.closeAt)}.
            </p>
          )}
        </div>
      </section>

      <div className="mx-auto flex max-w-3xl flex-col gap-10 px-4 pb-24 md:px-8">
        <section aria-labelledby="spots-heading">
          <div className="mb-4 flex items-baseline justify-between gap-4 border-b border-[var(--ev-line-strong)] pb-3">
            <h2 id="spots-heading" className="text-2xl font-medium tracking-[-0.01em]">
              {call.spots.length === 1 ? 'The spot' : 'The spots'}
            </h2>
            {call.waitlistOnly && (
              <span className="text-[15px] text-[var(--ev-faint)] sm:text-[13px]">Line-up is full</span>
            )}
          </div>

          {kind === 'artist' && blocker && (
            <p
              className="mb-4 border border-dashed border-[var(--ev-line-strong)] p-4 text-[15px] text-[var(--ev-muted)]"
              style={{ borderRadius: 'var(--ev-r-card)' }}
            >
              {blocker}
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {call.spots.map((spot) => (
              <SpotCard key={spot.requirementId} spot={spot} state={states?.get(spot.requirementId) ?? null} />
            ))}
          </ul>

          {call.waitlistOnly && (
            <p className="mt-4 text-[15px] leading-relaxed text-[var(--ev-muted)]">
              Every spot is booked. Join the waitlist and the club sees your application first if someone drops out.
            </p>
          )}
        </section>

        {kind !== 'artist' && (
          <section
            className="flex flex-col gap-4 p-6 ring-1 ring-[var(--ev-line)] sm:p-8"
            style={{ borderRadius: 'var(--ev-r-card)', background: 'var(--club-wash)' }}
            aria-labelledby="signin-heading"
          >
            <h2 id="signin-heading" className="text-xl font-semibold tracking-[-0.01em]">
              Apply with your comedian profile
            </h2>
            <p className="text-[15px] leading-relaxed text-[var(--ev-muted)]">
              {kind === 'other'
                ? 'You are logged in without a comedian profile. Log in as a comedian, or create a profile, to apply.'
                : `${club.name} books comedians through Tickethalo. Log in, or create a free profile, and apply in one click.`}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href={loginHref}
                className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--ev-accent-fill)] px-6 text-[17px] font-semibold text-[var(--ev-accent-ink)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]"
              >
                Log in to apply
              </Link>
              <Link
                href={signupHref}
                className="inline-flex h-12 items-center justify-center rounded-full px-6 text-[17px] font-semibold ring-1 ring-[var(--ev-line-strong)] transition-colors hover:bg-[var(--ev-card-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]"
              >
                Create a comedian profile
              </Link>
            </div>
          </section>
        )}

        {call.description && (
          <section aria-labelledby="about-heading">
            <h2 id="about-heading" className="mb-3 border-b border-[var(--ev-line-strong)] pb-3 text-2xl font-medium tracking-[-0.01em]">
              About the show
            </h2>
            <p className="whitespace-pre-wrap text-[17px] leading-relaxed text-[var(--ev-muted)] sm:text-[15px]">
              {call.description}
            </p>
          </section>
        )}

        <p className="text-[13px] leading-relaxed text-[var(--ev-faint)]">
          Only the club sees who applied. Nothing is booked until the club sends you an offer.
        </p>
      </div>

      <Footer />
    </main>
  )
}

function availability(spot: OpenCallSpot) {
  if (spot.waitlist) return 'Full — waitlist open'
  if (spot.quantity === 1) return '1 spot open'
  return spot.spotsLeft < spot.quantity
    ? `${spot.spotsLeft} of ${spot.quantity} spots open`
    : `${spot.quantity} spots open`
}

function SpotCard({ spot, state }: { spot: OpenCallSpot; state: OpenCallSpotState | null }) {
  return (
    <li
      className="flex flex-col gap-3 bg-[var(--ev-card)] p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5"
      style={{ borderRadius: 'var(--ev-r-card)' }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-semibold">{spot.roleName}</p>
        <p className="text-[15px] text-[var(--ev-faint)] sm:text-[14px]">
          {[spot.feeLabel, availability(spot)].filter(Boolean).join(' · ')}
        </p>
      </div>

      {state?.kind === 'apply' && (
        <form action={applyForSpotAction} className="shrink-0">
          <input type="hidden" name="requirement_id" value={spot.requirementId} />
          <button
            type="submit"
            className={
              spot.waitlist
                ? 'inline-flex h-11 w-full items-center justify-center rounded-full px-5 text-[16px] font-semibold ring-1 ring-[var(--ev-line-strong)] transition-colors hover:bg-[var(--ev-card-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:w-auto'
                : 'inline-flex h-11 w-full items-center justify-center rounded-full bg-[var(--ev-accent-fill)] px-5 text-[16px] font-semibold text-[var(--ev-accent-ink)] transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:w-auto'
            }
          >
            {spot.waitlist ? 'Join the waitlist' : 'Apply'}
          </button>
        </form>
      )}

      {state?.kind === 'applied' && (
        <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end sm:gap-1">
          <span className="text-[15px] font-medium">{submissionStatusLabel(state.status, spot.waitlist)}</span>
          <Link
            href={`/artist-app/open-spots/${state.submissionId}`}
            className="text-[15px] text-[var(--ev-muted)] underline underline-offset-[3px] hover:text-[var(--ev-text)] sm:text-[13px]"
          >
            Your application
          </Link>
        </div>
      )}
    </li>
  )
}
