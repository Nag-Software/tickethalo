import { describe, expect, it, vi } from 'vitest'
import { recalculateClubArtistScore, reviewCounts } from '@/lib/artist-reviews'

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
      for (const method of ['select', 'eq', 'in', 'order', 'limit', 'update']) {
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
