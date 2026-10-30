import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryDb } from '../communication/memory-db'

/**
 * ClickUp 869fn3w36: en komiker som blir med via én klubbs invitasjonslenke,
 * skal fortsatt kunne finnes av alle andre klubber i «Discover comedians».
 */

const state = vi.hoisted(() => ({
  clubId: 'club-b',
  tables: {} as Record<string, Array<Record<string, unknown>>>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/admin-app/discover',
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/components/admin/admin-header', () => ({ AdminHeader: () => null }))
vi.mock('@/components/admin/discover-filters', () => ({ DiscoverFilters: () => null }))
vi.mock('@/components/admin/connect-artist-button', () => ({ ConnectArtistButton: () => null }))
vi.mock('@/lib/club-auth', () => ({ getDefaultClubIdForAdmin: async () => state.clubId }))
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn() }))
vi.mock('@/lib/actions/booking', () => ({ runAutomaticBookingForClub: vi.fn() }))
vi.mock('@/lib/artist-reviews', () => ({ recalculateClubArtistScore: vi.fn(async () => undefined) }))
vi.mock('@/lib/supabase/admin', async () => {
  const { memoryDb: create } = await import('../communication/memory-db')
  return { createAdminClient: () => create(state.tables) }
})

const { default: DiscoverPage } = await import('@/app/admin-app/(protected)/discover/page')
const { getOrCreateClubInviteToken, joinClubViaInvite } = await import('@/lib/club-invite')

const comedian = {
  id: 'artist-1',
  full_name: 'Ada Lovelace',
  stage_name: null,
  profile_image_url: null,
  city: 'Oslo',
  country: 'NO',
  category: ['stand-up'],
  bookings: 0,
  status: 'approved',
}

beforeEach(async () => {
  state.tables = {
    clubs: [
      { id: 'club-a', name: 'Latter Oslo', logo_url: null },
      { id: 'club-b', name: 'Stand Up Bergen', logo_url: null },
    ],
    artists: [{ id: 'artist-1', category: ['stand-up'], status: 'approved' }],
    artist_directory: [comedian],
    club_artists: [],
    club_artist_invites: [],
  }
  const db = memoryDb(state.tables) as never
  await joinClubViaInvite(db, 'artist-1', await getOrCreateClubInviteToken(db, 'club-a'))
})

describe('discover after an invite join', () => {
  it('still lists the comedian for every other club', async () => {
    state.clubId = 'club-b'
    const { container } = render(await DiscoverPage({ searchParams: Promise.resolve({}) }))
    expect(container.textContent).toContain('Ada Lovelace')
  })

  it('leaves them out only for the inviting club, which already has them', async () => {
    state.clubId = 'club-a'
    const { container } = render(await DiscoverPage({ searchParams: Promise.resolve({}) }))
    expect(container.textContent).not.toContain('Ada Lovelace')
  })
})
