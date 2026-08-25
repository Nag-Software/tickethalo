import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirementFeeLabel } from '@/lib/booking-spots'
import { publicAcceptOfferAction, publicDeclineOfferAction } from './actions'

export const metadata = { title: 'Booking offer — Tickethalo' }

const OFFER_STATUS_LABELS: Record<string, string> = {
  sent: 'Awaiting your reply',
  accepted: 'Accepted',
  declined: 'Declined',
  filled_by_other: 'Taken by someone else',
  expired: 'Expired',
  cancelled: 'Withdrawn',
}

export default async function PublicBookingOfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ result?: string }>
}) {
  const { token } = await params
  const { result } = await searchParams

  if (result) return <ResultPage result={result} />

  const db = createAdminClient()
  const { data: offer } = await db
    .from('booking_offers')
    .select('id, status, fee_amount, currency, expires_at, show_id, show_requirement_id')
    .eq('token', token)
    .single()

  if (!offer) notFound()

  const [{ data: show }, { data: requirements }] = await Promise.all([
    db
      .from('shows')
      .select('title, date, start_time, venue_name, venue_address, currency')
      .eq('id', offer.show_id)
      .single(),
    // Hele lineupen, ikke bare plassen tilbudet gjelder: komikeren skal se
    // hvor mange spots showet har og hvilket nummer i rekka de får.
    db
      .from('show_requirements')
      .select('id, role_name, quantity, compensation_type, compensation_amount, compensation_percent')
      .eq('show_id', offer.show_id)
      .order('lineup_position')
      .order('created_at'),
  ])

  const lineup = requirements ?? []
  const seats = (index: number) =>
    lineup.slice(0, index).reduce((sum, item) => sum + Math.max(item.quantity, 1), 0)
  const totalSpots = seats(lineup.length)
  const index = lineup.findIndex((item) => item.id === offer.show_requirement_id)
  const req = index >= 0 ? lineup[index] : null
  const lineupNumber = index >= 0 ? seats(index) + 1 : null

  const isExpired = offer.expires_at ? new Date(offer.expires_at) < new Date() : false
  const canRespond = offer.status === 'sent' && !isExpired
  const currency = offer.currency || show?.currency || 'NOK'

  /* Tilbud fra før honoraret ble kopiert til raden — og alle prosentavtaler,
     som ikke har noe beløp — leser honoraret fra lineup-plassen i stedet. */
  const feeLabel = offer.fee_amount != null
    ? formatMoney(offer.fee_amount, currency)
    : req
      ? requirementFeeLabel(req, currency)
      : 'Not set'

  const statusLabel = canRespond
    ? OFFER_STATUS_LABELS.sent
    : isExpired && offer.status === 'sent'
      ? OFFER_STATUS_LABELS.expired
      : OFFER_STATUS_LABELS[offer.status] ?? offer.status.replaceAll('_', ' ')

  return (
    <Shell>
      <p className="text-[13px] font-medium text-[var(--ev-accent)]">BOOKING OFFER</p>
      <h1 className="mt-2 text-balance text-[2rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[2.5rem]">
        {show?.title ?? 'Booking offer'}
      </h1>

      <div className="mt-8 bg-[var(--ev-card)] p-6 sm:p-8" style={{ borderRadius: 'var(--ev-r-card)' }}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--ev-faint)]">Your fee</p>
            {/* Honoraret er tallet svaret henger på — det får stå alene. */}
            <p className="mt-1 text-[2.25rem] font-semibold leading-none tracking-[-0.02em] tabular-nums">
              {feeLabel}
            </p>
          </div>
          <span
            className="inline-flex items-center whitespace-nowrap bg-[var(--ev-card-hover)] px-2.5 py-1 text-[12px] font-medium text-[var(--ev-muted)]"
            style={{ borderRadius: 'var(--ev-r-chip)' }}
          >
            {statusLabel}
          </span>
        </div>

        <dl className="mt-7 flex flex-col divide-y divide-[var(--ev-line)] border-y border-[var(--ev-line)] text-[14px]">
          <Detail label="Date">{show?.date ? formatDate(show.date) : 'Coming'}</Detail>
          <Detail label="Time">{show?.start_time ? show.start_time.slice(0, 5) : 'Coming'}</Detail>
          <Detail label="Venue">{show?.venue_name || 'Coming'}</Detail>
          {show?.venue_address && <Detail label="Address">{show.venue_address}</Detail>}
          <Detail label="Your role">{req?.role_name ?? 'Coming'}</Detail>
          <Detail label="Lineup">
            {lineupNumber && totalSpots
              ? `No. ${lineupNumber} of ${totalSpots} spots`
              : totalSpots
                ? `${totalSpots} spots`
                : 'Coming'}
          </Detail>
        </dl>

        {canRespond ? (
          <div className="mt-7 flex flex-col gap-2.5">
            <div className="flex flex-col gap-2.5 sm:flex-row">
              <form action={publicAcceptOfferAction} className="sm:flex-1">
                <input type="hidden" name="token" value={token} />
                <button
                  type="submit"
                  className="inline-flex h-12 w-full items-center justify-center bg-[var(--ev-text)] px-5 text-[15px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
                  style={{ borderRadius: 'var(--ev-r-chip)' }}
                >
                  Accept the spot
                </button>
              </form>
              <form action={publicDeclineOfferAction}>
                <input type="hidden" name="token" value={token} />
                <button
                  type="submit"
                  className="inline-flex h-12 w-full items-center justify-center px-6 text-[15px] font-semibold text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line-strong)] transition-colors hover:text-[var(--ev-text)] hover:ring-[var(--ev-text)]"
                  style={{ borderRadius: 'var(--ev-r-chip)' }}
                >
                  Decline
                </button>
              </form>
            </div>
            <p className="text-[12.5px] leading-relaxed text-[var(--ev-muted)]">
              First to accept gets the spot.
              {offer.expires_at ? ` Open until ${formatDate(offer.expires_at)}.` : ''}
            </p>
          </div>
        ) : (
          <div className="mt-7 flex flex-col gap-3">
            <p className="text-[14px] text-[var(--ev-muted)]">
              {isExpired ? 'This offer has expired.' : 'This offer is closed for replies.'}
            </p>
            <Link
              href="/artist-app/bookings"
              className="inline-flex h-11 w-fit items-center justify-center px-5 text-[13px] font-semibold text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line-strong)] transition-colors hover:text-[var(--ev-text)] hover:ring-[var(--ev-text)]"
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              See your bookings
            </Link>
          </div>
        )}
      </div>

      <p className="mt-6 text-[13px] text-[var(--ev-faint)]">
        Questions?{' '}
        <a href="mailto:hei@tickethalo.com" className="underline underline-offset-4">
          hei@tickethalo.com
        </a>
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      // The document root is still lang="nb" for the Norwegian portals — see
      // app/page.tsx for why this page declares its own language.
      lang="en"
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-28 md:px-8">
        {children}
      </section>

      <Footer />
    </main>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="shrink-0 text-[var(--ev-faint)]">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  )
}

