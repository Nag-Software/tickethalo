import type { PerformanceRating, SkillLevel } from '@/types/database'

export type { SkillLevel }

/**
 * Scoren komikeren bygger opp, kveld for kveld.
 *
 * Scoren ble før satt for hånd, og deretter automatisk til 7 for alle, fordi
 * ingen satte den. Da sa den ingenting. Nå er den snittet av vurderingene
 * klubbene gir etter showet, og det er den eneste veien den endrer seg på.
 *
 * Scoren avgjør først og fremst rekkefølgen i køen — se `candidatePoints`
 * i lib/booking-rules.ts. Den kvalifiserer bare på én måte: bookeren kan sette
 * et minste skill level på en plass (`min_skill_level`), og nivået er avledet
 * av scoren (`skillLevelFromScore`). Uten et slikt krav stenger scoren ingen
 * ute. Det er alltid klubbens egen score som teller, aldri den globale.
 */

/** Hva hver vurdering er verdt på skalaen 0–10. */
const RATING_VALUE: Record<PerformanceRating, number> = {
  weak: 0,
  medium: 5,
  strong: 10,
  no_show: 0,
}

/**
 * Hvor tungt vurderingen teller.
 *
 * At noen ikke dukker opp, er verre for klubben enn at kvelden var svak:
 * da står publikum der, og bookeren må finne noen på en time. Derfor teller
 * den som to kvelder.
 */
const RATING_WEIGHT: Record<PerformanceRating, number> = {
  weak: 1,
  medium: 1,
  strong: 1,
  no_show: 2,
}

export const PERFORMANCE_RATINGS: PerformanceRating[] = ['strong', 'medium', 'weak', 'no_show']

export const RATING_LABELS: Record<PerformanceRating, string> = {
  strong: 'Sterkt',
  medium: 'Middels',
  weak: 'Svakt',
  no_show: 'Avlyste / møtte ikke',
}

/** Scoren en komiker uten vurderinger har. Midt på skalaen. */
export const NEUTRAL_SCORE = 5

/** Hvor mange vurderinger tilbake i tid snittet ser. */
export const SCORE_WINDOW = 10

/**
 * Minste antall kvelder snittet regnes over.
 *
 * Har komikeren færre, fylles resten opp med nøytrale 5. Ellers ville én
 * sterk kveld gitt 10,0 og en plass foran alle andre, og én svak kveld
 * 0,0 og en vei ut som tar fem show å gå tilbake.
 */
export const MIN_RATED_EVENINGS = 3

/**
 * Scoren, regnet ut fra vurderingene. Nyeste først.
 *
 * | Vurderinger            | Score |
 * |------------------------|-------|
 * | Ingen                  | 5,0   |
 * | Sterkt                 | 6,7   |
 * | Sterkt, sterkt         | 8,3   |
 * | Sterkt × 3, så middels | 8,8   |
 * | Sterkt × 5, så avlyste | 7,1   |
 * | Svakt, svakt           | 1,7   |
 */
export function scoreFromRatings(ratings: PerformanceRating[]): number {
  const recent = ratings.slice(0, SCORE_WINDOW)

  const values: number[] = []
  for (const rating of recent) {
    const value = RATING_VALUE[rating]
    const weight = RATING_WEIGHT[rating]
    if (value == null || weight == null) continue
    for (let i = 0; i < weight; i++) values.push(value)
  }

  while (values.length < MIN_RATED_EVENINGS) values.push(NEUTRAL_SCORE)

  const total = values.reduce((sum, value) => sum + value, 0)
  const average = total / values.length

  // Én desimal. Kolonnen er numeric(3,1), så alt annet avrundes likevel —
  // bedre å gjøre det her, der tallet også vises.
  return Math.round(average * 10) / 10
}

/** Scoren som tekst, slik den vises i admin: «7,5». */
export function formatScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(Number(score))) return '–'
  return Number(score).toFixed(1).replace('.', ',')
}

// ─── Skill level ─────────────────────────────────────────────────────────

