import Link from 'next/link'
import {
  ArtistBadge,
  ArtistEmpty,
  ArtistList,
  ArtistListRow,
  ArtistNotice,
  ArtistPage,
  ArtistPageHeader,
  artistSecondaryButtonClass,
  formatArtistDate,
  offerStatusLabel,
} from '@/components/artist/artist-ui'
import { formatMoney, getCurrentArtist } from '@/lib/artist-portal'
import { BookingOfferStatusToast } from './status-toast'
import { OfferButtons } from './offer-buttons'

export default async function BookingOffersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const { artist, db } = await getCurrentArtist()
  const { data: offers } = await db
    .from('booking_offers')
    .select('*')
    .eq('artist_id', artist.id)
    .order('created_at', { ascending: false })

  const showIds = [...new Set((offers ?? []).map((offer) => offer.show_id))]
  const { data: shows } = showIds.length > 0
    ? await db.from('shows').select('id, title, date, venue_name, status').in('id', showIds)
    : { data: [] }
  const showMap = new Map((shows ?? []).map((show) => [show.id, show]))
  const today = new Date().toISOString().slice(0, 10)
  const pending = (offers ?? []).filter((offer) => offer.status === 'sent' && !(showMap.get(offer.show_id)?.date && showMap.get(offer.show_id)!.date! < today))

  return (
    <ArtistPage>
      <BookingOfferStatusToast status={status} />
      <ArtistPageHeader
        title="Tilbud"
        description={pending.length > 0 ? `${pending.length} venter på svar` : 'Oversikt over alle bookingtilbud'}
      />

      {status && <StatusMessage status={status} />}

      {(offers ?? []).length === 0 ? (
        <ArtistEmpty text="Ingen bookingtilbud ennå." />
      ) : (
        <ArtistList>
          {(offers ?? []).map((offer) => {
            const show = showMap.get(offer.show_id)
            const showPast = show?.date ? show.date < today : false
            const active = offer.status === 'sent' && !showPast

            return (
              <ArtistListRow
                key={offer.id}
                title={show?.title ?? 'Bookingtilbud'}
                meta={[
                  show?.date ? formatArtistDate(show.date, 'weekday') : 'Dato kommer',
                  show?.venue_name,
                  formatMoney(offer.fee_amount, offer.currency),
                ].filter(Boolean).join(' · ')}
                aside={
                  <>
                    <ArtistBadge variant={active ? 'accent' : 'muted'}>
                      {offerStatusLabel(offer.status)}
                    </ArtistBadge>
                    {showPast && <ArtistBadge variant="muted">Showet har vært</ArtistBadge>}
                  </>
                }
                actions={
                  <>
                    <Link href={`/artist-app/booking-offers/${offer.token}`} className={artistSecondaryButtonClass}>
                      Detaljer
                    </Link>
                    {active && <OfferButtons token={offer.token} />}
                  </>
                }
              />
            )
          })}
        </ArtistList>
      )}
    </ArtistPage>
  )
}

function StatusMessage({ status }: { status: string }) {
  const text = status === 'accepted'
    ? 'Du er nå booket! Se detaljene under Bookinger.'
    : status === 'filled_by_other'
      ? 'En annen komiker fikk spotten. Line-upen er full, men nye muligheter kommer snart.'
      : status === 'already_booked'
        ? 'Du er allerede booket på dette showet.'
        : status === 'declined'
          ? 'Tilbudet er avslått.'
          : status === 'denied'
            ? 'Dette tilbudet tilhører ikke kontoen din.'
            : 'Status er oppdatert.'

  return <ArtistNotice tone={status === 'accepted' ? 'success' : 'neutral'}>{text}</ArtistNotice>
}
