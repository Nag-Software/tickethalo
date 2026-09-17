import { artistMatchesRole } from '@/lib/artist-roles'
import type { ArtistGender, ArtistType, BookingOfferSource, EnergyLevel } from '@/types/database'

/**
 * Reglene bookingmotoren følger, uten databasen.
 *
 * `bookShow` i lib/actions/booking.ts henter radene og skriver tilbudene. Hva
 * som matcher en plass, hvilke ubesvarte tilbud som trekkes, og hvor mange nye
 * en plass kan få, avgjøres her — i en fil som ikke er en server action, og
 * som derfor kan testes for seg.
 */

/** Det motoren vet om en komiker. Rolle og energi er klubbens vurdering. */
export type MatchableArtist = {
  admin_energy_level: EnergyLevel | null
  gender: ArtistGender | null
  category: ArtistType[] | null
}

/** Kravene på en plass som aldri lempes på, heller ikke i fallback. */
export type HardRequirement = {
  role_name: string
  energy_level: string
  required_gender: string
}

export function matchesHardRequirements(artist: MatchableArtist, req: HardRequirement): boolean {
  if (!artistMatchesRole(req.role_name, artist)) return false
  if (req.energy_level !== 'any' && artist.admin_energy_level !== req.energy_level) return false
  if (req.required_gender && req.required_gender !== 'any' && artist.gender !== req.required_gender) return false
  return true
}

export type ExistingOffer = {
  id: string
  artist_id: string
  show_requirement_id: string | null
  status: string
  source: BookingOfferSource
}

/**
 * De ubesvarte tilbudene motoren trekker før den regner ut nye.
 *
 * Alle tilbud trekkes når komikeren er ekskludert fra showet, når hen ikke
 * lenger kan bookes av klubben (ikke på listen, flagget eller ikke godkjent —
 * altså ikke i `bookableArtists`), eller når plassen er borte.
 *
 * Et tilbud motoren sendte, trekkes også når komikeren ikke lenger matcher
 * plassen: bookeren har endret kravene siden. Et tilbud bookeren sendte selv,
 * trekkes ikke av den grunnen. Bookeren valgte komikeren, ofte nettopp på
 * tvers av kategorien, og før denne regelen forsvant tilbudet uten varsel
 * neste gang motoren kjørte.
 */
export function pendingOffersToWithdraw({
  offers,
  bookableArtists,
  requirements,
  excludedArtistIds,
}: {
  offers: ExistingOffer[]
  bookableArtists: ReadonlyMap<string, MatchableArtist>
  requirements: ReadonlyMap<string, HardRequirement>
  excludedArtistIds: ReadonlySet<string>
}): string[] {
  return offers.flatMap((offer) => {
    if (offer.status !== 'sent' || !offer.show_requirement_id) return []
    if (excludedArtistIds.has(offer.artist_id)) return [offer.id]

    const artist = bookableArtists.get(offer.artist_id)
    const requirement = requirements.get(offer.show_requirement_id)
    if (!artist || !requirement) return [offer.id]
    if (offer.source === 'manual') return []

    return matchesHardRequirements(artist, requirement) ? [] : [offer.id]
  })
}

/**
 * Hvor mange nye tilbud motoren kan sende på én plass.
 *
 * Hvert ledige sete skal ha opptil `offersPerSlot` ubesvarte tilbud fra
 * motoren. Et sete der bookeren har sendt et tilbud selv, holdes utenfor så
 * lenge tilbudet venter på svar. Ellers sendte motoren den samme plassen til
 * andre, og den som svarte først, fikk den — ikke den bookeren valgte. Sier
 * komikeren nei, eller tilbudet går ut, tar motoren setet igjen.
 *
 * `slotsNeeded` er setene motoren jobber med, og `currentPendingOffers` er
 * motorens egne ubesvarte tilbud på plassen.
 */
export function offerQuota({
  quantity,
  filled,
  pendingAuto,
  pendingManual,
  offersPerSlot,
}: {
  quantity: number
  filled: number
  pendingAuto: number
  pendingManual: number
  offersPerSlot: number
}) {
  const openSeats = Math.max(0, quantity - filled)
  const slotsNeeded = Math.max(0, openSeats - pendingManual)
  const maxNewOffers = Math.max(0, slotsNeeded * offersPerSlot - pendingAuto)

  return { slotsNeeded, currentPendingOffers: pendingAuto, maxNewOffers }
}
