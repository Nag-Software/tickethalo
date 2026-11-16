import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryDb } from '../booking/fake-query-db'

/**
 * Kortet for resten av plassene (ClickUp «Auto suggest selv om valgt en
 * eller flere spots manuelt»): bare plassene kortet gjelder, startes. Plassen
 * med tilbudet sendt for hånd får ikke et stempel.
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

const { startBookingAction } = await import('@/app/admin-app/(protected)/shows/actions')

type Spot = {
  id: string
  role_name: string
  compensation_type: string | null
  compensation_amount: number | null
  compensation_percent: number | null
  quantity: number
  submissions_open?: boolean
  auto_started_at?: string | null
  rebook_paused_at?: string | null
}

const spots: Spot[] = [
  { id: 'host', role_name: 'Host', compensation_type: 'percent', compensation_amount: null, compensation_percent: 15, quantity: 1 },
  { id: 'closer', role_name: 'Headliner', compensation_type: 'percent', compensation_amount: null, compensation_percent: 15, quantity: 1 },
]

function setup({
  wasDraft = false,
  requirements = spots,
  sentOffers = [] as Array<{ show_requirement_id: string }>,
}: { wasDraft?: boolean; requirements?: Spot[]; sentOffers?: Array<{ show_requirement_id: string }> } = {}) {
  const { db } = fakeQueryDb({
    show_requirements: (query) => {
      const ids = query.filters['id:in'] as string[] | undefined
      return { data: ids ? requirements.filter((req) => ids.includes(req.id)) : requirements }
    },
    shows: (query) => (query.write ? { data: wasDraft ? [{ id: 'show-1' }] : [] } : { data: { club_id: null } }),
    confirmed_spots: () => ({ data: [] }),
    booking_offers: () => ({ data: sentOffers }),
  })
  mocks.db = db
}

function form(entries: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) fd.set(key, value)
  return fd
}

describe('start booking on the remaining spots', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts only the spots the card was for, never the one offered by hand', async () => {
    setup()
    await startBookingAction(form({ show_id: 'show-1', spot_ids: 'closer' }))
    expect(mocks.startAutoBooking).toHaveBeenCalledTimes(1)
    expect(mocks.startAutoBooking).toHaveBeenCalledWith('show-1', 'closer')
  })

  it('ignores a spot id that is not on the show', async () => {
    setup()
    await startBookingAction(form({ show_id: 'show-1', spot_ids: 'closer,someone-elses' }))
    expect(mocks.startAutoBooking).toHaveBeenCalledTimes(1)
    expect(mocks.startAutoBooking).toHaveBeenCalledWith('show-1', 'closer')
  })

  it('skips a chosen spot that was offered by hand after the page loaded', async () => {
    setup({ sentOffers: [{ show_requirement_id: 'closer' }] })
    await startBookingAction(form({ show_id: 'show-1', spot_ids: 'closer' }))
    expect(mocks.startAutoBooking).not.toHaveBeenCalled()
  })

  it('skips a chosen spot that is already running', async () => {
    setup({ requirements: [spots[0], { ...spots[1], auto_started_at: '2026-11-10T10:00:00Z' }] })
    await startBookingAction(form({ show_id: 'show-1', spot_ids: 'closer' }))
    expect(mocks.startAutoBooking).not.toHaveBeenCalled()
  })

  it('starts every spot from a draft, as before', async () => {
    setup({ wasDraft: true })
    await startBookingAction(form({ show_id: 'show-1' }))
    expect(mocks.startAutoBooking).toHaveBeenCalledWith('show-1', undefined, { restart: true })
  })

  it('refuses a fixed fee without an amount', async () => {
    setup({ requirements: [{ ...spots[0], compensation_type: 'fixed', compensation_percent: null }] })
    await expect(startBookingAction(form({ show_id: 'show-1', spot_ids: 'host' }))).rejects.toThrow(/amount or a percentage/)
    expect(mocks.startAutoBooking).not.toHaveBeenCalled()
  })
})
