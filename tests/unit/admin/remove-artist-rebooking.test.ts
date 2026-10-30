import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryDb, type FakeQuery, type FakeTables } from '../booking/fake-query-db'

/**
 * «Remove artist» skal ikke starte en ny runde med tilbud av seg selv
 * (ClickUp 869fn3vwn). Plassen står på pause til bookeren velger «Choose
 * yourself» eller «Auto-book new», og den som ble tatt ut, spørres ikke igjen.
 */

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  startAutoBooking: vi.fn(async () => {}),
  runAutomaticBookingForShow: vi.fn(async () => ({})),
  cancelConfirmedSpotForOffer: vi.fn(async () => ({ removedArtistIds: [] as string[] })),
  sendManualBookingOffer: vi.fn(async () => ({ offerId: 'token', artistName: 'Kari' })),
  runAfterResponse: vi.fn(),
  notifyClubWaitlist: vi.fn(async () => ({ sent: 0 })),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db }))
vi.mock('@/lib/actions/booking', () => ({
  startAutoBooking: mocks.startAutoBooking,
  runAutomaticBookingForShow: mocks.runAutomaticBookingForShow,
  cancelConfirmedSpotForOffer: mocks.cancelConfirmedSpotForOffer,
  sendManualBookingOffer: mocks.sendManualBookingOffer,
  acceptBookingOfferById: vi.fn(),
  automateFullbookedShow: vi.fn(),
}))
vi.mock('@/lib/background', () => ({ runAfterResponse: mocks.runAfterResponse }))
vi.mock('@/lib/waitlist', () => ({ notifyClubWaitlist: mocks.notifyClubWaitlist }))
vi.mock('@/lib/club-auth', () => ({
  assertShowAccess: vi.fn(async () => ({ club_id: 'club-1' })),
  assertSpotAccess: vi.fn(async () => {}),
  assertRequirementAccess: vi.fn(async () => ({ quantity: 1 })),
  assertOfferAccess: vi.fn(async () => {}),
  getDefaultClubIdForAdmin: vi.fn(),
}))
vi.mock('@/lib/club-artists', () => ({ assertArtistBookableForShow: vi.fn(async () => {}) }))
vi.mock('@/lib/artist-reviews', () => ({ savePerformanceReview: vi.fn(), canReviewShow: vi.fn() }))
vi.mock('@/lib/session', () => ({ getAuthUser: vi.fn(async () => null), getSessionProfile: vi.fn() }))
vi.mock('@/lib/lineup-notices', () => ({
  notifyAddedToLineup: vi.fn(),
  notifyOfferWithdrawn: vi.fn(),
  notifyRemovedFromLineup: vi.fn(),
  collectShowCancellationNotice: vi.fn(),
  requirementOccupants: vi.fn(),
  sendShowCancellationNotices: vi.fn(),
}))
vi.mock('@/lib/lineup-messages', () => ({ noteLineupChange: vi.fn() }))
vi.mock('@/lib/booking-engine', () => ({ getLineupQueue: vi.fn(), runBookingWave: vi.fn(), saveLineupQueues: vi.fn() }))
vi.mock('@/lib/actions/shows', () => ({ createShow: vi.fn() }))
vi.mock('@/lib/show-publish', () => ({ publishShow: vi.fn() }))
vi.mock('@/lib/refunds', () => ({ refundShow: vi.fn() }))
vi.mock('@/lib/show-sales', () => ({}))
vi.mock('@/lib/ticket-types-copy', () => ({ copyTicketTypes: vi.fn() }))

const {
  removeSpotAndReopenAction,
  resumeAutoBookingAction,
  sendOfferToArtistAction,
  swapArtistAction,
} = await import('@/app/admin-app/(protected)/shows/actions')

function form(entries: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) fd.set(key, value)
  return fd
}

const bookedSpot = { id: 'spot-1', artist_id: 'removed', show_requirement_id: 'req-1', status: 'confirmed' }

function setup(tables: FakeTables = {}) {
  const { db, queries } = fakeQueryDb({
    confirmed_spots: (query) => (query.write ? {} : { data: bookedSpot }),
    ...tables,
  })
  mocks.db = db
  return queries
}

const writes = (queries: FakeQuery[], table: string, write: FakeQuery['write']) =>
  queries.filter((query) => query.table === table && query.write === write)

