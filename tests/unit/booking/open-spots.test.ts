import { describe, expect, it, vi } from 'vitest'
import {
  APPLY_SHOW_STATUSES,
  artistCanApply,
  assertArtistCanApply,
  audienceBlockReason,
  getClubOpenCalls,
  showClosedReason,
  spotAvailability,
  submissionStatusLabel,
} from '@/lib/open-spots'
import { ENGINE_STATUSES } from '@/lib/booking-engine'
import { requirementFeeLabel } from '@/lib/booking-spots'
import { fakeQueryDb, type FakeQuery } from './fake-query-db'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/email/mailer', () => ({}))

const NOW = new Date('2026-10-20T12:00:00Z')
const FUTURE = '2026-11-14'

describe('open spot artist gate', () => {
  it('allows approved artists', () => {
    expect(artistCanApply({ status: 'approved' })).toEqual({ ok: true })
  })

  it('explains that pending profiles are under review', () => {
    expect(artistCanApply({ status: 'pending_review' })).toEqual({
      ok: false,
      reason: 'Your profile is still being reviewed. You can apply as soon as it is approved.',
    })
  })

  it.each(['rejected', 'suspended', 'pending', ''])('rejects unsupported status %j', (status) => {
    expect(artistCanApply({ status })).toEqual({
      ok: false,
      reason: 'Your profile cannot apply for spots right now.',
    })
  })
})

describe('which shows take applications', () => {
  // Et show som er fullbooket eller lagt ut kan miste en komiker. Da skal
  // plassen kunne fylles fra ventelisten, akkurat som motoren fyller sine.
  it('follows the same statuses as the booking engine', () => {
    expect([...APPLY_SHOW_STATUSES]).toEqual([...ENGINE_STATUSES])
  })

  it.each(['booking', 'fullbooked', 'published'])('takes applications while the show is %s', (status) => {
    expect(showClosedReason({ status, date: FUTURE, submissions_close_at: null }, NOW)).toBeNull()
  })

  it.each(['draft', 'completed', 'cancelled'])('is closed while the show is %s', (status) => {
    expect(showClosedReason({ status, date: FUTURE, submissions_close_at: null }, NOW)).toBe(
      'This show is not taking submissions.',
    )
  })

  it('is closed once the show has been', () => {
    expect(showClosedReason({ status: 'published', date: '2026-10-19', submissions_close_at: null }, NOW)).toBe(
      'This show has already been.',
    )
  })

  it('is closed once the deadline has passed, and open until then', () => {
    const show = { status: 'booking', date: FUTURE }
    expect(showClosedReason({ ...show, submissions_close_at: '2026-10-20T11:59:59Z' }, NOW)).toBe(
      'The deadline for this show has passed.',
    )
    expect(showClosedReason({ ...show, submissions_close_at: '2026-10-20T21:59:59Z' }, NOW)).toBeNull()
  })
})

describe('who may apply', () => {
  it('lets anyone apply to a show open to everyone', () => {
    expect(audienceBlockReason({ audience: 'everyone', review: null })).toBeNull()
  })

  it('keeps roster shows to comedians the club works with', () => {
    expect(audienceBlockReason({ audience: 'roster', review: null })).toBe(
      'This show is only open to comedians the club already works with.',
    )
    expect(audienceBlockReason({ audience: 'roster', review: { is_flagged: false } })).toBeNull()
  })

  it('shuts out a flagged comedian whatever the audience', () => {
    expect(audienceBlockReason({ audience: 'everyone', review: { is_flagged: true } })).toBe(
      'You cannot apply for spots at this club.',
    )
  })
})

