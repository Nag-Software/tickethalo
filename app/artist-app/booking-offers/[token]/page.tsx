import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CalendarDays, Clock, MapPin } from 'lucide-react'
import { formatMoney, getCurrentArtist } from '@/lib/artist-portal'
import { requirementFeeLabel } from '@/lib/booking-spots'
import { Chip, Panel, portalButton } from '@/components/artist/portal-ui'
import { OfferButtons } from '@/components/artist/offer-buttons'

const OFFER_STATUS_LABELS: Record<string, string> = {
  sent: 'Awaiting response',
  accepted: 'Accepted',
  declined: 'Declined',
  filled_by_other: 'Filled by other',
  expired: 'Expired',
  cancelled: 'Cancelled',
}

export default async function BookingOfferTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { artist, db } = await getCurrentArtist()
  const { data: offer } = await db.from('booking_offers').select('*').eq('token', token).single()
  if (!offer || offer.artist_id !== artist.id) notFound()

  const [{ data: show }, { data: req }] = await Promise.all([
    db
      .from('shows')
      .select('title, date, start_time, venue_name, venue_address')
      .eq('id', offer.show_id)
      .single(),
    db
      .from('show_requirements')
      .select('compensation_type, compensation_amount, compensation_percent')
      .eq('id', offer.show_requirement_id)
      .single(),
  ])

  const isOpen = offer.status === 'sent'
  const venue = [show?.venue_name, show?.venue_address].filter(Boolean).join(', ')

  /* Tilbud fra før honoraret ble kopiert til raden — og alle prosentavtaler,
     som ikke har noe beløp — leser honoraret fra lineup-plassen i stedet. */
  const feeLabel = offer.fee_amount != null
    ? formatMoney(offer.fee_amount, offer.currency)
    : req
      ? requirementFeeLabel(req, offer.currency || 'NOK')
      : 'Not set'

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <Link
        href="/artist-app/bookings"
        className="inline-flex w-fit items-center gap-2 text-[13px] text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)]"
      >
        <ArrowLeft className="size-4" /> Back to bookings
      </Link>

      <Panel>
        <div className="flex items-start justify-between gap-4">
          <h1 className="min-w-0 text-[1.35rem] font-semibold leading-tight tracking-[-0.02em]">
            {show?.title ?? 'Booking offer'}
          </h1>
          <Chip tone={isOpen ? 'accent' : 'neutral'}>
            {OFFER_STATUS_LABELS[offer.status] ?? offer.status.replaceAll('_', ' ')}
          </Chip>
        </div>

        {/* Honoraret er tallet svaret henger på — det får stå alene. */}
        <p className="text-[2.25rem] font-semibold leading-none tabular-nums">{feeLabel}</p>

        <div className="flex flex-col gap-2.5 text-[14px]">
          <Detail icon={<CalendarDays className="size-4" />}>
            {show?.date ? formatDate(show.date) : 'Date not set'}
          </Detail>
          <Detail icon={<Clock className="size-4" />}>
            {show?.start_time ? show.start_time.slice(0, 5) : 'Time not set'}
          </Detail>
          <Detail icon={<MapPin className="size-4" />}>{venue || 'Venue not set'}</Detail>
        </div>

        {isOpen ? (
          <div className="flex flex-col gap-2.5 border-t border-[var(--ev-line)] pt-5">
            <OfferButtons token={offer.token} size="lg" />
            <p className="text-[12.5px] leading-relaxed text-[var(--ev-muted)]">
              The spot is not yours until you accept, and may be filled by another comedian in the
              meantime.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 border-t border-[var(--ev-line)] pt-5">
            <p className="text-[14px] text-[var(--ev-muted)]">
              This offer is no longer accepting responses.
            </p>
            <Link href="/artist-app/bookings" className={`${portalButton.secondary} w-fit`}>
              See all bookings
            </Link>
          </div>
        )}
      </Panel>
    </div>
  )
}

function Detail({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-[var(--ev-faint)]">{icon}</span>
      <span className="min-w-0 font-medium">{children}</span>
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value))
}
