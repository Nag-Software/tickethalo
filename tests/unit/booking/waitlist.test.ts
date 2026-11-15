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

const { applyForShowAction } = await import('@/app/artist-app/open-spots/actions')
const { notifyClubWaitlist } = await import('@/lib/waitlist')

beforeEach(() => {
  redirect.mockClear()
  sendWaitlistSpotOpenEmail.mockClear()
})

// ─── Komikeren søker ─────────────────────────────────────────────────────

/** Et show med én åpen plass for to, som allerede er full. */
function fullShowDb({ duplicate = false, existing = null }: { duplicate?: boolean; existing?: { id: string; status: string } | null } = {}) {
  let lookups = 0
  return fakeQueryDb({
    show_requirements: () => ({ data: [{ id: 'req-1', quantity: 2 }] }),
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
    // Komikerens egen plass: ingen. Plassen ellers: to av to.
    confirmed_spots: (query: FakeQuery) => (query.filters.artist_id
      ? { data: null }
      : { data: [{ show_requirement_id: 'req-1' }, { show_requirement_id: 'req-1' }] }),
    show_submission_invitations: () => ({ data: null }),
    show_submissions: (query: FakeQuery) => {
      if (query.write === 'insert') {
        return duplicate
          ? { data: null, error: { code: '23505', message: 'duplicate key value' } }
          : { data: { id: 'sub-new' } }
      }
      if (query.write === 'update') return { data: null, error: null }
      // Første oppslag: finnes det en søknad fra før? Andre: den som kom
      // imellom ved et dobbeltklikk.
      lookups++
      if (lookups === 1) return { data: existing }
      return { data: { id: 'sub-existing' } }
    },
  })
}

function applyForm() {
  const form = new FormData()
  form.set('show_id', 'show-1')
  return form
}

describe('applying for a full show', () => {
  it('puts the comedian on the waitlist instead of refusing', async () => {
    const { db, queries } = fullShowDb()
    getCurrentArtist.mockResolvedValue({ artist: { id: 'artist-1' }, db })

    await expect(applyForShowAction(applyForm())).rejects.toThrow('REDIRECT /artist-app/open-spots/sub-new')

    // Søknaden gjelder showet. Plassen velger klubben når den godkjenner.
    const insert = queries.find((query) => query.table === 'show_submissions' && query.write === 'insert')
    expect(insert?.values).toEqual({
      show_id: 'show-1',
      artist_id: 'artist-1',
      source: 'open_call',
      invitation_id: null,
    })
  })

  it('sends a second click to the application that is already there', async () => {
    const { db } = fullShowDb({ duplicate: true })
    getCurrentArtist.mockResolvedValue({ artist: { id: 'artist-1' }, db })

    await expect(applyForShowAction(applyForm())).rejects.toThrow('REDIRECT /artist-app/open-spots/sub-existing')
  })

  it('reopens a withdrawn application instead of adding a second one', async () => {
    const { db, queries } = fullShowDb({ existing: { id: 'sub-old', status: 'withdrawn' } })
    getCurrentArtist.mockResolvedValue({ artist: { id: 'artist-1' }, db })

    await expect(applyForShowAction(applyForm())).rejects.toThrow('REDIRECT /artist-app/open-spots/sub-old')

    expect(queries.some((query) => query.table === 'show_submissions' && query.write === 'insert')).toBe(false)
    const update = queries.find((query) => query.table === 'show_submissions' && query.write === 'update')
    expect(update?.values).toEqual({ status: 'pending', responded_at: null, show_requirement_id: null })
  })

  it('refuses a show with no open spots', async () => {
    const { db } = fakeQueryDb({
      show_requirements: () => ({ data: [] }),
      artists: () => ({ data: { id: 'artist-1', status: 'approved' } }),
      shows: () => ({
        data: {
          id: 'show-1', title: 'Club Night', date: '2099-01-01', status: 'booking',
          club_id: 'club-1', submissions_audience: 'everyone', submissions_close_at: null,
        },
      }),
    })
    getCurrentArtist.mockResolvedValue({ artist: { id: 'artist-1' }, db })

    await expect(applyForShowAction(applyForm())).rejects.toThrow('This show is not open for submissions.')
  })
})

// ─── Klubben får høre om ventelisten ─────────────────────────────────────

type NoticeWorld = {
  submissionsOpen?: boolean
  filled?: number
  waiting?: string[]
  status?: string
  /** Komikere bookeren har tatt av showet (`show_artist_booking_exclusions`). */
  excluded?: string[]
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
    show_artist_booking_exclusions: () => ({ data: (world.excluded ?? []).map((artist_id) => ({ artist_id })) }),
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

  // Hen som nettopp ble tatt av plassen, kan fortsatt stå med en søknad.
  it('leaves out the comedian the booker just removed from the show', async () => {
    const { db } = noticeDb({ excluded: ['a-1'] })
    await expect(notifyClubWaitlist('req-1', db)).resolves.toEqual({ sent: 1 })
    expect(sendWaitlistSpotOpenEmail).toHaveBeenCalledWith(expect.objectContaining({ waitlist: ['Bo'] }))
  })

  it('stays quiet when the only one waiting is the comedian who was removed', async () => {
    const { db } = noticeDb({ waiting: ['a-1'], excluded: ['a-1'] })
    await expect(notifyClubWaitlist('req-1', db)).resolves.toEqual({ skipped: 'empty' })
    expect(sendWaitlistSpotOpenEmail).not.toHaveBeenCalled()
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
