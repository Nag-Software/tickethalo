import Link from 'next/link'
import { formatMoney, getCurrentArtist } from '@/lib/artist-portal'
import { BookingOfferStatusToast } from './status-toast'
import { OfferButtons } from '@/components/artist/offer-buttons'
import { Chip, Empty, PageHeader, Panel, Row, portalButton } from '@/components/artist/portal-ui'

const OFFER_STATUS_LABELS: Record<string, string> = {
  sent: 'Venter på svar',
  accepted: 'Akseptert',
  declined: 'Avslått',
  filled_by_other: 'Fylt av andre',
  expired: 'Utløpt',
  cancelled: 'Kansellert',
}

export default async function BookingOffersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const { artist, db } = await getCurrentArtist()
  const { data: offers } = await db.from('booking_offers').select('*').eq('artist_id', artist.id).order('created_at', { ascending: false })
  const showIds = [...new Set((offers ?? []).map((offer) => offer.show_id))]
  const { data: shows } = showIds.length > 0
    ? await db.from('shows').select('id, title, date, venue_name, status').in('id', showIds)
    : { data: [] }
  const showMap = new Map((shows ?? []).map((show) => [show.id, show]))
  const today = new Date().toISOString().slice(0, 10)
  const activeCount = (offers ?? []).filter((offer) => {
    const show = showMap.get(offer.show_id)
    return offer.status === 'sent' && !(show?.date && show.date < today)
  }).length

  return (
    <>
      <BookingOfferStatusToast status={status} />

      <PageHeader
        title="Tilbud"
        description="Et tilbud er først bekreftet når du aksepterer og plassen fortsatt er ledig."
      />

      {status && <StatusMessage status={status} />}

      <Panel
        title={activeCount > 0 ? `${activeCount} venter på svar` : 'Alle tilbud'}
        description="Aksepterte tilbud kan bli fylt av andre hvis showet allerede er fullt."
      >
        {(offers ?? []).length === 0 ? (
          <Empty>Ingen bookingtilbud ennå.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {(offers ?? []).map((offer) => {
              const show = showMap.get(offer.show_id)
              const showPast = show?.date ? show.date < today : false
              const active = offer.status === 'sent' && !showPast

              return (
                <Row key={offer.id} muted={showPast}>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium">{show?.title ?? 'Show'}</p>
                    <p className="mt-0.5 truncate text-[13px] text-[var(--ev-muted)]">
                      {show?.date ? formatDate(show.date) : 'Dato kommer'}
                      {show?.venue_name ? ` · ${show.venue_name}` : ''}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Chip tone={active ? 'accent' : 'neutral'}>
                        {OFFER_STATUS_LABELS[offer.status] ?? offer.status.replaceAll('_', ' ')}
                      </Chip>
                      <Chip>{formatMoney(offer.fee_amount, offer.currency)}</Chip>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {active ? (
                      <OfferButtons token={offer.token} />
                    ) : (
                      <Link href={`/artist-app/booking-offers/${offer.token}`} className={portalButton.secondary}>
                        Åpne
                      </Link>
                    )}
                  </div>
                </Row>
              )
            })}
          </div>
        )}
      </Panel>
    </>
  )
}

function StatusMessage({ status }: { status: string }) {
  const text = status === 'accepted'
    ? 'Du er bekreftet på showet. Detaljene ligger under Bookinger.'
    : status === 'filled_by_other'
      ? 'Takk for rask respons. Plassen ble fylt av en annen komiker før du rakk å bekrefte.'
      : status === 'already_booked'
        ? 'Du er allerede bekreftet på dette showet. En komiker kan bare ha én spot per lineup.'
        : status === 'declined'
          ? 'Takk for svaret. Tilbudet er avslått.'
          : status === 'denied'
            ? 'Dette tilbudet tilhører ikke komikerkontoen din.'
            : 'Status er oppdatert.'

  return (
    <p
      className="bg-[var(--ev-card)] px-5 py-4 text-[14px] font-medium"
      style={{ borderRadius: 'var(--ev-r-art)' }}
    >
      {text}
    </p>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}
