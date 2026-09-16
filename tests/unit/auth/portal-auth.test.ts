import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getArtistForAuthUser, getSessionProfile } from '@/lib/session'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'

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
