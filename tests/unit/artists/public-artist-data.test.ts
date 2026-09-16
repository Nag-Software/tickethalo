import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPublicArtistById, getPublicArtists, getPublicArtistShows } from '@/lib/public-artists'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

function queryResult(data: unknown) {
  const query = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn(), single: vi.fn(),
    then: (resolve: (value: { data: unknown }) => unknown) => Promise.resolve(resolve({ data })),
  }
  for (const method of ['select', 'eq', 'in', 'order'] as const) query[method].mockReturnValue(query)
  query.single.mockResolvedValue({ data })
  return query
}

describe('public comedian data boundary', () => {
  const createAdmin = vi.mocked(createAdminClient)

  beforeEach(() => vi.clearAllMocks())

  it('lists only approved artists in stable public order', async () => {
    const artists = [{ id: 'a1', full_name: 'Ada', stage_name: null }]
    const query = queryResult(artists)
    createAdmin.mockReturnValue({ from: vi.fn(() => query) } as never)

    await expect(getPublicArtists()).resolves.toEqual(artists)
    expect(query.eq).toHaveBeenCalledWith('status', 'approved')
    expect(query.order).toHaveBeenNthCalledWith(1, 'stage_name', { ascending: true, nullsFirst: false })
    expect(query.order).toHaveBeenNthCalledWith(2, 'full_name', { ascending: true })
  })

  it('does not select internal score or club review fields', async () => {
    const query = queryResult([])
    createAdmin.mockReturnValue({ from: vi.fn(() => query) } as never)
    await getPublicArtists()
    const fields = query.select.mock.calls[0][0] as string
    expect(fields).not.toMatch(/score|energy|review|is_flagged/)
  })

  it('normalizes a null artist list to an empty list', async () => {
    const query = queryResult(null)
    createAdmin.mockReturnValue({ from: vi.fn(() => query) } as never)
    await expect(getPublicArtists()).resolves.toEqual([])
  })

  it('requires both requested ID and approved status on detail lookup', async () => {
    const artist = { id: 'a1', full_name: 'Ada', stage_name: null }
    const query = queryResult(artist)
    createAdmin.mockReturnValue({ from: vi.fn(() => query) } as never)
    await expect(getPublicArtistById('a1')).resolves.toEqual(artist)
    expect(query.eq.mock.calls).toEqual(expect.arrayContaining([['id', 'a1'], ['status', 'approved']]))
  })

  it('returns null when an artist is not publicly available', async () => {
    const query = queryResult(null)
    createAdmin.mockReturnValue({ from: vi.fn(() => query) } as never)
    await expect(getPublicArtistById('private')).resolves.toBeNull()
  })

  it('returns no shows without querying show or requirement tables when there are no spots', async () => {
    const spots = queryResult([])
    const from = vi.fn(() => spots)
    createAdmin.mockReturnValue({ from } as never)
    await expect(getPublicArtistShows('a1')).resolves.toEqual([])
    expect(from).toHaveBeenCalledTimes(1)
    expect(spots.in).toHaveBeenCalledWith('status', ['confirmed', 'completed', 'paid'])
  })

  it('maps a published show to the artist role and deduplicates query IDs', async () => {
    const spots = queryResult([
      { show_id: 's1', show_requirement_id: 'r1' },
      { show_id: 's1', show_requirement_id: 'r1' },
    ])
    const shows = queryResult([{ id: 's1', title: 'Show' }])
    const roles = queryResult([{ id: 'r1', role_name: 'Headliner' }])
    const from = vi.fn((table: string) => ({ confirmed_spots: spots, shows, show_requirements: roles })[table]!)
    createAdmin.mockReturnValue({ from } as never)

    await expect(getPublicArtistShows('a1')).resolves.toEqual([{ id: 's1', title: 'Show', role_name: 'Headliner' }])
    expect(shows.in).toHaveBeenCalledWith('id', ['s1'])
    expect(shows.eq).toHaveBeenCalledWith('status', 'published')
    expect(roles.in).toHaveBeenCalledWith('id', ['r1'])
  })

  it('uses a null role when requirement data is missing', async () => {
    const spots = queryResult([{ show_id: 's1', show_requirement_id: 'r1' }])
    const shows = queryResult([{ id: 's1', title: 'Show' }])
    const roles = queryResult([])
    createAdmin.mockReturnValue({
      from: vi.fn((table: string) => ({ confirmed_spots: spots, shows, show_requirements: roles })[table]!),
    } as never)
    await expect(getPublicArtistShows('a1')).resolves.toEqual([{ id: 's1', title: 'Show', role_name: null }])
  })
})
