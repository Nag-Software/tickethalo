import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryDb } from '../booking/fake-query-db'

const mocks = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db }))
vi.mock('@/lib/club-auth', () => ({ assertShowAccess: vi.fn(async () => ({ club_id: 'club-1' })), assertRequirementAccess: vi.fn() }))
vi.mock('@/lib/actions/booking', () => ({ runAutomaticBookingForShow: vi.fn(), sendManualBookingOffer: vi.fn(), startAutoBooking: vi.fn() }))
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn() }))

const { setSuggestFromSubmissionsAction } = await import('@/lib/actions/submissions')
const { assertShowAccess } = await import('@/lib/club-auth')

describe('suggest line-up based on submissions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('saves one setting on the show, after checking access, and sends nothing', async () => {
    const { db, queries } = fakeQueryDb({ shows: () => ({}) })
    mocks.db = db
    await expect(setSuggestFromSubmissionsAction({ showId: 'show-1', enabled: true })).resolves.toEqual({ ok: true })
    expect(assertShowAccess).toHaveBeenCalledWith('show-1')
    const update = queries.find((query) => query.write === 'update')
    expect(update?.values).toEqual({ suggest_from_submissions: true })
    expect(update?.filters).toMatchObject({ id: 'show-1' })
  })

  it('resets the start of spots open for submissions when switched on, so nothing goes out before the booker confirms', async () => {
    const { db, queries } = fakeQueryDb({ shows: () => ({}), show_requirements: () => ({}) })
    mocks.db = db
    await setSuggestFromSubmissionsAction({ showId: 'show-1', enabled: true })
    const reset = queries.find((query) => query.table === 'show_requirements' && query.write === 'update')
    expect(reset?.values).toEqual({ auto_started_at: null })
    expect(reset?.filters).toMatchObject({ show_id: 'show-1', submissions_open: true })
  })

  it('touches no spots when switched off', async () => {
    const { db, queries } = fakeQueryDb({ shows: () => ({}), show_requirements: () => ({}) })
    mocks.db = db
    await setSuggestFromSubmissionsAction({ showId: 'show-1', enabled: false })
    expect(queries.some((query) => query.table === 'show_requirements')).toBe(false)
  })

  it('puts Submissions before Lineup in the show tabs', () => {
    const page = readFileSync('app/admin-app/(protected)/shows/[id]/page.tsx', 'utf8')
    const keys = [...page.matchAll(/\{ key: '(\w+)', label:/g)].map((match) => match[1])
    expect(keys).toEqual(['overview', 'submissions', 'lineup', 'communication', 'marketing', 'tickets'])
  })
})
