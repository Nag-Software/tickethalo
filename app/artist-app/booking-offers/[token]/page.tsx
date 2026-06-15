import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArtistBadge,
  ArtistPage,
  ArtistPageHeader,
  formatArtistDate,
  offerStatusLabel,
} from '@/components/artist/artist-ui'
import { formatMoney, getCurrentArtist } from '@/lib/artist-portal'
import { OfferButtons } from '../offer-buttons'

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

  return (
    <ArtistPage>
      <ArtistPageHeader
        title={show?.title ?? 'Bookingtilbud'}
        description={show?.date ? formatArtistDate(show.date, 'long') : 'Dato kommer'}
        action={
          <Link href="/artist-app/booking-offers" className="text-sm font-medium underline underline-offset-4 hover:text-[#ff6bff]">
            Tilbake til tilbud
          </Link>
        }
      />

      <div className="max-w-2xl border border-black/10">
        <div className="grid gap-px bg-black/10 sm:grid-cols-2">
          <Info label="Honorar" value={formatMoney(offer.fee_amount, offer.currency)} />
          <Info label="Status" value={offerStatusLabel(offer.status)} />
          <Info label="Sted" value={show?.venue_name ?? 'Ikke satt'} />
          <Info label="Adresse" value={show?.venue_address ?? 'Ikke satt'} />
        </div>

        {offer.status === 'sent' && (
          <div className="flex flex-wrap gap-2 border-t border-black/10 p-4">
            <OfferButtons token={offer.token} />
          </div>
        )}

        {offer.status !== 'sent' && (
          <div className="border-t border-black/10 p-4">
            <ArtistBadge variant="muted">{offerStatusLabel(offer.status)}</ArtistBadge>
          </div>
        )}
      </div>

      {offer.status === 'sent' && (
        <p className="mt-4 max-w-2xl text-sm text-zinc-500">
          Når du aksepterer og plassen fortsatt er ledig, flyttes bookingen til Bookinger.
        </p>
      )}
    </ArtistPage>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}