const RESULTS: Record<string, { tone: 'success' | 'neutral' | 'error'; title: string; message: string }> = {
  accepted: {
    tone: 'success',
    title: 'You are on the lineup',
    message: 'A confirmation with the details is on its way to your inbox.',
  },
  filled_by_other: {
    tone: 'neutral',
    title: 'The spot was taken',
    message: 'Someone else got there first. You will keep getting offers for other shows.',
  },
  declined: {
    tone: 'neutral',
    title: 'Reply registered',
    message: 'This date is a no. Saying no changes nothing — you will keep getting offers.',
  },
  expired: {
    tone: 'neutral',
    title: 'The offer has expired',
    message: 'New offers show up in the comedian portal and in your inbox.',
  },
  error: {
    tone: 'error',
    title: 'Something went wrong',
    message: 'The offer may already have been answered, or it has expired. Get in touch and we will sort it out.',
  },
}

function ResultPage({ result }: { result: string }) {
  const outcome = RESULTS[result] ?? RESULTS.error

  return (
    <Shell>
      <div className="bg-[var(--ev-card)] p-7 sm:p-9" style={{ borderRadius: 'var(--ev-r-card)' }}>
        {outcome.tone === 'success' ? (
          <CheckCircle2 className="size-10" style={{ color: 'var(--ev-accent-fill)' }} aria-hidden />
        ) : outcome.tone === 'error' ? (
          <AlertTriangle className="size-10 text-[var(--ev-accent)]" aria-hidden />
        ) : (
          <XCircle className="size-10 text-[var(--ev-faint)]" aria-hidden />
        )}
        <h1 className="mt-5 text-balance text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
          {outcome.title}
        </h1>
        {/* role="alert" — komikeren må ikke gå glipp av at svaret ikke gikk gjennom. */}
        <p
          role={outcome.tone === 'error' ? 'alert' : undefined}
          className={
            outcome.tone === 'error'
              ? 'mt-2.5 text-[15px] leading-relaxed text-[var(--ev-accent)]'
              : 'mt-2.5 text-[15px] leading-relaxed text-[var(--ev-muted)]'
          }
        >
          {outcome.message}
        </p>

        <div className="mt-7 flex flex-wrap gap-2.5">
          <Link
            href="/artist-app/bookings"
            className="inline-flex h-11 items-center justify-center bg-[var(--ev-text)] px-5 text-[13px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
            style={{ borderRadius: 'var(--ev-r-chip)' }}
          >
            Open the comedian portal
          </Link>
          <a
            href="mailto:hei@tickethalo.com"
            className="inline-flex h-11 items-center justify-center px-5 text-[13px] font-semibold text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line-strong)] transition-colors hover:text-[var(--ev-text)] hover:ring-[var(--ev-text)]"
            style={{ borderRadius: 'var(--ev-r-chip)' }}
          >
            Contact us
          </a>
        </div>
      </div>
    </Shell>
  )
}

function formatDate(value: string) {
  const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value)
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

/** `fee_amount` ligger i minor units (øre), som ellers i basen. */
function formatMoney(minorAmount: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency || 'NOK',
    maximumFractionDigits: 0,
  }).format(minorAmount / 100)
}
