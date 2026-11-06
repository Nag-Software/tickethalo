import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * iOS-scanneren logger inn med Bearer-token i stedet for cookie. Testene
 * låser at tokenet valideres mot Supabase, at bare klubbroller slipper inn,
 * og at cookie-innloggingen fortsatt brukes når headeren mangler.
 */

const mocks = vi.hoisted(() => ({
  headers: new Headers(),
  adminGetUser: vi.fn(),
  cookieGetUser: vi.fn(),
  profile: null as null | { id: string; role: string; full_name: string | null; email: string; clubs: unknown[] },
}))

vi.mock('next/headers', () => ({
  headers: async () => mocks.headers,
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { getUser: mocks.adminGetUser },
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: mocks.profile && { ...mocks.profile, club_memberships: [] },
        }),
      }
      return query
    },
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.cookieGetUser } }),
}))

import { getAuthUser } from '@/lib/session'
import { requireScannerUser, scannerRoute } from '@/lib/scanner-api'

beforeEach(() => {
  mocks.headers = new Headers()
  mocks.adminGetUser.mockReset()
  mocks.cookieGetUser.mockReset().mockResolvedValue({ data: { user: null } })
  mocks.profile = null
})

describe('getAuthUser', () => {
  it('validates a Bearer token against Supabase instead of reading cookies', async () => {
    mocks.headers.set('authorization', 'Bearer token-123')
    mocks.adminGetUser.mockResolvedValue({ data: { user: { id: 'auth-1' } } })

    await expect(getAuthUser()).resolves.toEqual({ id: 'auth-1' })
    expect(mocks.adminGetUser).toHaveBeenCalledWith('token-123')
    expect(mocks.cookieGetUser).not.toHaveBeenCalled()
  })

  it('returns no user for a token Supabase rejects', async () => {
    mocks.headers.set('authorization', 'Bearer revoked')
    mocks.adminGetUser.mockResolvedValue({ data: { user: null } })

    await expect(getAuthUser()).resolves.toBeNull()
  })

  it('falls back to the cookie session without an Authorization header', async () => {
    mocks.cookieGetUser.mockResolvedValue({ data: { user: { id: 'cookie-user' } } })

    await expect(getAuthUser()).resolves.toEqual({ id: 'cookie-user' })
    expect(mocks.adminGetUser).not.toHaveBeenCalled()
  })
})

describe('scanner API access', () => {
  it('answers 401 when nobody is signed in', async () => {
    const response = await scannerRoute(async () => ({ ok: true }))
    expect(response.status).toBe(401)
  })

  it('refuses comedians even with a valid token', async () => {
    mocks.headers.set('authorization', 'Bearer token')
    mocks.adminGetUser.mockResolvedValue({ data: { user: { id: 'auth-artist' } } })
    mocks.profile = { id: 'p1', role: 'artist', full_name: null, email: 'a@example.test', clubs: [] }

    await expect(requireScannerUser()).rejects.toMatchObject({ status: 403 })
  })

  it('lets club staff through', async () => {
    mocks.headers.set('authorization', 'Bearer token')
    mocks.adminGetUser.mockResolvedValue({ data: { user: { id: 'auth-staff' } } })
    mocks.profile = { id: 'p2', role: 'staff', full_name: 'Door', email: 'door@example.test', clubs: [] }

    const response = await scannerRoute(async () => ({ ok: true }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })
})