/**
 * Low, Medium eller High — scoren slik bookeren ser den.
 *
 * Bookerne ville ha et nivå å sette krav etter, men et tall med desimaler er
 * både for presist og for lett å lese som en dom over personen. Nivået
 * avledes av klubbens egen score og settes aldri for hånd: da ville det
 * blitt et felt ingen holdt ved like, slik scoren var før vurderingene.
 */

/**
 * Grensene, ett sted.
 *
 * Under 4 er Low, over 7 er High, og alt imellom — også nøyaktig 4,0 og 7,0 —
 * er Medium. Den som ikke er vurdert ennå (5,0), er Medium. Én sterk kveld
 * (6,7) holder ikke til High; to sterke (8,3) gjør det. To svake (1,7) gir Low.
 */
export const SKILL_THRESHOLDS = { medium: 4, high: 7 } as const

export const SKILL_LEVELS: SkillLevel[] = ['low', 'medium', 'high']

export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

/**
 * Minstekravet på en plass, slik bookeren velger og leser det. «Low or
 * higher» og «Only High» ble lest om hverandre — «higher» og «High» ligner
 * for mye (ClickUp 869fm9avq). «(or better)» sier det samme uten å gjenta ordet.
 */
export const SKILL_REQUIREMENT_LABELS: Record<SkillLevel, string> = {
  low: 'Low (or better)',
  medium: 'Medium (or better)',
  high: 'High',
}

const SKILL_RANK: Record<SkillLevel, number> = { low: 0, medium: 1, high: 2 }

export function skillLevelFromScore(score: number | null | undefined): SkillLevel {
  const value = score == null || !Number.isFinite(Number(score)) ? NEUTRAL_SCORE : Number(score)
  if (value < SKILL_THRESHOLDS.medium) return 'low'
  if (value > SKILL_THRESHOLDS.high) return 'high'
  return 'medium'
}

/**
 * Om scoren holder til plassens minstekrav. Null og `low` slipper alle inn.
 */
export function meetsSkillLevel(score: number | null | undefined, minimum: SkillLevel | null | undefined): boolean {
  if (!minimum || minimum === 'low') return true
  return SKILL_RANK[skillLevelFromScore(score)] >= SKILL_RANK[minimum]
}

export function isSkillLevel(value: unknown): value is SkillLevel {
  return value === 'low' || value === 'medium' || value === 'high'
}

// ─── Global score ────────────────────────────────────────────────────────

/** Én klubbs score for komikeren, og hvor mange vurderinger den bygger på. */
export type ClubScoreSample = { score: number; reviewCount: number }

export type GlobalScore = {
  /** Null = ingen klubb har vurdert komikeren. */
  score: number | null
  reviewCount: number
  clubCount: number
}

/**
 * Komikerens score på tvers av klubbene — bare for superadmin.
 *
 * Bookingen bruker den ikke. Klubbene har ikke samme publikum (se
 * lib/artist-reviews.ts), så et snitt over alle sier noe om komikeren på
 * plattformen, men ingenting om hvem som passer en bestemt klubb.
 *
 * Snittet er vektet med hvor mange vurderinger hver klubb har gitt: en klubb
 * som har sett komikeren tolv ganger, vet mer enn en som har sett hen én
 * gang. Klubber uten vurderinger er ikke med — deres 5,0 er ikke en mening,
 * bare et utgangspunkt.
 */
export function globalScore(clubs: ClubScoreSample[]): GlobalScore {
  const rated = clubs.filter((club) => club.reviewCount > 0 && Number.isFinite(club.score))
  const reviewCount = rated.reduce((sum, club) => sum + club.reviewCount, 0)
  if (reviewCount === 0) return { score: null, reviewCount: 0, clubCount: 0 }

  const weighted = rated.reduce((sum, club) => sum + club.score * club.reviewCount, 0)
  return {
    score: Math.round((weighted / reviewCount) * 10) / 10,
    reviewCount,
    clubCount: rated.length,
  }
}
