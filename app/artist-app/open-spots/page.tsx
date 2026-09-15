import Link from 'next/link'
import { getCurrentArtist } from '@/lib/artist-portal'
import { artistCanApply, getOpenSpotsForArtist, type OpenSpot, type OpenSpotShow } from '@/lib/open-spots'
import { Chip, Empty, PageHeader, Panel, Row, portalButton } from '@/components/artist/portal-ui'
import { applyForSpotAction } from './actions'

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

const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting for the club',
  shortlisted: 'Shortlisted',
  accepted: 'Offer sent — check your bookings',
  declined: 'Not this time',
  withdrawn: 'You withdrew',
  filled_by_other: 'Filled by someone else',
}

export default async function OpenSpotsPage() {
  const { artist } = await getCurrentArtist()
  const gate = artistCanApply(artist)
  const shows = gate.ok ? await getOpenSpotsForArtist(artist.id) : []

  const spotCount = shows.reduce((sum, show) => sum + show.spots.length, 0)
  const invitedCount = shows.filter((show) => show.invited).length

  return (
    <>
      <PageHeader
        title="Open spots"
        description="Spots clubs have opened for applications. One click puts your profile in front of the booker — nothing is booked until they send you an offer."
        actions={
          shows.length > 0 ? (
            <>
              <Chip tone="ink">{spotCount} {spotCount === 1 ? 'spot' : 'spots'}</Chip>
              {invitedCount > 0 && <Chip tone="accent">{invitedCount} invited</Chip>}
            </>
          ) : undefined
        }
      />

      {!gate.ok ? (
        <Empty>{gate.reason}</Empty>
      ) : shows.length === 0 ? (
        <Empty>
          No open spots right now. Clubs you work with will show up here first —
          and you will get an email when one invites you.
        </Empty>
      ) : (
        shows.map((show) => <ShowPanel key={show.showId} show={show} />)
      )}

      <p className="text-[13px] leading-relaxed text-[var(--ev-faint)]">
        Only the club sees who applied. Nothing here appears on the club&rsquo;s public page or on your profile.
      </p>
    </>
  )
}

function ShowPanel({ show }: { show: OpenSpotShow }) {
  const when = [formatDate(show.date), show.startTime?.slice(0, 5)].filter(Boolean).join(', ')
  const where = [show.clubName, show.venue].filter(Boolean).join(' · ')

  return (
    <Panel
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
      <div className="flex flex-col gap-2">
        {show.spots.map((spot) => (
          <SpotRow key={spot.requirementId} spot={spot} />
        ))}
      </div>
    </Panel>
  )
}

function SpotRow({ spot }: { spot: OpenSpot }) {
  const applied = spot.submission
  const settled = applied != null && !['pending', 'shortlisted'].includes(applied.status)

  const detail = applied
    ? STATUS_LABEL[applied.status] ?? applied.status
    : [
      spot.spotsLeft < spot.quantity
        ? `${spot.spotsLeft} of ${spot.quantity} spots left`
        : `${spot.quantity} ${spot.quantity === 1 ? 'spot' : 'spots'}`,
      spot.applicantCount > 0
        ? `${spot.applicantCount} ${spot.applicantCount === 1 ? 'has' : 'have'} applied`
        : null,
    ].filter(Boolean).join(' · ')

  return (
    <Row muted={settled}>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold">{spot.roleName}</div>
        <div className="mt-0.5 text-[13px] text-[var(--ev-muted)]">{detail}</div>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <div className="text-right">
          <div className="text-[12px] text-[var(--ev-faint)]">Fee</div>
          <div className="text-[15px] font-semibold tabular-nums">{spot.feeLabel}</div>
        </div>

        {applied ? (
          <Link href={`/artist-app/open-spots/${applied.id}`} className={portalButton.secondary}>
            {settled ? 'See application' : 'Your application'}
          </Link>
        ) : (
          <form action={applyForSpotAction}>
            <input type="hidden" name="requirement_id" value={spot.requirementId} />
            <button type="submit" className={portalButton.primary}>
              Apply for spot
            </button>
          </form>
        )}
      </div>
    </Row>
  )
}
