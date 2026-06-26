import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  formatBookingDate,
  formatBookingHonorar,
  formatBookingSpotLabel,
} from '@/lib/booking-offer-format'
import {
  AcceptedResultPage,
  BookingOfferPage,
  FilledResultPage,
  ResultPage,
  type BookingOfferDetails,
} from '../components'

export default async function PublicBookingOfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ result?: string }>
}) {
  const { token } = await params
  const { result } = await searchParams

  const db = createAdminClient()
  const { data: offer } = await db
    .from('booking_offers')
    .select('id, status, fee_amount, currency, expires_at, show_id, show_requirement_id')
    .eq('token', token)
    .single()

  if (!offer) notFound()

  const [{ data: show }, { data: req }] = await Promise.all([
    db.from('shows').select('title, date, start_time, venue_name, venue_address, club_id').eq('id', offer.show_id).single(),
    db.from('show_requirements').select('role_name, compensation_type, compensation_amount, compensation_percent').eq('id', offer.show_requirement_id).single(),
  ])

  const clubName = show?.club_id
    ? (await db.from('clubs').select('name').eq('id', show.club_id).single()).data?.name ?? show.title
    : show?.title ?? 'klubben'

  const details: BookingOfferDetails = {
    clubName,
    showTitle: show?.title ?? 'Show',
    showDate: show?.date ?? null,
    startTime: show?.start_time ?? null,
    venueName: show?.venue_name ?? null,
    venueAddress: show?.venue_address ?? null,
    spotLabel: formatBookingSpotLabel(req?.role_name),
    honorarLabel: formatBookingHonorar({
      fee_amount: offer.fee_amount,
      currency: offer.currency,
      compensation_type: req?.compensation_type,
      compensation_amount: req?.compensation_amount,
      compensation_percent: req?.compensation_percent,
    }),
  }

  if (result === 'accepted') {
    return <AcceptedResultPage details={details} />
  }
  if (result === 'filled_by_other') {
    return <FilledResultPage details={details} />
  }
  if (result === 'already_booked') {
    // The artist was already confirmed on this show — a successful state, not an error.
    return (
      <ResultPage
        icon="✓"
        title={`Du er allerede booket hos ${details.clubName}`}
        message="Du har allerede takket ja til denne spotten. Vi gleder oss til å se deg på scenen!"
        variant="success"
      />
    )
  }
  if (result === 'cancelled') {
    return (
      <ResultPage
        icon="!"
        title="Tilbudet er ikke lenger aktivt"
        message="Dette bookingtilbudet har blitt kansellert av klubben. Ta kontakt hvis du har spørsmål."
        variant="neutral"
      />
    )
  }
  if (result === 'declined') {
    return (
      <ResultPage
        icon="✓"
        title="Takk for svaret"
        message="Du vil fortsatt få tilbud i fremtiden selv om denne datoen ikke passet."
        variant="neutral"
      />
    )
  }
  if (result === 'expired') {
    return (
      <ResultPage
        icon="!"
        title="Tilbudet er utløpt"
        message="Dette bookingtilbudet er ikke lenger aktivt."
        variant="neutral"
      />
    )
  }
  if (result === 'error') {
    return (
      <ResultPage
        icon="✗"
        title="Noe gikk galt"
        message="Tilbudet kan allerede ha blitt besvart eller er utløpt. Kontakt oss hvis du trenger hjelp."
        variant="error"
      />
    )
  }

  const isExpired = offer.expires_at ? new Date(offer.expires_at) < new Date() : false
  const canRespond = offer.status === 'sent' && !isExpired

  return (
    <BookingOfferPage
      details={details}
      token={token}
      canRespond={canRespond}
      statusMessage={
        !canRespond && !result
          ? isExpired
            ? 'Dette tilbudet er utløpt.'
            : `Status: ${offer.status.replaceAll('_', ' ')}`
          : undefined
      }
    />
  )
}
