import { describe, expect, it, vi } from 'vitest'
import { recalculateClubArtistScore, recalculateGlobalArtistScore, reviewCounts, savePerformanceReview } from '@/lib/artist-reviews'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

type Call = { table: string; method: string; args: unknown[] }

/** En db der hver tabell svarer med sitt eget resultat, og alle kall logges. */
function fakeDb(results: Record<string, { data?: unknown; error?: { message: string } | null }>) {
  const calls: Call[] = []
  const db = {
    from: (table: string) => {
      const query: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(resolve({ data: null, error: null, ...results[table] })),
      }
      for (const method of ['select', 'eq', 'in', 'not', 'order', 'limit', 'update', 'upsert']) {
        query[method] = (...args: unknown[]) => {
          calls.push({ table, method, args })
          return query
        }
      }
      return query
    },
  }
  return { db: db as never, calls }
}

const on = (calls: Call[], table: string, method: string) =>
  calls.filter((call) => call.table === table && call.method === method).map((call) => call.args)

// Klubbene har ikke samme publikum. En svak kveld hos én klubb skal ikke
// flytte komikeren ned i køen hos en annen.
describe('club-scoped comedian score', () => {
  it('counts only the reviews this club has given', async () => {
    const { db, calls } = fakeDb({
      artist_performance_reviews: { data: [{ rating: 'strong' }, { rating: 'strong' }] },
    })

    await expect(recalculateClubArtistScore(db, 'club-1', 'artist-1')).resolves.toBe(8.3)

    expect(on(calls, 'artist_performance_reviews', 'eq')).toEqual([
      ['club_id', 'club-1'],
      ['artist_id', 'artist-1'],
    ])
  })

  it('stores the score on the link between club and comedian, not on the comedian', async () => {
    const { db, calls } = fakeDb({ artist_performance_reviews: { data: [{ rating: 'weak' }, { rating: 'weak' }] } })

    await recalculateClubArtistScore(db, 'club-1', 'artist-1')

    expect(on(calls, 'club_artists', 'update')).toEqual([[{ score: 1.7 }]])
    expect(on(calls, 'club_artists', 'eq')).toEqual([
      ['club_id', 'club-1'],
      ['artist_id', 'artist-1'],
    ])
    expect(calls.some((call) => call.table === 'artists')).toBe(false)
  })

  it('is neutral for a club that has never reviewed the comedian', async () => {
    const { db } = fakeDb({ artist_performance_reviews: { data: [] } })
    await expect(recalculateClubArtistScore(db, 'club-2', 'artist-1')).resolves.toBe(5)
  })

  it('does not touch the database for a show without a club', async () => {
    const { db, calls } = fakeDb({})
    await expect(recalculateClubArtistScore(db, null, 'artist-1')).resolves.toBe(5)
    expect(calls).toEqual([])
  })

  it('counts reviews per club as well', async () => {
    const { db, calls } = fakeDb({
      artist_performance_reviews: { data: [{ artist_id: 'a1' }, { artist_id: 'a1' }, { artist_id: 'a2' }] },
    })

    const counts = await reviewCounts(db, 'club-1', ['a1', 'a2'])

    expect(counts).toEqual(new Map([['a1', 2], ['a2', 1]]))
    expect(on(calls, 'artist_performance_reviews', 'eq')).toEqual([['club_id', 'club-1']])
  })
})

// Den globale scoren er bare for superadmin. Den skal regnes fra alle
// klubbers vurderinger, men aldri skrives til noe bookingen leser.
describe('global comedian score', () => {
  it('weights each club by how many reviews it has given', async () => {
    const { db, calls } = fakeDb({
      artist_performance_reviews: {
        data: [
          { club_id: 'oslo', rating: 'strong' },
          { club_id: 'bergen', rating: 'weak' },
          { club_id: 'oslo', rating: 'strong' },
        ],
      },
    })

    // Oslo: to sterke = 8,3. Bergen: én svak = 3,3. (8,3 × 2 + 3,3 × 1) / 3 = 6,6.
    await expect(recalculateGlobalArtistScore(db, 'artist-1')).resolves.toEqual({
      score: 6.6,
      reviewCount: 3,
      clubCount: 2,
    })

    expect(on(calls, 'artist_performance_reviews', 'eq')).toEqual([['artist_id', 'artist-1']])
    expect(on(calls, 'artist_global_scores', 'upsert')).toEqual([[
      expect.objectContaining({ artist_id: 'artist-1', score: 6.6, review_count: 3, club_count: 2 }),
      { onConflict: 'artist_id' },
    ]])
  })

  it('stores null when no club has reviewed the comedian', async () => {
    const { db, calls } = fakeDb({ artist_performance_reviews: { data: [] } })

    await expect(recalculateGlobalArtistScore(db, 'artist-1')).resolves.toEqual({ score: null, reviewCount: 0, clubCount: 0 })
    expect(on(calls, 'artist_global_scores', 'upsert')[0][0]).toMatchObject({ score: null, review_count: 0, club_count: 0 })
  })

  it('is updated when a review is saved, and never touches the club score table', async () => {
    const { db, calls } = fakeDb({ artist_performance_reviews: { data: [{ club_id: 'club-1', rating: 'strong' }] } })

    await savePerformanceReview(db, {
      confirmedSpotId: 'spot-1',
      artistId: 'artist-1',
      showId: 'show-1',
      clubId: 'club-1',
      rating: 'strong',
    })

    expect(on(calls, 'artist_global_scores', 'upsert')).toHaveLength(1)
    expect(on(calls, 'club_artists', 'update')).toEqual([[{ score: expect.any(Number) }]])
  })
})
