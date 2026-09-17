import { render, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ArtistsPage from '@/app/admin-app/(protected)/artists/page'
import ArtistDetailPage from '@/app/admin-app/(protected)/artists/[id]/page'
import { clubArtistReview, clubArtistRoster, EMPTY_REVIEW } from '@/lib/club-artist-profile'
import { getClubAccess, getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { createAdminClient } from '@/lib/supabase/admin'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  redirect: vi.fn(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/components/admin/admin-header', () => ({ AdminHeader: () => null }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/club-auth', () => ({ getClubAccess: vi.fn(), getDefaultClubIdForAdmin: vi.fn() }))
vi.mock('@/lib/club-artist-profile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/club-artist-profile')>()),
  clubArtistReview: vi.fn(),
  clubArtistRoster: vi.fn(),
}))

const ID_ADA = '0e174ad9-7ee7-4b4b-979f-30e0a54180e9'
const ID_TOM = '6a468c78-3b98-45d0-9bf7-fdc933411bb6'

function artist(id: string, fullName: string) {
  return { id, full_name: fullName, stage_name: null, email: `${id}@example.com`, profile_image_url: null, status: 'approved' as const, created_at: '2026-05-11T21:28:43.761Z' }
}

describe('club comedian list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDefaultClubIdForAdmin).mockResolvedValue('club-1')
    vi.mocked(createAdminClient).mockReturnValue({} as never)
    vi.mocked(clubArtistRoster).mockResolvedValue([
      { artist: artist(ID_ADA, 'Ada Lovelace'), review: { ...EMPTY_REVIEW, category: ['headliner'] } },
      { artist: artist(ID_TOM, 'Thomas Søyland'), review: { ...EMPTY_REVIEW, category: ['konferansier'] } },
    ])
  })

  it('passes the search to the roster query', async () => {
    await ArtistsPage({ searchParams: Promise.resolve({ q: ' søy ' }) })
    expect(clubArtistRoster).toHaveBeenCalledWith(expect.anything(), 'club-1', { search: 'søy' })
  })

  // Safari gjør ikke `<tr class="relative">` til containing block. Da la hver
  // rads klikkflate seg over hele siden, og hvert klikk åpnet den nederste
  // komikeren. Klikkflatene må festes til cellene.
  it('anchors every row click target to its own cell, not to the row', async () => {
    const { container } = render(await ArtistsPage({ searchParams: Promise.resolve({}) }))
    const rows = [...container.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(2)

    for (const [row, id] of [[rows[0], ID_ADA], [rows[1], ID_TOM]] as const) {
      expect(row.className).not.toMatch(/(^|\s)relative(\s|$)/)

      const links = [...row.querySelectorAll('a')]
      expect(links.length).toBeGreaterThan(1)
      for (const link of links) {
        expect(link.getAttribute('href')).toBe(`/admin-app/artists/${id}`)
        expect(link.closest('td')?.className).toMatch(/(^|\s)relative(\s|$)/)
      }
    }
  })

  it('exposes one link per row to keyboard and screen reader users', async () => {
    const { container } = render(await ArtistsPage({ searchParams: Promise.resolve({}) }))

    for (const row of container.querySelectorAll('tbody tr')) {
      const reachable = [...row.querySelectorAll('a')].filter((link) => link.tabIndex !== -1 && !link.hasAttribute('aria-hidden'))
      expect(reachable).toHaveLength(1)
      expect(within(row as HTMLElement).getByRole('button', { name: /remove .* from your club/i })).toBeInTheDocument()
    }
  })

  it('leaves the remove cell without a click target for the profile', async () => {
    const { container } = render(await ArtistsPage({ searchParams: Promise.resolve({}) }))
    for (const row of container.querySelectorAll('tbody tr')) {
      expect(row.querySelector('td:last-child a')).toBeNull()
    }
  })
})

describe('club comedian profile', () => {
  const artistQuery = (data: unknown) => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    return query
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getClubAccess).mockResolvedValue({ isSuperadmin: false, clubIds: ['club-1'], selectedClubId: 'club-1', clubs: [] })
  })

  it('answers 404 for an invalid ID without touching the database', async () => {
    await expect(ArtistDetailPage({ params: Promise.resolve({ id: 'not-a-uuid' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('loads the comedian while the club is still being resolved, without a separate connection lookup', async () => {
    const query = artistQuery(artist(ID_TOM, 'Thomas Søyland'))
    const db = { from: vi.fn(() => query) }
    vi.mocked(createAdminClient).mockReturnValue(db as never)
    vi.mocked(clubArtistReview).mockResolvedValue(null)

    let resolveClub!: (clubId: string) => void
    vi.mocked(getDefaultClubIdForAdmin).mockReturnValue(new Promise((resolve) => (resolveClub = resolve)))

    const page = ArtistDetailPage({ params: Promise.resolve({ id: ID_TOM }) })
    await vi.waitFor(() => expect(db.from).toHaveBeenCalledWith('artists'))
    expect(query.eq).toHaveBeenCalledWith('id', ID_TOM)
    expect(clubArtistReview).not.toHaveBeenCalled()

    resolveClub('club-1')
    await page

    expect(clubArtistReview).toHaveBeenCalledWith(db, 'club-1', ID_TOM)
    expect(db.from).toHaveBeenCalledTimes(1)
  })

  it('answers 404 when the comedian does not exist', async () => {
    vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => artistQuery(null)) } as never)
    vi.mocked(getDefaultClubIdForAdmin).mockResolvedValue('club-1')
    vi.mocked(clubArtistReview).mockResolvedValue(null)

    await expect(ArtistDetailPage({ params: Promise.resolve({ id: ID_ADA }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