describe('the waitlist', () => {
  it('is a full spot, not a stored state', () => {
    expect(spotAvailability({ quantity: 3, filled: 0 })).toEqual({ spotsLeft: 3, waitlist: false })
    expect(spotAvailability({ quantity: 3, filled: 2 })).toEqual({ spotsLeft: 1, waitlist: false })
    expect(spotAvailability({ quantity: 3, filled: 3 })).toEqual({ spotsLeft: 0, waitlist: true })
    // Overfylt skjer ikke, men skal ikke gi negative plasser.
    expect(spotAvailability({ quantity: 1, filled: 2 })).toEqual({ spotsLeft: 0, waitlist: true })
  })

  it('tells the comedian they are waiting for a drop-out, not for the club', () => {
    expect(submissionStatusLabel('pending', true)).toBe('You’re on the waitlist')
    expect(submissionStatusLabel('shortlisted', true)).toBe('You’re on the waitlist')
    expect(submissionStatusLabel('pending', false)).toBe('Waiting for the club')
    // En behandlet søknad er ikke venteliste, selv om plassen er full.
    expect(submissionStatusLabel('declined', true)).toBe('Not this time')
  })
})

// ─── Søknaden ────────────────────────────────────────────────────────────

type ApplyWorld = {
  submissionsOpen?: boolean
  status?: string
  audience?: 'roster' | 'everyone'
  review?: { is_flagged: boolean } | null
  filled?: number
  ownSpot?: boolean
  unavailable?: boolean
}

function applyDb(world: ApplyWorld = {}) {
  return fakeQueryDb({
    show_requirements: () => ({
      data: { id: 'req-1', show_id: 'show-1', role_name: 'Opener', quantity: 2, submissions_open: world.submissionsOpen ?? true },
    }),
    artists: () => ({ data: { id: 'artist-1', status: 'approved' } }),
    shows: () => ({
      data: {
        id: 'show-1',
        title: 'Club Night',
        date: '2099-01-01',
        status: world.status ?? 'booking',
        club_id: 'club-1',
        submissions_audience: world.audience ?? 'everyone',
        submissions_close_at: null,
      },
    }),
    club_artists: () => ({ data: world.review ?? null }),
    artist_unavailable_dates: () => ({ data: world.unavailable ? { id: 'u-1' } : null }),
    confirmed_spots: (query: FakeQuery) =>
      query.head
        ? { count: world.filled ?? 0 }
        : { data: world.ownSpot ? { id: 'spot-1' } : null },
  })
}

describe('applying for a spot', () => {
  it('applies normally while there are seats left', async () => {
    const { db } = applyDb({ filled: 1 })
    await expect(assertArtistCanApply(db, 'artist-1', 'req-1')).resolves.toMatchObject({ waitlist: false })
  })

  it('accepts an application for a full spot as the waitlist', async () => {
    const { db } = applyDb({ filled: 2 })
    await expect(assertArtistCanApply(db, 'artist-1', 'req-1')).resolves.toMatchObject({ waitlist: true })
  })

  it('accepts the waitlist on a show that is already published', async () => {
    const { db } = applyDb({ filled: 2, status: 'published' })
    await expect(assertArtistCanApply(db, 'artist-1', 'req-1')).resolves.toMatchObject({ waitlist: true })
  })

  it('refuses a spot the club has not opened', async () => {
    const { db } = applyDb({ submissionsOpen: false })
    await expect(assertArtistCanApply(db, 'artist-1', 'req-1')).rejects.toThrow('This spot is not open for submissions.')
  })

  it('refuses a draft', async () => {
    const { db } = applyDb({ status: 'draft' })
    await expect(assertArtistCanApply(db, 'artist-1', 'req-1')).rejects.toThrow('This show is not taking submissions.')
  })

  it('refuses a roster show to a comedian the club does not know', async () => {
    const { db } = applyDb({ audience: 'roster', review: null })
    await expect(assertArtistCanApply(db, 'artist-1', 'req-1')).rejects.toThrow('only open to comedians the club already works with')
  })

  it('refuses a flagged comedian', async () => {
    const { db } = applyDb({ review: { is_flagged: true } })
    await expect(assertArtistCanApply(db, 'artist-1', 'req-1')).rejects.toThrow('You cannot apply for spots at this club.')
  })

  it('refuses a comedian who is already on the line-up, full or not', async () => {
    const { db } = applyDb({ filled: 2, ownSpot: true })
    await expect(assertArtistCanApply(db, 'artist-1', 'req-1')).rejects.toThrow('You already have a spot on this show.')
  })

  it('refuses a date the comedian marked as unavailable', async () => {
    const { db } = applyDb({ unavailable: true })
    await expect(assertArtistCanApply(db, 'artist-1', 'req-1')).rejects.toThrow('marked that date as unavailable')
  })
})

