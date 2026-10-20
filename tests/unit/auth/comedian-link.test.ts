// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Komikerprofil på klubbinnloggingen. Det som testes er at eierskapet bevises
 * med passord og aldri med en lik e-post, at flyttingen er betinget (to
 * samtidige forsøk flytter ikke profilen to ganger), at den gamle
 * innloggingen sperres og får profilen tilbake ved frakobling, og at en
 * profil laget her får en egen innlogging når den kobles fra.
 */

type Row = Record<string, unknown>

const db = vi.hoisted(() => ({
  artists: [] as Row[],
  profiles: [] as Row[],
  authUsers: new Map<string, { id: string; email: string; banned?: string }>(),
  passwords: new Map<string, { userId: string; password: string }>(),
  failBan: false,
  failNextUpdate: null as { code: string; message: string } | null,
  /** Kjøres rett før en betinget flytting — for å simulere et samtidig forsøk. */
  beforeUpdate: null as null | (() => void),
  emails: [] as Row[],
  signedOut: [] as string[],
  deletedUsers: [] as string[],
  inserted: [] as Row[],
}))

vi.mock('@/lib/session', () => ({ getSessionProfile: vi.fn(), getArtistForAuthUser: vi.fn() }))

vi.mock('@/lib/email/mailer', () => ({
  sendComedianLoginEmail: vi.fn(async (opts: Row) => {
    db.emails.push(opts)
    return { success: true }
  }),
}))

vi.mock('@/lib/artist-profile-insert', () => ({
  insertArtistProfile: vi.fn(async (_admin: unknown, input: { authUserId: string; email: string; profile: Row }) => {
    if (db.artists.some((artist) => artist.auth_user_id === input.authUserId)) {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    }
    const row = { id: `artist-${db.artists.length + 1}`, auth_user_id: input.authUserId, email: input.email, ...input.profile }
    db.artists.push(row)
    db.inserted.push(row)
    return { id: row.id }
  }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: vi.fn(async ({ email, password }: { email: string; password: string }) => {
        const account = db.passwords.get(email)
        const user = account ? db.authUsers.get(account.userId) : null
        if (!account || account.password !== password || !user || user.banned) {
          return { data: { user: null, session: null }, error: { message: 'Invalid login credentials' } }
        }
        return { data: { user: { id: user.id }, session: { access_token: `token-${user.id}` } }, error: null }
      }),
    },
  }),
}))

function table(name: 'artists' | 'profiles') {
  return db[name]
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(name: 'artists' | 'profiles') {
      const filters: Array<[string, unknown]> = []
      let patch: Row | null = null
      const matches = () => table(name).filter((row) => filters.every(([key, value]) => row[key] === value))

      const builder = {
        select: () => builder,
        eq(key: string, value: unknown) {
          filters.push([key, value])
          return builder
        },
        maybeSingle: async () => ({ data: matches()[0] ?? null, error: null }),
        update(row: Row) {
          patch = row
          return {
            eq(key: string, value: unknown) {
              filters.push([key, value])
              return this
            },
            select: async () => {
              db.beforeUpdate?.()
              db.beforeUpdate = null
              if (db.failNextUpdate) {
                const error = db.failNextUpdate
                db.failNextUpdate = null
                return { data: null, error }
              }
              const hits = matches()
              hits.forEach((row) => Object.assign(row, patch))
              return { data: hits.map((row) => ({ id: row.id })), error: null }
            },
          }
        },
        insert: async (row: Row) => {
          table(name).push({ ...row })
          return { error: null }
        },
      }
      return builder
    },
    auth: {
      admin: {
        updateUserById: vi.fn(async (id: string, attributes: { ban_duration: string }) => {
          if (db.failBan) return { error: { message: 'ban failed' } }
          const user = db.authUsers.get(id)
          if (user) user.banned = attributes.ban_duration === 'none' ? undefined : attributes.ban_duration
          return { error: null }
        }),
        signOut: vi.fn(async (token: string) => {
          db.signedOut.push(token)
          return { error: null }
        }),
        getUserById: vi.fn(async (id: string) => ({ data: { user: db.authUsers.get(id) ?? null }, error: null })),
        createUser: vi.fn(async ({ email }: { email: string }) => {
          if ([...db.authUsers.values()].some((user) => user.email === email)) {
            return { data: { user: null }, error: { message: 'A user with this email address has already been registered' } }
          }
          const user = { id: `auth-${email}`, email }
          db.authUsers.set(user.id, user)
          return { data: { user }, error: null }
        }),
        deleteUser: vi.fn(async (id: string) => {
          db.deletedUsers.push(id)
          db.authUsers.delete(id)
          db.profiles = db.profiles.filter((profile) => profile.auth_user_id !== id)
          return { error: null }
        }),
        generateLink: vi.fn(async () => ({ data: { properties: { hashed_token: 'hash123' } }, error: null })),
      },
    },
  }),
}))

