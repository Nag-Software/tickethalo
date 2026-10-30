// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryDb } from '../communication/memory-db'

/**
 * Invitasjonslenken gjennom registreringen og innloggingen. Tokenet følger med
 * som `next` til `accept`, og `accept` legger komikeren på listen — enten hen
 * nettopp ble laget eller hadde en konto fra før. En død lenke skal ikke
 * stoppe noen av delene.
 */

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  artistByUser: new Map<string, { id: string }>(),
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  registered: [] as unknown[],
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn() }))
vi.mock('@/lib/actions/booking', () => ({ runAutomaticBookingForClub: vi.fn() }))
vi.mock('@/lib/artist-reviews', () => ({ recalculateClubArtistScore: vi.fn(async () => undefined) }))
vi.mock('@/lib/supabase/admin', async () => {
  const { memoryDb: create } = await import('../communication/memory-db')
  return { createAdminClient: () => create(state.tables) }
})
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      signInWithPassword: async () => {
        state.user = { id: 'auth-1' }
        return { data: { user: state.user }, error: null }
      },
    },
  }),
}))
vi.mock('@/lib/session', () => ({
  getArtistForAuthUser: async (authUserId: string) => state.artistByUser.get(authUserId) ?? null,
}))
vi.mock('@/lib/portal-auth', () => ({
  getPortalDestinationForAuthUser: async (authUserId: string) =>
    state.artistByUser.has(authUserId) ? '/artist-app' : null,
}))
vi.mock('@/lib/artist-signup-form', () => ({
  parseArtistSignupForm: async (form: FormData) => ({
    email: String(form.get('email')),
    password: 'secret-password',
    profile: { full_name: 'New Comedian' },
  }),
  toSignupErrorCode: () => 'failed',
}))
vi.mock('@/lib/actions/artist', () => ({
  registerArtist: vi.fn(async (input: unknown) => {
    state.registered.push(input)
    state.artistByUser.set('auth-1', { id: 'artist-new' })
    state.tables.artists.push({ id: 'artist-new', category: ['open mic'], status: 'approved' })
    return { artistId: 'artist-new' }
  }),
}))

const { getOrCreateClubInviteToken, inviteAcceptPath, resetClubInviteToken } = await import('@/lib/club-invite')
const signup = await import('@/app/artist-app/signup/submit/route')
const login = await import('@/app/artist-app/login/submit/route')
const accept = await import('@/app/artist-app/join/[token]/accept/route')

function post(path: string, fields: Record<string, string>) {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) body.set(key, value)
  return new Request(`http://localhost:3000${path}`, { method: 'POST', body, headers: { host: 'localhost:3000' } })
}

async function follow(location: string | null) {
  const url = new URL(location!)
  const token = url.pathname.split('/')[3]
  return accept.GET(new Request(url, { headers: { host: 'localhost:3000' } }), {
    params: Promise.resolve({ token }),
  })
}

let token: string

beforeEach(async () => {
  state.user = null
  state.registered = []
  state.artistByUser = new Map()
  state.tables = {
    clubs: [{ id: 'club-a', name: 'Latter Oslo', logo_url: null }],
    artists: [{ id: 'artist-old', category: ['headliner'], status: 'approved' }],
    club_artists: [],
    club_artist_invites: [],
  }
  token = await getOrCreateClubInviteToken(memoryDb(state.tables) as never, 'club-a')
})

describe('signing up through the invite link', () => {
  it('sends the new comedian to accept, which puts them on the club roster', async () => {
    const response = await signup.POST(post('/artist-app/signup/submit', { email: 'new@example.com', next: inviteAcceptPath(token) }))

    expect(response.status).toBe(303)
    expect(new URL(response.headers.get('location')!).pathname).toBe(inviteAcceptPath(token))

    const joined = await follow(response.headers.get('location'))
    expect(new URL(joined.headers.get('location')!).pathname).toBe(`/artist-app/join/${token}`)
    expect(state.tables.club_artists).toEqual([
      expect.objectContaining({ club_id: 'club-a', artist_id: 'artist-new', category: ['open mic'], joined_via_invite: true }),
    ])
  })

  it('still creates the account when the link was reset in the meantime', async () => {
    await resetClubInviteToken(memoryDb(state.tables) as never, 'club-a')

    const response = await signup.POST(post('/artist-app/signup/submit', { email: 'new@example.com', next: inviteAcceptPath(token) }))
    const after = await follow(response.headers.get('location'))

    expect(state.registered).toHaveLength(1)
    // Tilbake på lenken, som nå sier at den ikke virker lenger.
    expect(new URL(after.headers.get('location')!).pathname).toBe(`/artist-app/join/${token}`)
    expect(state.tables.club_artists).toHaveLength(0)
  })
})

describe('logging in through the invite link', () => {
  it('adds an existing comedian, and only once however often they come back', async () => {
    state.artistByUser.set('auth-1', { id: 'artist-old' })

    const response = await login.POST(post('/artist-app/login/submit', { email: 'old@example.com', password: 'x', next: inviteAcceptPath(token) }))
    expect(new URL(response.headers.get('location')!).pathname).toBe(inviteAcceptPath(token))

    await follow(response.headers.get('location'))
    await follow(response.headers.get('location'))

    expect(state.tables.club_artists).toEqual([
      expect.objectContaining({ club_id: 'club-a', artist_id: 'artist-old', category: ['headliner'] }),
    ])
  })

  it('adds nobody when accept is opened without a session', async () => {
    const response = await follow(`http://localhost:3000${inviteAcceptPath(token)}`)

    expect(new URL(response.headers.get('location')!).pathname).toBe(`/artist-app/join/${token}`)
    expect(state.tables.club_artists).toHaveLength(0)
  })
})
