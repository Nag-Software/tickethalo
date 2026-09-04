import { normalizeArtistRoleList } from '@/lib/artist-roles'

/**
 * Hva som skal til for at *denne klubben* kan booke komikeren.
 *
 * To ting: komikeren må være godkjent på plattformen (superadmin), og
 * klubben må ha satt minst én rolle på hen — uten rolle matcher hen ingen
 * show-krav (`artistMatchesRole` i lib/artist-roles) og blir usynlig i
 * booking uten at noe sier hvorfor.
 *
 * Score står ikke lenger på lista. Den er systemsatt med en default over
 * terskelen (migrasjon 041), så den kan ikke være grunnen til at noen
 * mangler — og bookeren kan uansett ikke gjøre noe med den.
 */
export const MIN_BOOKABLE_SCORE = 6

/**
 * Scoren en godkjent komiker får uten at noen setter den.
 *
 * Bookeren verken setter eller ser score lenger, men motoren er fortsatt
 * bygget på den — så alle må ha en verdi over terskelen. Ligger den på NULL,
 * leses den som 0 og komikeren får aldri tilbud. Samme tall står som default
 * på kolonnen i migrasjon 041.
 */
export const DEFAULT_ARTIST_SCORE = 7

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
