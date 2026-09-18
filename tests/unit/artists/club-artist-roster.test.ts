import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clubArtistRoster } from '@/lib/club-artist-profile'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

function rosterQuery(result: { data: unknown; error?: { message: string } | null }) {
  const query = {
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), or: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ error: null, ...result })),
  }
  for (const method of ['select', 'eq', 'order', 'limit', 'or'] as const) query[method].mockReturnValue(query)
  const db = { from: vi.fn(() => query) }
  return { db: db as never, from: db.from, query }
}

const artist = {
  id: 'a1',
  full_name: 'Ada Lovelace',
  stage_name: null,
  email: 'ada@example.com',
  profile_image_url: null,
  status: 'approved',
  created_at: '2026-05-11T21:28:43.761Z',
}

describe('club comedian roster', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reads the comedians and the club review in one query, newest comedian first', async () => {
    const { db, from, query } = rosterQuery({ data: [] })
    await clubArtistRoster(db, 'club-1')

    expect(from).toHaveBeenCalledTimes(1)
    expect(from).toHaveBeenCalledWith('club_artists')
    expect(query.eq).toHaveBeenCalledWith('club_id', 'club-1')
    expect(query.order).toHaveBeenCalledWith('artists(created_at)', { ascending: false })

    // PostgREST can only order by an embedded column that is also selected.
    const fields = query.select.mock.calls[0][0] as string
    expect(fields).toMatch(/artists!inner\([^)]*\bcreated_at\b[^)]*\)/)
    expect(fields).toMatch(/\bis_flagged\b/)
  })

  it('pairs each comedian with the club review', async () => {
    const { db } = rosterQuery({
      data: [{ artist_id: 'a1', category: ['headliner'], admin_energy_level: 'high', admin_notes: null, is_flagged: null, flag_reason: null, flagged_at: null, score: '8.3', artists: artist }],
    })

    await expect(clubArtistRoster(db, 'club-1')).resolves.toEqual([
      {
        artist,
        review: { category: ['headliner'], admin_energy_level: 'high', admin_notes: null, is_flagged: false, flag_reason: null, flagged_at: null, score: 8.3 },
      },
    ])
  })

  it('does not query without a club', async () => {
    const { db, from } = rosterQuery({ data: [] })
    await expect(clubArtistRoster(db, null)).resolves.toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('searches name, stage name and email on the comedian', async () => {
    const { db, query } = rosterQuery({ data: [] })
    await clubArtistRoster(db, 'club-1', { search: '  soyler ' })

    expect(query.or).toHaveBeenCalledWith(
      'full_name.ilike."%soyler%",stage_name.ilike."%soyler%",email.ilike."%soyler%"',
      { referencedTable: 'artists' },
    )
  })

  it('keeps commas and parentheses as text instead of filter syntax', async () => {
    const { db, query } = rosterQuery({ data: [] })
    await clubArtistRoster(db, 'club-1', { search: 'Tom (Soyler), "T" \\ 100%' })

    const [filter] = query.or.mock.calls[0] as [string]
    expect(filter.startsWith('full_name.ilike."%Tom (Soyler), \\"T\\" \\\\ 100%",')).toBe(true)
  })

  it('does not filter on an empty search', async () => {
    const { db, query } = rosterQuery({ data: [] })
    await clubArtistRoster(db, 'club-1', { search: ' % ' })
    expect(query.or).not.toHaveBeenCalled()
  })

  it('fails loudly instead of showing an empty roster', async () => {
    const { db } = rosterQuery({ data: null, error: { message: 'boom' } })
    await expect(clubArtistRoster(db, 'club-1')).rejects.toThrow('boom')
  })
})
