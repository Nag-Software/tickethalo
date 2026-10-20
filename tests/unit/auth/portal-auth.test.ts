import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getArtistForAuthUser, getSessionProfile } from '@/lib/session'
import { getPortalAccessForAuthUser, getPortalDestinationForAuthUser } from '@/lib/portal-auth'

vi.mock('@/lib/session', () => ({
  getSessionProfile: vi.fn(),
  getArtistForAuthUser: vi.fn(),
}))

describe('portal routing by authenticated identity', () => {
  const profile = vi.mocked(getSessionProfile)
  const artist = vi.mocked(getArtistForAuthUser)

  beforeEach(() => {
    vi.clearAllMocks()
    artist.mockResolvedValue(null)
  })

  it.each([
    ['superadmin', '/superadmin'],
    ['owner', '/admin-app'],
    ['admin', '/admin-app'],
    ['staff', '/admin-app'],
  ] as const)('routes %s to %s without an artist lookup', async (role, destination) => {
    profile.mockResolvedValue({ id: 'p1', role, clubs: [] } as never)
    await expect(getPortalDestinationForAuthUser('u1')).resolves.toBe(destination)
    expect(artist).not.toHaveBeenCalled()
  })

  it('routes a linked artist to the artist portal', async () => {
    profile.mockResolvedValue({ id: 'p1', role: 'artist', clubs: [] } as never)
    artist.mockResolvedValue({ id: 'a1' } as never)
    await expect(getPortalDestinationForAuthUser('u1')).resolves.toBe('/artist-app')
  })

  it('routes an artist profile missing its artist row back to signup', async () => {
    profile.mockResolvedValue({ id: 'p1', role: 'artist', clubs: [] } as never)
    await expect(getPortalDestinationForAuthUser('u1')).resolves.toBe('/artist-app/signup?error=missing')
  })

  it('recognizes an artist row even when the profile is absent', async () => {
    profile.mockResolvedValue(null)
    artist.mockResolvedValue({ id: 'a1' } as never)
    await expect(getPortalDestinationForAuthUser('u1')).resolves.toBe('/artist-app')
  })

  it('returns null when the user has no portal identity', async () => {
    profile.mockResolvedValue(null)
    await expect(getPortalDestinationForAuthUser('u1')).resolves.toBeNull()
  })
})

describe('a club login that also has a comedian profile', () => {
  const profile = vi.mocked(getSessionProfile)
  const artist = vi.mocked(getArtistForAuthUser)

  beforeEach(() => {
    vi.clearAllMocks()
    profile.mockResolvedValue({ id: 'p1', role: 'owner', clubs: [] } as never)
    artist.mockResolvedValue({ id: 'a1' } as never)
  })

  it('still lands in the club portal by default', async () => {
    await expect(getPortalDestinationForAuthUser('u1')).resolves.toBe('/admin-app')
    await expect(getPortalDestinationForAuthUser('u1', 'club')).resolves.toBe('/admin-app')
  })

  it('lands in the comedian portal when that was the last side used', async () => {
    await expect(getPortalDestinationForAuthUser('u1', 'artist')).resolves.toBe('/artist-app')
  })

  it('falls back to the club portal when the remembered comedian profile is gone', async () => {
    artist.mockResolvedValue(null)
    await expect(getPortalDestinationForAuthUser('u1', 'artist')).resolves.toBe('/admin-app')
  })

  it('may use both portals', async () => {
    await expect(getPortalAccessForAuthUser('u1')).resolves.toEqual({ superadmin: false, club: true, comedian: true })
  })

  it('keeps a club-only login out of the comedian portal', async () => {
    artist.mockResolvedValue(null)
    await expect(getPortalAccessForAuthUser('u1')).resolves.toEqual({ superadmin: false, club: true, comedian: false })
  })

  it('keeps superadmin out of the comedian portal even with a comedian row', async () => {
    profile.mockResolvedValue({ id: 'p1', role: 'superadmin', clubs: [] } as never)
    await expect(getPortalAccessForAuthUser('u1')).resolves.toEqual({ superadmin: true, club: false, comedian: false })
    await expect(getPortalDestinationForAuthUser('u1', 'artist')).resolves.toBe('/superadmin')
  })

  it('gives a plain comedian the comedian portal only', async () => {
    profile.mockResolvedValue({ id: 'p1', role: 'artist', clubs: [] } as never)
    await expect(getPortalAccessForAuthUser('u1')).resolves.toEqual({ superadmin: false, club: false, comedian: true })
  })
})
