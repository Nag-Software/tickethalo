import { normalizeArtistRoleList } from '@/lib/artist-roles'

/**
 * Hva som skal til for at en komiker kan bookes.
 *
 * Rollen (`category`) settes av klubben i admin, ikke av komikeren selv, så
 * en fersk søknad kommer inn uten rolle og matcher da ingen show-krav
 * (`artistMatchesRole` i lib/artist-roles). Uten et sted som samler disse
 * kravene blir «hvorfor dukker ikke hen opp i booking?» et gjettespill —
 * derfor ligger terskelen og blokkeringene her, og ikke spredt utover.
 */
export const MIN_BOOKABLE_SCORE = 6

export type ArtistReadinessInput = {
  status?: string | null
  admin_score?: number | null
  category?: string | string[] | null
}

export type ReadinessBlocker = 'approval' | 'score' | 'role'

/** Rekkefølgen er den admin må løse dem i. */
const BLOCKER_ORDER: ReadinessBlocker[] = ['approval', 'score', 'role']

export const READINESS_BLOCKER_LABELS: Record<ReadinessBlocker, string> = {
  approval: 'Not approved',
  score: 'Score missing',
  role: 'Role missing',
}

/** Alt som hindrer at komikeren kan bookes. Tom liste = klar. */
export function artistReadinessBlockers(artist: ArtistReadinessInput): ReadinessBlocker[] {
  const blockers = new Set<ReadinessBlocker>()

  if (artist.status !== 'approved') blockers.add('approval')
  if ((artist.admin_score ?? 0) < MIN_BOOKABLE_SCORE) blockers.add('score')
  if (normalizeArtistRoleList(artist.category).length === 0) blockers.add('role')

  return BLOCKER_ORDER.filter((blocker) => blockers.has(blocker))
}

export function isArtistBookable(artist: ArtistReadinessInput) {
  return artistReadinessBlockers(artist).length === 0
}
