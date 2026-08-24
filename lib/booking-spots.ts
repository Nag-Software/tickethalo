import type { RequirementCompensationType } from '@/types/database'

/** The fee as stored on the requirement, so an editor can round-trip it. */
export type BookingSpotFee = {
  type: RequirementCompensationType | null
  /** Minor units (øre/cents), as stored. */
  amount: number | null
  percent: number | null
}

/**
 * One row in a show's lineup — one seat, not one requirement.
 *
 * A requirement with `quantity: 3` becomes three rows, which is how the lineup
 * actually reads. Confirmed spots fill the rows first, then offers that are
 * still out, and whatever is left stays available.
 */
export type BookingSpot = {
  key: string
  /** Sequential position in the lineup, 1-based. */
  position: number
  /** The requirement the row expands from — the row's role and fee live there. */
  requirementId: string
  roleName: string
  artistName: string | null
  artistId: string | null
  /** `confirmed_spots.id` when the row is booked, and the caller passed ids. */
  spotId: string | null
  /** `booking_offers.id` while the row is waiting for a reply. */
  offerId: string | null
  feeLabel: string
  fee: BookingSpotFee
  state: 'booked' | 'pending' | 'open'
}

type RequirementInput = {
  id: string
  role_name: string
  quantity: number
  compensation_type: RequirementCompensationType | null
  compensation_amount: number | null
  compensation_percent: number | null
}

type SpotInput = {
  /** Only the interactive card needs it — the shows list reads rows without ids. */
  id?: string
  artist_id: string
  show_requirement_id: string | null
  status: string
}

type OfferInput = {
  id?: string
  artist_id: string
  show_requirement_id: string | null
  status: string
}

const ACTIVE_SPOT_STATUSES = ['confirmed', 'completed', 'paid']

function formatPercent(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

/** The fee as set on the lineup spot — same sources the lineup tab reads. */
export function requirementFeeLabel(requirement: RequirementInput, currency: string) {
  if (requirement.compensation_type === 'percent') {
    const percent = requirement.compensation_percent
    if (percent == null) return 'Not set'
    if (percent === 0) return 'No fee'
    return `${formatPercent(percent)}% of sales`
  }

  if (requirement.compensation_type === 'fixed') {
    const amount = requirement.compensation_amount
    if (amount == null) return 'Fixed fee'
    if (amount === 0) return 'No fee'
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount / 100)
  }

  return 'Not set'
}

/**
 * Expands a show's requirements into the per-seat rows the booking card draws.
 * Requirements are taken in the order given, so the caller decides the lineup
 * order (`lineup_position`, then `created_at`).
 */
export function buildBookingSpots({
  requirements,
  confirmedSpots,
  offers,
  artistName,
  currency,
}: {
  requirements: RequirementInput[]
  confirmedSpots: SpotInput[]
  offers: OfferInput[]
  artistName: (artistId: string) => string
  currency: string
}): BookingSpot[] {
  let position = 0

  return requirements.flatMap((requirement) => {
    const booked = confirmedSpots
      .filter((spot) => spot.show_requirement_id === requirement.id && ACTIVE_SPOT_STATUSES.includes(spot.status))
    const pending = offers
      .filter((offer) => offer.show_requirement_id === requirement.id && offer.status === 'sent')
    const feeLabel = requirementFeeLabel(requirement, currency)
    const fee: BookingSpotFee = {
      type: requirement.compensation_type,
      amount: requirement.compensation_amount,
      percent: requirement.compensation_percent,
    }

    return Array.from({ length: Math.max(requirement.quantity, 1) }, (_, index) => {
      position += 1
      const bookedSpot = booked[index]
      const pendingOffer = bookedSpot ? undefined : pending[index - booked.length]
      const artistId = bookedSpot?.artist_id ?? pendingOffer?.artist_id ?? null

      return {
        key: `${requirement.id}-${index}`,
        position,
        requirementId: requirement.id,
        roleName: requirement.role_name,
        artistName: artistId ? artistName(artistId) : null,
        artistId,
        spotId: bookedSpot?.id ?? null,
        offerId: pendingOffer?.id ?? null,
        feeLabel,
        fee,
        state: bookedSpot ? 'booked' : pendingOffer ? 'pending' : 'open',
      } satisfies BookingSpot
    })
  })
}
