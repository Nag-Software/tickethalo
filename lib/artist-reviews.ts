import { createAdminClient } from '@/lib/supabase/admin'
import { scoreFromRatings, SCORE_WINDOW } from '@/lib/artist-score'
import { osloEndOfDay } from '@/lib/booking-schedule'
import type { PerformanceRating } from '@/types/database'

type Db = ReturnType<typeof createAdminClient>

/**
 * Vurderingene etter showet, og scoren de gir.
 *
 * Sløyfen er hele poenget med systemet: klubben vurderer kvelden, scoren
 * endrer seg, køen endrer seg, og neste show får en litt bedre lineup. Uten
 * vurderinger står alle på 5,0 og motoren har ingenting å prioritere etter —
 * da er den bare en utsender av e-poster.
 *
 * Vurderingen lagres med klubben som ga den, selv om scoren i dag regnes på
 * tvers av klubber. Den dagen flere klubber deler de samme komikerne, kan
 * scoren regnes per klubb uten at noe må samles inn på nytt.
 */

/** Hvor lenge en vurdering kan endres. Etter det står den. */
export const REVIEW_EDIT_WINDOW_DAYS = 30

export type LineupReviewInput = {
  confirmedSpotId: string
  artistId: string
  showId: string
  clubId: string | null
  rating: PerformanceRating
  notes?: string | null
  reviewedBy?: string | null
}

/**
 * Regner scoren på nytt fra komikerens siste vurderinger, og lagrer den.
 *
 * Kjøres hver gang en vurdering lagres eller endres. Scoren er avledet, ikke
 * ført: den skal aldri kunne bli noe annet enn det vurderingene sier.
 */
export async function recalculateArtistScore(db: Db, artistId: string): Promise<number> {
  const { data, error } = await db
    .from('artist_performance_reviews')
    .select('rating, created_at')
    .eq('artist_id', artistId)
    .order('created_at', { ascending: false })
    .limit(SCORE_WINDOW)

  if (error) throw new Error(error.message)

  const score = scoreFromRatings((data ?? []).map((row) => row.rating as PerformanceRating))
  const { error: updateError } = await db.from('artists').update({ admin_score: score }).eq('id', artistId)
  if (updateError) throw new Error(updateError.message)

  return score
}

/**
 * Lagrer én vurdering, og oppdaterer scoren.
 *
 * Én vurdering per bekreftet plass (unik kolonne i migrasjon 023), så en
 * endring skriver over den forrige i stedet for å legge en ny oppå.
 */
export async function savePerformanceReview(db: Db, input: LineupReviewInput): Promise<number> {
  const { error } = await db
    .from('artist_performance_reviews')
    .upsert({
      confirmed_spot_id: input.confirmedSpotId,
      artist_id: input.artistId,
      show_id: input.showId,
      club_id: input.clubId,
      rating: input.rating,
      notes: input.notes ?? null,
      reviewed_by: input.reviewedBy ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'confirmed_spot_id' })

  if (error) throw new Error(error.message)
  return recalculateArtistScore(db, input.artistId)
}

/** Vurderingene klubben har gitt på ett show, slått opp på plass. */
export async function reviewsForShow(db: Db, showId: string) {
  const { data, error } = await db
    .from('artist_performance_reviews')
    .select('confirmed_spot_id, artist_id, rating, notes, created_at')
    .eq('show_id', showId)

  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((row) => [row.confirmed_spot_id, row]))
}

/** Antall vurderinger per komiker, til «7,5 · 6 vurderinger» i listene. */
export async function reviewCounts(db: Db, artistIds: string[]): Promise<Map<string, number>> {
  if (artistIds.length === 0) return new Map()

  // PostgREST gir høyst 1000 rader uten videre. Tellingen er pynt ved siden
  // av scoren, så et tak her er greit — men det skal stå at det finnes.
  const { data, error } = await db
    .from('artist_performance_reviews')
    .select('artist_id')
    .in('artist_id', artistIds)
    .limit(5000)

  if (error) throw new Error(error.message)

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    counts.set(row.artist_id, (counts.get(row.artist_id) ?? 0) + 1)
  }
  return counts
}

/**
 * Om showet fortsatt kan vurderes.
 *
 * Kvelden må være spilt, og den må ikke ligge for langt tilbake. En kveld
 * ingen husker, blir ikke vurdert riktig — og en score som endrer seg av en
 * vurdering et halvt år etterpå, er vanskelig å forstå.
 */
export function canReviewShow(showDate: string, now: Date = new Date()): boolean {
  // Norsk tid. Regnet i UTC var kvelden «spilt» først 00:59 natten etter,
  // mens varsellisten regnet i Oslo-dager — så i en time hver natt ba
  // listen om en vurdering handlingen nektet å ta imot.
  const played = osloEndOfDay(showDate)
  if (Number.isNaN(played)) return false

  const age = now.getTime() - played
  return age > 0 && age <= REVIEW_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000
}
