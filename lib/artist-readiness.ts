import { normalizeArtistRoleList } from '@/lib/artist-roles'

/**
 * Hva som skal til for at *denne klubben* kan booke komikeren.
 *
 * To ting: komikeren må være godkjent på plattformen (superadmin), og
 * klubben må ha satt minst én rolle på hen — uten rolle matcher hen ingen
 * show-krav (`artistMatchesRole` i lib/artist-roles) og blir usynlig i
 * booking uten at noe sier hvorfor.
 *
 * Score står ikke på lista, og kan ikke komme til å gjøre det. Den er en
 * prioriteringsindikator, ikke en kvalifikasjon: den avgjør rekkefølgen i
 * køen, aldri hvem som kan stå i den. Se `candidatePoints` i
 * lib/booking-rules.ts.
 */

/**
 * Scoren en komiker starter på, midt på skalaen.
 *
 * Den endrer seg bare gjennom vurderinger etter show — se
 * lib/artist-score.ts. Samme tall står som default på kolonnen i
 * migrasjon 057.
 */
export const DEFAULT_ARTIST_SCORE = 5

export type ArtistReadinessInput = {
  /** Plattformstatus fra `artists`. Settes av superadmin. */
  status?: string | null
  /** Rollene *klubben* har satt (`club_artists.category`), ikke komikerens egne. */
  category?: string | string[] | null
}

export type ReadinessBlocker = 'approval' | 'role'

/** Rekkefølgen er den admin må løse dem i. */
const BLOCKER_ORDER: ReadinessBlocker[] = ['approval', 'role']

export const READINESS_BLOCKER_LABELS: Record<ReadinessBlocker, string> = {
  approval: 'Not approved',
  role: 'No role set for your club',
}

/** Alt som hindrer at komikeren kan bookes. Tom liste = klar. */
export function artistReadinessBlockers(artist: ArtistReadinessInput): ReadinessBlocker[] {
  const blockers = new Set<ReadinessBlocker>()

  if (artist.status !== 'approved') blockers.add('approval')
  if (normalizeArtistRoleList(artist.category).length === 0) blockers.add('role')

  return BLOCKER_ORDER.filter((blocker) => blockers.has(blocker))
}

export function isArtistBookable(artist: ArtistReadinessInput) {
  return artistReadinessBlockers(artist).length === 0
}
