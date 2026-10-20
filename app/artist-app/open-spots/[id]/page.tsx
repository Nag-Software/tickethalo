import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCurrentArtist } from '@/lib/artist-portal'
import { requirementFeeLabel } from '@/lib/booking-spots'
import { Chip, DataRow, PageHeader, Panel, portalButton } from '@/components/artist/portal-ui'
import { updateSubmissionMessageAction, withdrawSubmissionAction } from '../actions'
import { showVenue } from '@/lib/show-venue'
import { OPEN_SUBMISSION_STATUSES, spotAvailability } from '@/lib/open-spots'

export const metadata = { title: 'Your application — Tickethalo' }
export const dynamic = 'force-dynamic'

const STATUS: Record<string, { label: string; lede: string; tone: 'accent' | 'neutral' | 'ink' }> = {
  pending: {
    label: 'Waiting for the club',
    lede: 'The club can see your profile on this spot. Nothing is booked yet — if they pick you, you get a normal booking offer to accept or decline.',
    tone: 'neutral',
  },
  shortlisted: {
    label: 'Shortlisted',
    lede: 'The club has marked you as a candidate for this spot. You will hear from them before the lineup is set.',
    tone: 'accent',
  },
  accepted: {
    label: 'Offer sent',
    lede: 'The club picked you. The booking offer is in your inbox and under Bookings — the spot is yours once you accept it.',
    tone: 'ink',
  },
  declined: {
    label: 'Not this time',
    lede: 'The club went with someone else for this spot.',
    tone: 'neutral',
  },
  withdrawn: {
    label: 'Withdrawn',
    lede: 'You withdrew this application.',
    tone: 'neutral',
  },
  // Ikke en status i basen: en ubesvart søknad på en full plass. Se
  // `spotAvailability` i lib/open-spots.ts.
  waitlist: {
    label: 'On the waitlist',
    lede: 'The line-up is full right now. If someone drops out, the club sees your application first — and if they pick you, you get a normal booking offer.',
    tone: 'neutral',
  },
  filled_by_other: {
    label: 'Filled by someone else',
    lede: 'This spot was filled while your application was in. Nothing you did — it just went first.',
    tone: 'neutral',
  },
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00`))
}

export default async function SubmissionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { artist, db } = await getCurrentArtist()

  // `eq('artist_id')` er tilgangskontrollen: en id fra en annen komikers
  // søknad gir ingen rad, og siden blir en 404 i stedet for en lekkasje.
  const { data: submission } = await db
    .from('show_submissions')
    .select('id, show_id, show_requirement_id, status, message, source, created_at')
    .eq('id', id)
    .eq('artist_id', artist.id)
    .maybeSingle()

  if (!submission) notFound()

  const [{ data: show }, { data: requirement }, { count: applicants }, { count: filled }] = await Promise.all([
    db.from('shows')
      .select('title, date, start_time, venue_name, venue_address, currency, club_id')
      .eq('id', submission.show_id)
      .single(),
    db.from('show_requirements')
      .select('role_name, quantity, compensation_type, compensation_amount, compensation_percent')
      .eq('id', submission.show_requirement_id)
      .single(),
    db.from('show_submissions')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', submission.show_requirement_id)
      .in('status', OPEN_SUBMISSION_STATUSES),
    db.from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', submission.show_requirement_id)
      .in('status', ['confirmed', 'completed', 'paid']),
  ])

  const { data: club } = show?.club_id
    ? await db.from('clubs').select('name').eq('id', show.club_id).maybeSingle()
    : { data: null }

  const open = OPEN_SUBMISSION_STATUSES.includes(submission.status)
  const waitlist = open && spotAvailability({ quantity: requirement?.quantity ?? 1, filled: filled ?? 0 }).waitlist
  const state = (waitlist ? STATUS.waitlist : STATUS[submission.status]) ?? STATUS.pending
  const currency = show?.currency || 'NOK'
  const feeLabel = requirement ? requirementFeeLabel(requirement, currency) : 'Not set'

  return (
    <>
      <PageHeader
        title={requirement ? `You applied for the ${requirement.role_name} spot` : 'Your application'}
        description={state.lede}
        actions={<Chip tone={state.tone}>{state.label}</Chip>}
      />

      <Panel
        title="The spot"
        actions={
          submission.source === 'invitation' ? <Chip tone="accent">You were invited</Chip> : undefined
        }
      >
        <div className="flex flex-col divide-y divide-[var(--ev-line)]">
          <DataRow label="Show" value={show?.title ?? '—'} />
          <DataRow label="Club" value={club?.name ?? '—'} />
          <DataRow label="Date" value={show?.date ? formatDate(show.date) : '—'} />
          <DataRow label="Time" value={show?.start_time ? show.start_time.slice(0, 5) : '—'} />
          <DataRow label="Venue" value={showVenue(show).venue ?? '—'} />
          {showVenue(show).address && <DataRow label="Address" value={showVenue(show).address ?? ''} />}
          <DataRow label="The fee if you get it" value={feeLabel} />
          <DataRow
            label="Others applying"
            value={
              (applicants ?? 0) > 1
                ? `${(applicants ?? 0) - (open ? 1 : 0)} ${(applicants ?? 0) - (open ? 1 : 0) === 1 ? 'other' : 'others'} · ${requirement?.quantity ?? 1} ${requirement?.quantity === 1 ? 'spot' : 'spots'}`
                : 'Just you so far'
            }
          />
        </div>
      </Panel>

      {open && (
        <Panel
          title="A note to the club"
          description="Optional. The club sees your profile either way — this is for anything the profile does not say."
        >
          <form action={updateSubmissionMessageAction} className="flex flex-col gap-3">
            <input type="hidden" name="submission_id" value={submission.id} />
            <textarea
              name="message"
              rows={3}
              maxLength={600}
              defaultValue={submission.message ?? ''}
              placeholder="Ten new minutes I want to try before the tour, and I can travel at short notice."
              className="w-full resize-y bg-[var(--ev-bg)] px-4 py-3 text-[14px] leading-relaxed text-[var(--ev-text)] outline-none ring-1 ring-inset ring-[var(--ev-line)] placeholder:text-[var(--ev-faint)] focus-visible:ring-[var(--ev-accent-fill)]"
              style={{ borderRadius: 'var(--ev-r-art)' }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className={portalButton.primary}>
                {submission.message ? 'Update the note' : 'Add the note'}
              </button>
            </div>
          </form>
        </Panel>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <Link href="/artist-app/open-spots" className={portalButton.secondary}>
          Back to open spots
        </Link>

        {submission.status === 'accepted' && (
          <Link href="/artist-app/bookings" className={portalButton.primary}>
            See the offer
          </Link>
        )}

        {open && (
          <form action={withdrawSubmissionAction}>
            <input type="hidden" name="submission_id" value={submission.id} />
            <button type="submit" className={portalButton.secondary}>
              Withdraw application
            </button>
          </form>
        )}
      </div>
    </>
  )
}