import {
  comedianSetPasswordUrl,
  createComedianProfileForUser,
  disconnectComedianProfile,
  linkExistingComedianAccount,
} from '@/lib/comedian-link'

const owner = { authUserId: 'auth-owner', email: 'owner@club.test', role: 'owner' as const }
const coAdmin = { authUserId: 'auth-coadmin', email: 'coadmin@club.test', role: 'admin' as const }

function addLogin(id: string, email: string, password: string, role: string) {
  db.authUsers.set(id, { id, email })
  db.passwords.set(email, { userId: id, password })
  db.profiles.push({ auth_user_id: id, email, role })
}

beforeEach(() => {
  db.artists = []
  db.profiles = []
  db.authUsers = new Map()
  db.passwords = new Map()
  db.failBan = false
  db.failNextUpdate = null
  db.beforeUpdate = null
  db.emails = []
  db.signedOut = []
  db.deletedUsers = []
  db.inserted = []

  addLogin('auth-owner', 'owner@club.test', 'club-pass', 'owner')
  addLogin('auth-coadmin', 'coadmin@club.test', 'co-pass', 'admin')
  addLogin('auth-comic', 'comic@mail.test', 'comic-pass', 'artist')
  db.artists.push({
    id: 'artist-comic',
    auth_user_id: 'auth-comic',
    full_name: 'Kari Komiker',
    stage_name: 'Kari',
    email: 'comic@mail.test',
    linked_from_auth_user_id: null,
  })
})

describe('linkExistingComedianAccount', () => {
  it('moves the profile to the club login, disables the old login and keeps the offer email', async () => {
    const result = await linkExistingComedianAccount(owner, { email: ' Comic@Mail.test ', password: 'comic-pass' })

    expect(result).toEqual({ ok: true, artistId: 'artist-comic' })
    expect(db.artists[0]).toMatchObject({
      auth_user_id: 'auth-owner',
      linked_from_auth_user_id: 'auth-comic',
      email: 'comic@mail.test',
    })
    expect(db.authUsers.get('auth-comic')?.banned).toBeTruthy()
    expect(db.signedOut).toEqual(['token-auth-comic'])
  })

  it('never links on a matching email alone — the password has to be right', async () => {
    const result = await linkExistingComedianAccount(owner, { email: 'comic@mail.test', password: 'wrong' })

    expect(result).toEqual({ ok: false, code: 'invalid_credentials' })
    expect(db.artists[0].auth_user_id).toBe('auth-comic')
  })

  it('is per login: a co-admin of the same club gets nothing from the owner linking', async () => {
    await linkExistingComedianAccount(owner, { email: 'comic@mail.test', password: 'comic-pass' })

    expect(db.artists.filter((artist) => artist.auth_user_id === coAdmin.authUserId)).toEqual([])
  })

  it('refuses a comedian profile that sits on another club login', async () => {
    db.artists[0].auth_user_id = 'auth-coadmin'
    const result = await linkExistingComedianAccount(owner, { email: 'coadmin@club.test', password: 'co-pass' })

    expect(result).toEqual({ ok: false, code: 'linked_to_other_club_login' })
    expect(db.artists[0].auth_user_id).toBe('auth-coadmin')
    expect(db.authUsers.get('auth-coadmin')?.banned).toBeUndefined()
  })

  it('refuses when the club login already has a comedian profile', async () => {
    db.artists.push({ id: 'artist-own', auth_user_id: 'auth-owner', full_name: 'Owner', email: 'owner@club.test' })
    const result = await linkExistingComedianAccount(owner, { email: 'comic@mail.test', password: 'comic-pass' })

    expect(result).toEqual({ ok: false, code: 'already_has_profile' })
    expect(db.artists[0].auth_user_id).toBe('auth-comic')
  })

  it('treats a parallel submit by the same user as done, not as a conflict', async () => {
    db.beforeUpdate = () => {
      db.artists[0].auth_user_id = 'auth-owner'
    }
    const result = await linkExistingComedianAccount(owner, { email: 'comic@mail.test', password: 'comic-pass' })

    expect(result).toEqual({ ok: true, artistId: 'artist-comic' })
    expect(db.authUsers.get('auth-comic')?.banned).toBeUndefined()
  })

  it('reports a conflict when someone else moved the profile in between', async () => {
    db.beforeUpdate = () => {
      db.artists[0].auth_user_id = 'auth-someone-else'
    }
    const result = await linkExistingComedianAccount(owner, { email: 'comic@mail.test', password: 'comic-pass' })

    expect(result).toEqual({ ok: false, code: 'conflict' })
  })

  it('maps the unique index to "already has a profile"', async () => {
    db.failNextUpdate = { code: '23505', message: 'duplicate key' }
    const result = await linkExistingComedianAccount(owner, { email: 'comic@mail.test', password: 'comic-pass' })

    expect(result).toEqual({ ok: false, code: 'already_has_profile' })
  })

  it('moves the profile back when the old login cannot be disabled', async () => {
    db.failBan = true
    const result = await linkExistingComedianAccount(owner, { email: 'comic@mail.test', password: 'comic-pass' })

    expect(result).toEqual({ ok: false, code: 'failed' })
    expect(db.artists[0]).toMatchObject({ auth_user_id: 'auth-comic', linked_from_auth_user_id: null })
  })

  it('is only for club logins', async () => {
    const result = await linkExistingComedianAccount({ ...owner, role: 'superadmin' }, { email: 'comic@mail.test', password: 'comic-pass' })
    expect(result).toEqual({ ok: false, code: 'not_club_login' })
  })
})

