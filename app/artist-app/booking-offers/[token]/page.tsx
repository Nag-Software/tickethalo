import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { formatMoney, getCurrentArtist } from '@/lib/artist-portal'
import { Chip, DataRow, PageHeader, Panel, portalButton } from '@/components/artist/portal-ui'
import { OfferButtons } from '../page'

const OFFER_STATUS_LABELS: Record<string, string> = {
  sent: 'Venter på svar',
  accepted: 'Akseptert',
  declined: 'Avslått',
  filled_by_other: 'Fylt av andre',
  expired: 'Utløpt',
  cancelled: 'Kansellert',
}

export default async function BookingOfferTokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { artist, db } = await getCurrentArtist()
  const { data: offer } = await db.from('booking_offers').select('*').eq('token', token).single()
  if (!offer || offer.artist_id !== artist.id) notFound()

  const { data: show } = await db
    .from('shows')
    .select('title, date, start_time, venue_name, venue_address')
    .eq('id', offer.show_id)
    .single()

  const isOpen = offer.status === 'sent'

  return (
    <>
      <Link
        href="/artist-app/booking-offers"
        className="inline-flex w-fit items-center gap-2 text-[13px] text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)]"
      >
        <ArrowLeft className="size-4" /> Alle tilbud
      </Link>

      <PageHeader
        title={show?.title ?? 'Bookingtilbud'}
        description={[
          show?.date ? formatDate(show.date) : 'Dato kommer',
          show?.start_time ? show.start_time.slice(0, 5) : null,
          show?.venue_name,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <Chip tone={isOpen ? 'accent' : 'neutral'}>
            {OFFER_STATUS_LABELS[offer.status] ?? offer.status.replaceAll('_', ' ')}
          </Chip>
        }
      />

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Panel title="Detaljer">
          <div className="flex flex-col divide-y divide-[var(--ev-line)]">
            <DataRow label="Honorar" value={formatMoney(offer.fee_amount, offer.currency)} />
            <DataRow label="Dato" value={show?.date ? formatDate(show.date) : 'Ikke satt'} />
            <DataRow label="Tid" value={show?.start_time ? show.start_time.slice(0, 5) : 'Ikke satt'} />
            <DataRow label="Sted" value={show?.venue_name ?? 'Ikke satt'} />
            <DataRow label="Adresse" value={show?.venue_address ?? 'Ikke satt'} />
          </div>
        </Panel>

        <Panel title={isOpen ? 'Svar på tilbudet' : 'Tilbudet er avsluttet'}>
          {isOpen ? (
            <>
              <p className="text-[14px] leading-relaxed text-[var(--ev-muted)]">
                Plassen er ikke din før du aksepterer, og kan bli fylt av en annen komiker i mellomtiden.
              </p>
              <div className="flex flex-wrap gap-2">
                <OfferButtons token={offer.token} />
              </div>
            </>
          ) : (
            <>
              <p className="text-[14px] leading-relaxed text-[var(--ev-muted)]">
                Dette tilbudet tar ikke imot svar lenger.
              </p>
              <Link href="/artist-app/booking-offers" className={portalButton.secondary}>
                Se andre tilbud
              </Link>
            </>
          )}
        </Panel>
      </div>
    </>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value))
}
