// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Kontoen klubben får når superadmin oppretter den. Det som testes er at en
 * ny adresse blir bruker + profil + medlemskap + e-post med passordlenke,
 * at en kjent adresse bare får medlemskap og en innloggingslenke, og at en
 * halvveis registrert Supabase-bruker plukkes opp i stedet for å stoppe alt.
 */

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  profile: null as Row | null,
  inserts: [] as Array<{ table: string; row: Row }>,
  updates: [] as Array<{ table: string; row: Row }>,
  membershipError: null as { code: string; message: string } | null,
  createUserError: null as { message: string } | null,
  emails: [] as Row[],
}))

vi.mock('@/lib/email/mailer', () => ({
  sendClubWelcomeEmail: vi.fn(async (opts: Row) => {
    state.emails.push(opts)
    return { success: true }
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: table === 'profiles' ? state.profile : null, error: null }),
        single: async () => ({ data: { id: 'profile-new' }, error: null }),
        insert(row: Row) {
          state.inserts.push({ table, row })
          const result = table === 'club_memberships' ? { error: state.membershipError } : { error: null }
          return { ...builder, then: (resolve: (value: unknown) => void) => resolve(result) }
        },
        update(row: Row) {
          state.updates.push({ table, row })
          return { eq: async () => ({ error: null }) }
        },
      }
      return builder
    },
    auth: {
      admin: {
        createUser: vi.fn(async () =>
          state.createUserError ? { data: { user: null }, error: state.createUserError } : { data: { user: { id: 'auth-new' } }, error: null },
        ),
        generateLink: vi.fn(async () => ({
          data: { user: { id: 'auth-existing' }, properties: { hashed_token: 'hash123' } },
          error: null,
        })),
      },
    },
  }),
}))

import { provisionClubAdmin, setPasswordUrl } from '@/lib/club-onboarding'

beforeEach(() => {
  state.profile = null
  state.inserts = []
  state.updates = []
  state.membershipError = null
  state.createUserError = null
  state.emails = []
})

describe('setPasswordUrl', () => {
  it('goes through our own callback with the token hash, not through Supabase', () => {
    const url = new URL(setPasswordUrl('abc'))
    expect(url.pathname).toBe('/admin-app/auth/callback')
    expect(url.searchParams.get('token_hash')).toBe('abc')
    expect(url.searchParams.get('type')).toBe('recovery')
    expect(url.searchParams.get('next')).toBe('/admin-app/reset-password')
  })
})

describe('provisionClubAdmin', () => {
  it('creates user, admin profile and membership for a new address, and emails a set-password link', async () => {
    const result = await provisionClubAdmin({ clubId: 'club-1', clubName: 'Copenhagen Comedy Scene', email: ' Club@Example.COM ' })

    expect(result).toMatchObject({ created: true, profileId: 'profile-new', emailSent: true })
    expect(state.inserts).toEqual([
      { table: 'profiles', row: { auth_user_id: 'auth-new', email: 'club@example.com', role: 'admin' } },
      { table: 'club_memberships', row: { club_id: 'club-1', profile_id: 'profile-new' } },
    ])
    expect(state.emails[0]).toMatchObject({ email: 'club@example.com', club_name: 'Copenhagen Comedy Scene' })
    expect(String(state.emails[0].set_password_url)).toContain('token_hash=hash123')
  })

  it('only adds the membership for an existing user and sends a sign-in link instead', async () => {
    state.profile = { id: 'profile-old', role: 'admin' }
    const result = await provisionClubAdmin({ clubId: 'club-1', clubName: 'Crønch', email: 'old@example.com' })

    expect(result).toMatchObject({ created: false, profileId: 'profile-old' })
    expect(state.inserts).toEqual([{ table: 'club_memberships', row: { club_id: 'club-1', profile_id: 'profile-old' } }])
    expect(state.emails[0].set_password_url).toBeNull()
  })

  it('promotes an artist or staff profile to admin, but never touches superadmin', async () => {
    state.profile = { id: 'p', role: 'artist' }
    const result = await provisionClubAdmin({ clubId: 'c', clubName: 'X', email: 'a@b.co' })
    expect(state.updates).toEqual([{ table: 'profiles', row: { role: 'admin' } }])
    // Samme innlogging beholdes, og komikerraden røres ikke: komikeren som
    // blir klubbadmin har begge sidene og får bryteren mellom portalene.
    expect(result).toMatchObject({ created: false, profileId: 'p' })
    expect(state.inserts).toEqual([{ table: 'club_memberships', row: { club_id: 'c', profile_id: 'p' } }])
    expect([...state.inserts, ...state.updates].some(({ table }) => table === 'artists')).toBe(false)

    state.updates = []
    state.profile = { id: 'p', role: 'superadmin' }
    await provisionClubAdmin({ clubId: 'c', clubName: 'X', email: 'a@b.co' })
    expect(state.updates).toEqual([])
  })

  it('treats an existing membership as done, not as a failure', async () => {
    state.profile = { id: 'p', role: 'admin' }
    state.membershipError = { code: '23505', message: 'duplicate key' }
    await expect(provisionClubAdmin({ clubId: 'c', clubName: 'X', email: 'a@b.co' })).resolves.toMatchObject({ created: false })
  })

  it('picks up a Supabase user that exists without a profile instead of stopping', async () => {
    state.createUserError = { message: 'A user with this email address has already been registered' }
    const result = await provisionClubAdmin({ clubId: 'c', clubName: 'X', email: 'half@example.com' })
    expect(result.created).toBe(true)
    expect(state.inserts[0]).toEqual({ table: 'profiles', row: { auth_user_id: 'auth-existing', email: 'half@example.com', role: 'admin' } })
  })

  it('fails loudly when the user cannot be created for another reason', async () => {
    state.createUserError = { message: 'Database error' }
    await expect(provisionClubAdmin({ clubId: 'c', clubName: 'X', email: 'x@example.com' })).rejects.toThrow('Database error')
    expect(state.inserts).toEqual([])
  })
})
