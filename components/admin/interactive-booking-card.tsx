import { ShowBookingCard, type BookingCardShow } from '@/components/admin/show-booking-card'
import { InteractiveLineup, type LineupArtist } from '@/components/admin/interactive-lineup'

/**
 * The booking card with a lineup you can work in.
 *
 * Same card the shows list draws — the difference is the lineup: each row's
 * role, artist and fee are set from the row itself, so the show's own page
 * never has to send the booker off to a separate lineup screen. The status
 * stays read-only; it follows from the booking, not from a menu.
 *
 * Drawn compact: the page header already carries the title, date and status,
 * and the poster lives on the Marketing tab.
 */
export function InteractiveBookingCard({
  show,
  currency,
  artists,
}: {
  show: BookingCardShow
  currency: string
  /** Artists still free to take a spot on this show. */
  artists: LineupArtist[]
}) {
  const readOnly = show.status === 'completed' || show.status === 'cancelled'

  return (
    <ShowBookingCard
      show={show}
      linked={false}
      compact
      lineup={
        <InteractiveLineup
          showId={show.id}
          currency={currency}
          spots={show.spots}
          artists={artists}
          readOnly={readOnly}
        />
      }
    />
  )
}