/** Jobbene som ville kjørt motoren etter svaret. */
const engineJobs = () =>
  mocks.runAfterResponse.mock.calls.map(([name]) => String(name)).filter((name) => /automation|reopen-spot/.test(name))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('removing a booked comedian', () => {
  it('pauses the spot instead of starting a new offer round', async () => {
    const queries = setup()

    const result = await removeSpotAndReopenAction(form({ show_id: 'show-1', spot_id: 'spot-1' }))

    expect(result).toEqual({ requirementId: 'req-1' })
    expect(mocks.startAutoBooking).not.toHaveBeenCalled()
    expect(mocks.runAutomaticBookingForShow).not.toHaveBeenCalled()
    expect(engineJobs()).toEqual([])

    const [pause] = writes(queries, 'show_requirements', 'update')
    expect(pause.filters).toMatchObject({ id: 'req-1', show_id: 'show-1' })
    expect((pause.values as { rebook_paused_at: string }).rebook_paused_at).toEqual(expect.any(String))
  })

  it('keeps the removed comedian away from the engine for this show', async () => {
    const queries = setup()

    await removeSpotAndReopenAction(form({ show_id: 'show-1', spot_id: 'spot-1' }))

    const [exclusion] = writes(queries, 'show_artist_booking_exclusions', 'upsert')
    expect(exclusion.values).toMatchObject({ show_id: 'show-1', artist_id: 'removed', reason: 'admin_removed_spot' })
  })
})

describe('after the removal, the booker chooses', () => {
  it('«Auto-book new» lifts the pause and restarts the wave on that spot', async () => {
    const queries = setup()

    await resumeAutoBookingAction(form({ show_id: 'show-1', req_id: 'req-1' }))

    const [resume] = writes(queries, 'show_requirements', 'update')
    expect(resume.filters).toMatchObject({ id: 'req-1', show_id: 'show-1' })
    expect(resume.values).toEqual({ rebook_paused_at: null })
    expect(mocks.startAutoBooking).toHaveBeenCalledWith('show-1', 'req-1', { restart: true })
    expect(engineJobs()).toEqual(['show-automation-resume-req-1-show-1'])
  })

  it('«Choose yourself» sends the booker’s own pick and leaves the spot paused', async () => {
    const queries = setup()

    await sendOfferToArtistAction(form({ show_id: 'show-1', artist_id: 'someone-else', show_requirement_id: 'req-1' }))

    expect(mocks.sendManualBookingOffer).toHaveBeenCalledWith('show-1', 'someone-else', 'req-1')
    expect(writes(queries, 'show_requirements', 'update')).toEqual([])
    expect(mocks.startAutoBooking).not.toHaveBeenCalled()
  })

  it('still lets the booker pick the removed comedian by hand, on purpose', async () => {
    const queries = setup()

    await sendOfferToArtistAction(form({ show_id: 'show-1', artist_id: 'removed', show_requirement_id: 'req-1' }))

    const [cleared] = writes(queries, 'show_artist_booking_exclusions', 'delete')
    expect(cleared.filters).toMatchObject({ show_id: 'show-1', artist_id: 'removed' })
    expect(mocks.sendManualBookingOffer).toHaveBeenCalledWith('show-1', 'removed', 'req-1')
  })
})

describe('swapping a comedian out', () => {
  it('keeps the one swapped out from being offered the show again', async () => {
    const queries = setup({
      confirmed_spots: (query) => {
        if (query.write) return {}
        // Første oppslag er plassen som byttes; det andre spør om den nye allerede står i lineupen.
        return query.filters.artist_id ? { data: null } : { data: { ...bookedSpot, fee_amount: null, currency: 'NOK' } }
      },
    })

    await swapArtistAction(form({ show_id: 'show-1', spot_id: 'spot-1', new_artist_id: 'new' }))

    const [exclusion] = writes(queries, 'show_artist_booking_exclusions', 'upsert')
    expect(exclusion.values).toMatchObject({ show_id: 'show-1', artist_id: 'removed', reason: 'admin_swapped_out' })
    const [cleared] = writes(queries, 'show_artist_booking_exclusions', 'delete')
    expect(cleared.filters).toMatchObject({ artist_id: 'new' })
  })
})
