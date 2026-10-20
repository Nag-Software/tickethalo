import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryDb, type FakeQuery } from './fake-query-db'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/app-url', () => ({ appPath: (path: string) => `https://tickethalo.test${path}` }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// `redirect` kaster i Next, så koden etter den kjører aldri. Det samme her.
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`)
})
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }))

const getCurrentArtist = vi.fn()
vi.mock('@/lib/artist-portal', () => ({ getCurrentArtist: () => getCurrentArtist() }))

const sendWaitlistSpotOpenEmail = vi.fn<(opts: Record<string, unknown>) => Promise<{ success: boolean }>>(async () => ({ success: true }))
vi.mock('@/lib/email/mailer', () => ({
  sendWaitlistSpotOpenEmail: (opts: Record<string, unknown>) => sendWaitlistSpotOpenEmail(opts),
}))

const { applyForSpotAction } = await import('@/app/artist-app/open-spots/actions')
const { notifyClubWaitlist } = await import('@/lib/waitlist')

beforeEach(() => {
  redirect.mockClear()
  sendWaitlistSpotOpenEmail.mockClear()
})

// ─── Komikeren søker ─────────────────────────────────────────────────────

/** Et show med én plass for to, som allerede er full. */
function fullSpotDb({ duplicate = false } = {}) {
  return fakeQueryDb({
    show_requirements: () => ({
      data: { id: 'req-1', show_id: 'show-1', role_name: 'Opener', quantity: 2, submissions_open: true },
    }),
    artists: () => ({ data: { id: 'artist-1', status: 'approved' } }),
    shows: () => ({
      data: {
        id: 'show-1',
        title: 'Club Night',
        date: '2099-01-01',
        status: 'fullbooked',
        club_id: 'club-1',
        submissions_audience: 'everyone',
        submissions_close_at: null,
      },
    }),
    club_artists: () => ({ data: null }),
    artist_unavailable_dates: () => ({ data: null }),
    confirmed_spots: (query: FakeQuery) => (query.head ? { count: 2 } : { data: null }),
    show_submission_invitations: () => ({ data: null }),
    show_submissions: (query: FakeQuery) => {
      if (query.write === 'insert') {
        return duplicate
          ? { data: null, error: { code: '23505', message: 'duplicate key value' } }
          : { data: { id: 'sub-new' } }
      }
      return { data: { id: 'sub-existing' } }
    },
  })
}

function applyForm() {
  const form = new FormData()
  form.set('requirement_id', 'req-1')
  return form
}

describe('applying for a full spot', () => {
  it('puts the comedian on the waitlist instead of refusing', async () => {
    const { db, queries } = fullSpotDb()
    getCurrentArtist.mockResolvedValue({ artist: { id: 'artist-1' }, db })

    await expect(applyForSpotAction(applyForm())).rejects.toThrow('REDIRECT /artist-app/open-spots/sub-new')

    const insert = queries.find((query) => query.table === 'show_submissions' && query.write === 'insert')
    expect(insert?.values).toEqual({
      show_id: 'show-1',
      show_requirement_id: 'req-1',
      artist_id: 'artist-1',
      source: 'open_call',
      invitation_id: null,
    })
  })

  it('sends a second click to the application that is already there', async () => {
    const { db } = fullSpotDb({ duplicate: true })
    getCurrentArtist.mockResolvedValue({ artist: { id: 'artist-1' }, db })

    await expect(applyForSpotAction(applyForm())).rejects.toThrow('REDIRECT /artist-app/open-spots/sub-existing')
  })
})

// ─── Klubben får høre om ventelisten ─────────────────────────────────────

type NoticeWorld = {
  submissionsOpen?: boolean
  filled?: number
  waiting?: string[]
  status?: string
}

function noticeDb(world: NoticeWorld = {}) {
  return fakeQueryDb({
    show_requirements: () => ({
      data: { id: 'req-1', show_id: 'show-1', role_name: 'Opener', quantity: 2, submissions_open: world.submissionsOpen ?? true },
    }),
    shows: () => ({
      data: {
        id: 'show-1',
        title: 'Club Night',
        date: '2099-01-01',
        status: world.status ?? 'published',
        club_id: 'club-1',
        // Fristen har gått — den gjelder nye søknader, ikke ventelisten.
        submissions_close_at: '2020-01-01T00:00:00Z',
      },
    }),
    confirmed_spots: () => ({ count: world.filled ?? 1 }),
    show_submissions: () => ({ data: (world.waiting ?? ['a-1', 'a-2']).map((artist_id) => ({ artist_id })) }),
    artists: () => ({
      data: [
        { id: 'a-1', full_name: 'Ada Lovelace', stage_name: null },
        { id: 'a-2', full_name: 'Bo Ek', stage_name: 'Bo' },
      ],
    }),
    club_memberships: () => ({ data: [{ profile_id: 'p-1' }, { profile_id: 'p-2' }] }),
    profiles: () => ({
      data: [
        { email: 'booker@club.test', full_name: 'Booker' },
        { email: 'Booker@club.test', full_name: 'Booker again' },
      ],
    }),
  })
}

describe('telling the club about the waitlist', () => {
  it('emails each club member once when a seat opens and people are waiting', async () => {
    const { db } = noticeDb()

    await expect(notifyClubWaitlist('req-1', db)).resolves.toEqual({ sent: 1 })
    expect(sendWaitlistSpotOpenEmail).toHaveBeenCalledTimes(1)
    expect(sendWaitlistSpotOpenEmail).toHaveBeenCalledWith(expect.objectContaining({
      email: expect.stringMatching(/^booker@club\.test$/i),
      role_name: 'Opener',
      waitlist: ['Ada Lovelace', 'Bo'],
      submissions_url: 'https://tickethalo.test/admin-app/shows/show-1?tab=submissions',
    }))
  })

  it('stays quiet while the spot is still full', async () => {
    const { db } = noticeDb({ filled: 2 })
    await expect(notifyClubWaitlist('req-1', db)).resolves.toEqual({ skipped: 'still_full' })
    expect(sendWaitlistSpotOpenEmail).not.toHaveBeenCalled()
  })

  it('stays quiet when nobody is waiting', async () => {
    const { db } = noticeDb({ waiting: [] })
    await expect(notifyClubWaitlist('req-1', db)).resolves.toEqual({ skipped: 'empty' })
    expect(sendWaitlistSpotOpenEmail).not.toHaveBeenCalled()
  })

  // Plasser som ikke er åpne for søknader fyller motoren selv.
  it('leaves spots the engine fills alone', async () => {
    const { db } = noticeDb({ submissionsOpen: false })
    await expect(notifyClubWaitlist('req-1', db)).resolves.toEqual({ skipped: 'not_open' })
    expect(sendWaitlistSpotOpenEmail).not.toHaveBeenCalled()
  })

  it('stays quiet for a show that is over', async () => {
    const { db } = noticeDb({ status: 'completed' })
    await expect(notifyClubWaitlist('req-1', db)).resolves.toEqual({ skipped: 'show_closed' })
  })
})
