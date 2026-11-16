import Link from 'next/link'
import { getCurrentArtist } from '@/lib/artist-portal'
import {
  artistCanApply,
  getOpenSpotsForArtist,
  OPEN_SUBMISSION_STATUSES,
  submissionStatusLabel,
  type OpenSpotShow,
} from '@/lib/open-spots'
import { Chip, Empty, PageHeader, Panel, Row, portalButton } from '@/components/artist/portal-ui'
import { applyForShowAction } from './actions'
import { gigTypeLabels } from '@/lib/gig-types'

export const metadata = { title: 'Open spots — Tickethalo' }
export const dynamic = 'force-dynamic'

/** «Thu 2 Oct», som resten av portalen skriver datoer. */
function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T12:00:00`))
}

function formatDeadline(closeAt: string) {
  const days = Math.ceil((new Date(closeAt).getTime() - Date.now()) / 86_400_000)
  if (days <= 0) return 'Closes today'
  if (days === 1) return 'Closes tomorrow'
  if (days <= 14) return `Closes in ${days} days`
  return `Closes ${formatDate(closeAt.slice(0, 10))}`
}

export default async function OpenSpotsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>
}) {
  const { show: focusId } = await searchParams
  const { artist } = await getCurrentArtist()
  const gate = artistCanApply(artist)
  const found = gate.ok ? await getOpenSpotsForArtist(artist.id) : []

  // `?show=` kommer fra «Apply for a spot» på klubbsiden, via innloggingen.
  // Showet komikeren ville søke på løftes øverst, så hen ikke må lete.
  const focused = focusId ? found.find((show) => show.showId === focusId) : undefined
  const shows = focused ? [focused, ...found.filter((show) => show !== focused)] : found

  const invitedCount = shows.filter((show) => show.invited).length

  return (
    <>
      <PageHeader
        title="Open spots"
        description="Shows clubs have opened for applications. Apply once per show — the club picks which spot fits you. Nothing is booked until they send you an offer. When a line-up is full, you can join the waitlist."
        actions={
          shows.length > 0 ? (
            <>
              <Chip tone="ink">{shows.length} {shows.length === 1 ? 'show' : 'shows'}</Chip>
              {invitedCount > 0 && <Chip tone="accent">{invitedCount} invited</Chip>}
            </>
          ) : undefined
        }
      />

      {focusId && gate.ok && !focused && (
        <Empty>That show is not open for your applications right now. Here is everything that is.</Empty>
      )}

      {!gate.ok ? (
        <Empty>{gate.reason}</Empty>
      ) : shows.length === 0 ? (
        <Empty>
          No open spots right now. Clubs you work with will show up here first —
          and you will get an email when one invites you.
        </Empty>
      ) : (
        shows.map((show) => <ShowPanel key={show.showId} show={show} focused={show === focused} />)
      )}

      <p className="text-[13px] leading-relaxed text-[var(--ev-faint)]">
        Only the club sees who applied. Nothing here appears on the club&rsquo;s public page or on your profile.
      </p>
    </>
  )
}

function ShowPanel({ show, focused }: { show: OpenSpotShow; focused: boolean }) {
  const when = [formatDate(show.date), show.startTime?.slice(0, 5)].filter(Boolean).join(', ')
  const where = [show.clubName, show.venue].filter(Boolean).join(' · ')
  const applied = show.submission
  const settled = applied != null && !OPEN_SUBMISSION_STATUSES.includes(applied.status)

  // Rolle og honorar vises ikke her — komikerne ble forvirret av «Stand-up /
  // Open Mic / Headliner» og ulike prosenter på samme kveld. De står i
  // bookingtilbudet (ClickUp «Apply for spot, begrense info», 2026-11-16).
  const availability = show.waitlist
    ? 'Line-up full'
    : `${show.spotsLeft} ${show.spotsLeft === 1 ? 'spot' : 'spots'} available`
  const gigTypes = gigTypeLabels(show.gigTypes)

  const detail = applied
    ? submissionStatusLabel(applied.status, show.waitlist)
    : [
      show.waitlist ? 'Join the waitlist in case someone drops out' : null,
      show.applicantCount > 0
        ? `${show.applicantCount} ${show.applicantCount === 1 ? 'has' : 'have'} applied`
        : null,
    ].filter(Boolean).join(' · ')

  return (
    <Panel
      className={focused ? 'ring-2 ring-[var(--ev-accent-fill)]' : undefined}
      title={show.title}
      description={[where, when].filter(Boolean).join(' · ')}
      actions={
        <>
          {show.invited && <Chip tone="accent">Invited</Chip>}
          {!show.invited && show.audience === 'everyone' && <Chip>Open to everyone</Chip>}
          {show.closeAt && <Chip>{formatDeadline(show.closeAt)}</Chip>}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold">{availability}</span>
          {gigTypes.map((label) => <Chip key={label}>{label}</Chip>)}
        </div>

        <Row muted={settled}>
          <div className="min-w-0 text-[13px] text-[var(--ev-muted)]">{detail || 'Apply once — the club picks the spot.'}</div>

          {applied ? (
            <Link href={`/artist-app/open-spots/${applied.id}`} className={portalButton.secondary}>
              {settled ? 'See application' : 'Your application'}
            </Link>
          ) : (
            <form action={applyForShowAction}>
              <input type="hidden" name="show_id" value={show.showId} />
              <button type="submit" className={show.waitlist ? portalButton.secondary : portalButton.primary}>
                {show.waitlist ? 'Join the waitlist' : 'Apply for this show'}
              </button>
            </form>
          )}
        </Row>
      </div>
    </Panel>
  )
}
