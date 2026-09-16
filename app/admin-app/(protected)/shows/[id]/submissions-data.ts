import { formatDistanceToNowStrict } from 'date-fns'
import { createAdminClient } from '@/lib/supabase/admin'
import { requirementFeeLabel } from '@/lib/booking-spots'
import { formatArtistRole } from '@/lib/artist-roles'
import type { BookingOffer, ConfirmedSpot, ShowRequirement, ShowStatus, SubmissionSource, SubmissionStatus } from '@/types/database'

/**
 * Det søknadsfanen tegner, ferdig regnet ut på serveren.
 *
 * Fanen er en klientkomponent, og både «for 3 dager siden» og hvorfor en
 * søknad ikke kan godtas avhenger av klokka og av rader klienten ikke har.
 * Regnes det her, er det én sannhet — og ingen hydreringsfeil når minuttet
 * skifter mellom server og nettleser.
 */

type Db = ReturnType<typeof createAdminClient>

export type SubmissionItem = {
  id: string
  status: SubmissionStatus
  source: SubmissionSource
  message: string | null
  appliedLabel: string
  respondedLabel: string | null
  artist: {
    id: string
    name: string
    /** Det borgerlige navnet, når komikeren opptrer under et annet. */
    legalName: string | null
    imageUrl: string | null
    details: string[]
  }
  /** Klubben har knyttet komikeren til seg. */
  onRoster: boolean
  flagged: boolean
  /** Statusen på tilbudet søknaden ble til. */
  offerStatus: BookingOffer['status'] | null
  /** Hvorfor «Approve» er stengt. Null = kan godtas. */
  blocker: string | null
}

export type SubmissionGroup = {
  requirementId: string
  position: number
  roleName: string
  feeLabel: string
  open: boolean
  quantity: number
  filled: number
  items: SubmissionItem[]
}

const OPEN_STATUSES: SubmissionStatus[] = ['pending', 'shortlisted']
const ACTIVE_SPOT_STATUSES = ['confirmed', 'completed', 'paid']

export async function loadSubmissionGroups(
  db: Db,
  {
    showId,
    clubId,
    showStatus,
    currency,
    requirements,
    lineup,
    offers,
  }: {
    showId: string
    clubId: string | null
    showStatus: ShowStatus
    currency: string
    requirements: ShowRequirement[]
    lineup: ConfirmedSpot[]
    offers: BookingOffer[]
  },
): Promise<SubmissionGroup[]> {
  const { data: submissions, error } = await db
    .from('show_submissions')
    .select('id, show_requirement_id, artist_id, source, status, message, created_at, updated_at, responded_at, booking_offer_id')
    .eq('show_id', showId)
    .order('created_at')

  if (error) throw new Error(error.message)

  const artistIds = [...new Set((submissions ?? []).map((row) => row.artist_id))]

  const [{ data: artists }, { data: reviews }] = await Promise.all([
    artistIds.length
      ? db.from('artists').select('id, full_name, stage_name, profile_image_url, city, category').in('id', artistIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string; stage_name: string | null; profile_image_url: string | null; city: string | null; category: string[] | null }> }),
    artistIds.length && clubId
      ? db.from('club_artists').select('artist_id, category, is_flagged').eq('club_id', clubId).in('artist_id', artistIds)
      : Promise.resolve({ data: [] as Array<{ artist_id: string; category: string[] | null; is_flagged: boolean }> }),
  ])

  const artistById = new Map((artists ?? []).map((artist) => [artist.id, artist]))
  const reviewByArtist = new Map((reviews ?? []).map((review) => [review.artist_id, review]))
  const offerById = new Map(offers.map((offer) => [offer.id, offer]))

  const activeLineup = lineup.filter((spot) => ACTIVE_SPOT_STATUSES.includes(spot.status))
  const bookedArtists = new Set(activeLineup.map((spot) => spot.artist_id))
  const artistsWithOpenOffer = new Set(offers.filter((offer) => offer.status === 'sent').map((offer) => offer.artist_id))
  const showClosed = showStatus === 'completed' || showStatus === 'cancelled'

  const groups = [...requirements]
    .sort((left, right) => left.lineup_position - right.lineup_position)
    .map<SubmissionGroup>((requirement, index) => {
      const filled = activeLineup.filter((spot) => spot.show_requirement_id === requirement.id).length
      const isFull = filled >= requirement.quantity

      const items = (submissions ?? [])
        .filter((row) => row.show_requirement_id === requirement.id)
        // Ubesvarte først, eldste øverst — de har ventet lengst. Deretter de
        // behandlede, sist behandlet øverst.
        .sort((left, right) => {
          const leftOpen = OPEN_STATUSES.includes(left.status)
          const rightOpen = OPEN_STATUSES.includes(right.status)
          if (leftOpen !== rightOpen) return leftOpen ? -1 : 1
          if (leftOpen) return left.created_at.localeCompare(right.created_at)
          return (right.responded_at ?? right.updated_at).localeCompare(left.responded_at ?? left.updated_at)
        })
        .flatMap<SubmissionItem>((row) => {
          const artist = artistById.get(row.artist_id)
          if (!artist) return []

          const review = reviewByArtist.get(row.artist_id)
          const stageName = artist.stage_name?.trim()
          const roles = (review?.category ?? artist.category ?? [])
            .map((role) => formatArtistRole(role))
            .filter((role): role is string => Boolean(role))

          const blocker = !OPEN_STATUSES.includes(row.status)
            ? null
            : showClosed
              ? 'The show is over'
              : bookedArtists.has(row.artist_id)
                ? 'Already in the lineup'
                : isFull
                  ? 'This spot is filled'
                  : artistsWithOpenOffer.has(row.artist_id)
                    ? 'Has an offer waiting'
                    : null

          return [{
            id: row.id,
            status: row.status,
            source: row.source,
            message: row.message?.trim() || null,
            appliedLabel: formatDistanceToNowStrict(new Date(row.created_at), { addSuffix: true }),
            respondedLabel: row.responded_at
              ? formatDistanceToNowStrict(new Date(row.responded_at), { addSuffix: true })
              : null,
            artist: {
              id: artist.id,
              name: stageName || artist.full_name,
              legalName: stageName && stageName !== artist.full_name ? artist.full_name : null,
              imageUrl: artist.profile_image_url,
              details: [artist.city, roles.slice(0, 3).join(', ')].filter((part): part is string => Boolean(part)),
            },
            onRoster: Boolean(review),
            flagged: Boolean(review?.is_flagged),
            offerStatus: row.booking_offer_id ? offerById.get(row.booking_offer_id)?.status ?? null : null,
            blocker,
          }]
        })

      return {
        requirementId: requirement.id,
        position: index + 1,
        roleName: requirement.role_name,
        feeLabel: requirementFeeLabel(requirement, currency || 'NOK'),
        open: Boolean(requirement.submissions_open),
        quantity: requirement.quantity,
        filled,
        items,
      }
    })

  return groups
}