describe('disconnectComedianProfile', () => {
  it('gives a linked profile back to the old login and re-enables it', async () => {
    await linkExistingComedianAccount(owner, { email: 'comic@mail.test', password: 'comic-pass' })
    const result = await disconnectComedianProfile(owner)

    expect(result).toEqual({ ok: true, restoredLogin: true, loginEmail: 'comic@mail.test', emailSent: false })
    expect(db.artists[0]).toMatchObject({ auth_user_id: 'auth-comic', linked_from_auth_user_id: null })
    expect(db.authUsers.get('auth-comic')?.banned).toBeUndefined()
  })

  it('creates a separate login for a profile made on the club login, and emails a set-password link', async () => {
    db.artists[0].auth_user_id = 'auth-owner'
    const result = await disconnectComedianProfile(owner, { newEmail: ' Kari@Mail.test ' })

    expect(result).toEqual({ ok: true, restoredLogin: false, loginEmail: 'kari@mail.test', emailSent: true })
    expect(db.artists[0]).toMatchObject({ auth_user_id: 'auth-kari@mail.test', email: 'kari@mail.test' })
    expect(db.profiles).toContainEqual(expect.objectContaining({ auth_user_id: 'auth-kari@mail.test', role: 'artist' }))
    expect(String(db.emails[0].set_password_url)).toContain('token_hash=hash123')
  })

  it('asks for an email that is not the club login, and not one that already has a login', async () => {
    db.artists[0].auth_user_id = 'auth-owner'

    await expect(disconnectComedianProfile(owner)).resolves.toEqual({ ok: false, code: 'email_required' })
    await expect(disconnectComedianProfile(owner, { newEmail: 'OWNER@club.test' })).resolves.toEqual({ ok: false, code: 'email_same_as_login' })
    await expect(disconnectComedianProfile(owner, { newEmail: 'coadmin@club.test' })).resolves.toEqual({ ok: false, code: 'email_taken' })
    expect(db.artists[0].auth_user_id).toBe('auth-owner')
  })

  it('removes the new login again when the profile could not be moved to it', async () => {
    db.artists[0].auth_user_id = 'auth-owner'
    db.beforeUpdate = () => {
      db.artists[0].auth_user_id = 'auth-someone-else'
    }
    const result = await disconnectComedianProfile(owner, { newEmail: 'kari@mail.test' })

    expect(result).toEqual({ ok: false, code: 'conflict' })
    expect(db.deletedUsers).toEqual(['auth-kari@mail.test'])
    expect(db.profiles.some((profile) => profile.auth_user_id === 'auth-kari@mail.test')).toBe(false)
  })

  it('says so when there is nothing to disconnect', async () => {
    await expect(disconnectComedianProfile(owner)).resolves.toEqual({ ok: false, code: 'not_linked' })
  })
})

describe('createComedianProfileForUser', () => {
  it('puts a new comedian profile on the club login', async () => {
    const result = await createComedianProfileForUser(owner, { email: 'offers@club.test', profile: { full_name: 'Ola Eier' } })

    expect(result).toEqual({ ok: true, artistId: 'artist-2' })
    expect(db.inserted[0]).toMatchObject({ auth_user_id: 'auth-owner', email: 'offers@club.test' })
  })

  it('refuses a second profile on the same login', async () => {
    await createComedianProfileForUser(owner, { email: 'offers@club.test', profile: { full_name: 'Ola Eier' } })
    const again = await createComedianProfileForUser(owner, { email: 'offers@club.test', profile: { full_name: 'Ola Eier' } })

    expect(again).toEqual({ ok: false, code: 'already_has_profile' })
  })

  it('is only for club logins', async () => {
    const result = await createComedianProfileForUser({ ...owner, role: 'artist' }, { email: 'x@y.test', profile: { full_name: 'X' } })
    expect(result).toEqual({ ok: false, code: 'not_club_login' })
  })
})

describe('comedianSetPasswordUrl', () => {
  it('goes through the comedian portal callback to its reset-password page', () => {
    const url = new URL(comedianSetPasswordUrl('abc'))
    expect(url.pathname).toBe('/artist-app/auth/callback')
    expect(url.searchParams.get('token_hash')).toBe('abc')
    expect(url.searchParams.get('next')).toBe('/artist-app/reset-password')
  })
})
