import type { PerformanceRating } from '@/types/database'

/**
 * Scoren komikeren bygger opp, kveld for kveld.
 *
 * Scoren ble før satt for hånd, og deretter automatisk til 7 for alle, fordi
 * ingen satte den. Da sa den ingenting. Nå er den snittet av vurderingene
 * klubbene gir etter showet, og det er den eneste veien den endrer seg på.
 *
 * Scoren kvalifiserer ikke. Den avgjør bare rekkefølgen i køen — se
 * `candidatePoints` i lib/booking-rules.ts.
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