// ─── Klubbsiden ──────────────────────────────────────────────────────────

function clubDb({ review = null as { is_flagged: boolean } | null } = {}) {
  const show = (id: string, audience: 'roster' | 'everyone', extra: Record<string, unknown> = {}) => ({
    id,
    title: `Show ${id}`,
    description: null,
    date: FUTURE,
    start_time: '20:00:00',
    end_time: null,
    venue_name: 'Backstage',
    venue_address: null,
    currency: 'NOK',
    status: 'booking',
    submissions_audience: audience,
    submissions_close_at: null,
    ...extra,
  })

  return fakeQueryDb({
    shows: () => ({
      data: [
        show('open', 'everyone'),
        show('full', 'everyone', { status: 'fullbooked' }),
        show('roster', 'roster'),
        show('late', 'everyone', { submissions_close_at: '2026-10-01T21:59:59Z' }),
      ],
    }),
    show_requirements: () => ({
      data: [
        { id: 'r-open', show_id: 'open', role_name: 'Opener', quantity: 2, compensation_type: 'fixed', compensation_amount: 50000, compensation_percent: null, lineup_position: 1 },
        { id: 'r-full', show_id: 'full', role_name: 'Headliner', quantity: 1, compensation_type: null, compensation_amount: null, compensation_percent: null, lineup_position: 1 },
        { id: 'r-roster', show_id: 'roster', role_name: 'MC', quantity: 1, compensation_type: null, compensation_amount: null, compensation_percent: null, lineup_position: 1 },
        { id: 'r-late', show_id: 'late', role_name: 'Opener', quantity: 1, compensation_type: null, compensation_amount: null, compensation_percent: null, lineup_position: 1 },
      ],
    }),
    club_artists: () => ({ data: review }),
    confirmed_spots: () => ({ data: [{ show_requirement_id: 'r-full' }, { show_requirement_id: 'r-open' }] }),
  })
}

describe('the club page list', () => {
  it('shows a visitor only the shows open to everyone, full ones as waitlist', async () => {
    const { db } = clubDb()
    const calls = await getClubOpenCalls('club-1', null, { db, now: NOW })

    expect(calls.map((call) => [call.showId, call.waitlistOnly])).toEqual([
      ['open', false],
      ['full', true],
    ])
    expect(calls[0].spots[0]).toMatchObject({ spotsLeft: 1, waitlist: false, feeLabel: requirementFeeLabel({ compensation_type: 'fixed', compensation_amount: 50000, compensation_percent: null }, 'NOK') })
    // «Not set» er bookerens intern-tekst og skal ikke stå offentlig.
    expect(calls[1].spots[0]).toMatchObject({ spotsLeft: 0, waitlist: true, feeLabel: null })
  })

  it('adds the roster shows for a comedian the club works with', async () => {
    const { db } = clubDb({ review: { is_flagged: false } })
    const calls = await getClubOpenCalls('club-1', { artistId: 'artist-1', status: 'approved' }, { db, now: NOW })
    expect(calls.map((call) => call.showId)).toEqual(['open', 'full', 'roster'])
  })

  it('keeps roster shows from a logged-in comedian the club does not know', async () => {
    const { db } = clubDb()
    const calls = await getClubOpenCalls('club-1', { artistId: 'artist-1', status: 'approved' }, { db, now: NOW })
    expect(calls.map((call) => call.showId)).toEqual(['open', 'full'])
  })

  it('shows a flagged comedian nothing to apply for', async () => {
    const { db } = clubDb({ review: { is_flagged: true } })
    await expect(getClubOpenCalls('club-1', { artistId: 'artist-1', status: 'approved' }, { db, now: NOW })).resolves.toEqual([])
  })
})
