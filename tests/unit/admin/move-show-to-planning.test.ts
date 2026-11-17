import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryDb, type FakeQuery, type FakeTables } from '../booking/fake-query-db'

/**
 * Et show i booking skal kunne settes tilbake til planlegging fra Overview.
 * Tilbud som er ute trekkes og komikerne får beskjed; bookede beholder plassen;
 * plassene starter fra dag én når bookingen startes igjen.
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

const { moveShowToPlanningAction } = await import('@/app/admin-app/(protected)/shows/actions')

const lineupNotices = await import('@/lib/lineup-notices')

function form(entries: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) fd.set(key, value)
  return fd
}

function setup(tables: FakeTables) {
  const { db, queries } = fakeQueryDb(tables)
  mocks.db = db
  return queries
}

const writes = (queries: FakeQuery[], table: string) =>
  queries.filter((query) => query.table === table && query.write === 'update')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('back to planning', () => {
  it('moves a booking show to planning, withdraws open offers and resets the wave clock', async () => {
    const queries = setup({
      shows: () => ({ data: [{ id: 'show-1' }] }),
      booking_offers: () => ({ data: [{ artist_id: 'a1' }, { artist_id: 'a2' }] }),
    })

    const result = await moveShowToPlanningAction(form({ show_id: 'show-1' }))

    expect(result).toEqual({ ok: true, withdrawn: 2 })

    const [show] = writes(queries, 'shows')
    expect(show.values).toEqual({ status: 'draft' })
    expect(show.filters).toMatchObject({ id: 'show-1', 'status:in': ['booking', 'fullbooked'] })

    // Bare tilbud som venter på svar — de bookede røres ikke.
    const [offers] = writes(queries, 'booking_offers')
    expect(offers.filters).toMatchObject({ show_id: 'show-1', status: 'sent' })
    expect(offers.values).toMatchObject({ status: 'cancelled' })
    expect(writes(queries, 'confirmed_spots')).toEqual([])

    const [clock] = writes(queries, 'show_requirements')
    expect(clock.values).toEqual({ auto_started_at: null })

    // Komikerne får beskjed etter svaret.
    expect(mocks.runAfterResponse).toHaveBeenCalledTimes(1)
    const [, job] = mocks.runAfterResponse.mock.calls[0] as unknown as [string, () => Promise<void>]
    await job()
    expect(lineupNotices.notifyOfferWithdrawn).toHaveBeenCalledWith('show-1', ['a1', 'a2'])
  })

  it('refuses a show that is not booking, and touches nothing else', async () => {
    const queries = setup({ shows: () => ({ data: [] }) })

    const result = await moveShowToPlanningAction(form({ show_id: 'show-1' }))

    expect(result).toEqual({ ok: false, error: 'Only a show that is booking can go back to planning.' })
    expect(writes(queries, 'booking_offers')).toEqual([])
    expect(writes(queries, 'show_requirements')).toEqual([])
    expect(mocks.runAfterResponse).not.toHaveBeenCalled()
  })
})
