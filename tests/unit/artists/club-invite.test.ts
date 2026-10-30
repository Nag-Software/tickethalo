// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryDb } from '../communication/memory-db'

/**
 * Klubbens invitasjonslenke. Det som testes er at tokenet ikke kan gjettes og
 * dør når klubben bytter det, at komikeren havner på riktig liste — og bare
 * én gang — både etter registrering og innlogging, at rollene klubben selv
 * har satt aldri overskrives av lenken, og at en død lenke ikke legger
 * komikeren til noe sted.
 */

const booking = vi.hoisted(() => ({ clubs: [] as Array<string | null> }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/background', () => ({
  runAfterResponse: (_label: string, task: () => unknown) => task(),
}))
vi.mock('@/lib/actions/booking', () => ({
  runAutomaticBookingForClub: vi.fn(async (clubId: string | null) => {
    booking.clubs.push(clubId)
  }),
}))
vi.mock('@/lib/artist-reviews', () => ({ recalculateClubArtistScore: vi.fn(async () => undefined) }))

const {
  generateInviteToken,
  getOrCreateClubInviteToken,
  resetClubInviteToken,
  resolveClubInvite,
  joinClubViaInvite,
  countInviteJoins,
  inviteRoles,
} = await import('@/lib/club-invite')

type Tables = Record<string, Array<Record<string, unknown>>>

let tables: Tables
let db: never

beforeEach(() => {
  booking.clubs = []
  tables = {
    clubs: [
      { id: 'club-a', name: 'Latter Oslo', logo_url: null },
      { id: 'club-b', name: 'Stand Up Bergen', logo_url: null },
    ],
    artists: [
      { id: 'artist-1', category: ['headliner', 'host'], status: 'approved' },
      { id: 'artist-2', category: null, status: 'approved' },
    ],
    club_artists: [],
    club_artist_invites: [],
  }
  db = memoryDb(tables) as never
})

describe('invite tokens', () => {
  it('generates long, URL-safe tokens that do not repeat', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateInviteToken))
    expect(tokens.size).toBe(200)
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  it('creates the club token once and returns the same one after that', async () => {
    const first = await getOrCreateClubInviteToken(db, 'club-a')
    const second = await getOrCreateClubInviteToken(db, 'club-a')

    expect(second).toBe(first)
    expect(tables.club_artist_invites).toHaveLength(1)
    expect(await resolveClubInvite(db, first)).toMatchObject({ id: 'club-a', name: 'Latter Oslo' })
  })

  it('gives every club its own link', async () => {
    const a = await getOrCreateClubInviteToken(db, 'club-a')
    const b = await getOrCreateClubInviteToken(db, 'club-b')

    expect(a).not.toBe(b)
    expect((await resolveClubInvite(db, b))?.id).toBe('club-b')
  })

  it('kills the old link when the club resets it', async () => {
    const old = await getOrCreateClubInviteToken(db, 'club-a')
    const fresh = await resetClubInviteToken(db, 'club-a')

    expect(fresh).not.toBe(old)
    expect(await resolveClubInvite(db, old)).toBeNull()
    expect((await resolveClubInvite(db, fresh))?.id).toBe('club-a')
    expect(await getOrCreateClubInviteToken(db, 'club-a')).toBe(fresh)
  })

  it('rejects anything that is not a token without asking the database', async () => {
    const from = vi.spyOn(db as { from: (table: string) => unknown }, 'from')
    expect(await resolveClubInvite(db, 'not-a-token')).toBeNull()
    expect(await resolveClubInvite(db, "x' or 1=1 --")).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })
})

describe('joining via the link', () => {
  it('adds the comedian to the inviting club with their own roles and starts booking there', async () => {
    const token = await getOrCreateClubInviteToken(db, 'club-a')

    const result = await joinClubViaInvite(db, 'artist-1', token)

    expect(result).toMatchObject({ status: 'joined', club: { id: 'club-a' } })
    expect(tables.club_artists).toEqual([
      expect.objectContaining({
        club_id: 'club-a',
        artist_id: 'artist-1',
        category: ['headliner', 'konferansier'],
        joined_via_invite: true,
      }),
    ])
    expect(booking.clubs).toEqual(['club-a'])
  })

  it('falls back to stand-up so a comedian without roles still matches shows', async () => {
    const token = await getOrCreateClubInviteToken(db, 'club-a')
    await joinClubViaInvite(db, 'artist-2', token)

    expect(tables.club_artists[0]).toMatchObject({ artist_id: 'artist-2', category: ['stand-up'] })
    expect(inviteRoles([])).toEqual(['stand-up'])
  })

  it('is idempotent: a second visit adds nothing and does not rerun booking', async () => {
    const token = await getOrCreateClubInviteToken(db, 'club-a')
    await joinClubViaInvite(db, 'artist-1', token)

    const again = await joinClubViaInvite(db, 'artist-1', token)

    expect(again.status).toBe('already')
    expect(tables.club_artists).toHaveLength(1)
    expect(booking.clubs).toEqual(['club-a'])
  })

  it('leaves a comedian the club already picked from Discover untouched', async () => {
    tables.club_artists.push({
      id: 'link-1',
      club_id: 'club-a',
      artist_id: 'artist-1',
      category: ['open mic'],
      joined_via_invite: false,
    })
    const token = await getOrCreateClubInviteToken(db, 'club-a')

    expect((await joinClubViaInvite(db, 'artist-1', token)).status).toBe('already')
    expect(tables.club_artists).toEqual([
      expect.objectContaining({ category: ['open mic'], joined_via_invite: false }),
    ])
    expect(await countInviteJoins(db, 'club-a')).toBe(0)
  })

  it('does nothing for a reset or unknown link', async () => {
    const old = await getOrCreateClubInviteToken(db, 'club-a')
    await resetClubInviteToken(db, 'club-a')

    expect(await joinClubViaInvite(db, 'artist-1', old)).toEqual({ status: 'invalid' })
    expect(await joinClubViaInvite(db, 'artist-1', generateInviteToken())).toEqual({ status: 'invalid' })
    expect(tables.club_artists).toHaveLength(0)
    expect(booking.clubs).toEqual([])
  })

  it('counts only the comedians who came in through the link', async () => {
    const token = await getOrCreateClubInviteToken(db, 'club-a')
    tables.club_artists.push({ id: 'link-0', club_id: 'club-a', artist_id: 'artist-x', joined_via_invite: false })
    await joinClubViaInvite(db, 'artist-1', token)
    await joinClubViaInvite(db, 'artist-2', token)

    expect(await countInviteJoins(db, 'club-a')).toBe(2)
    expect(await countInviteJoins(db, 'club-b')).toBe(0)
  })

  it('never changes the comedian, so their approval and visibility stay as they were', async () => {
    const token = await getOrCreateClubInviteToken(db, 'club-a')
    await joinClubViaInvite(db, 'artist-1', token)

    expect(tables.artists[0]).toEqual({ id: 'artist-1', category: ['headliner', 'host'], status: 'approved' })
  })
})
