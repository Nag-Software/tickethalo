import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryDb } from './fake-query-db'

/**
 * Pausen etter en fjerning (migrasjon 094), sett fra lib/actions/booking.ts:
 * en omstart er bookerens valg om å booke igjen og løfter pausen, og et
 * tilbud bookeren setter til «cancelled» etter at det var godtatt, pauser
 * plassen i stedet for å starte en ny runde.
 */

const mocks = vi.hoisted(() => ({ db: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.db }))
vi.mock('@/lib/email/mailer', () => ({}))
vi.mock('@/lib/booking-settings-store', () => ({ loadBookingSettings: vi.fn() }))
vi.mock('@/lib/club-artists', () => ({ assertArtistBookableForShow: vi.fn() }))
vi.mock('@/lib/booking-seats', () => ({ rollBackIfSeatWasTaken: vi.fn() }))
vi.mock('@/lib/background', () => ({ runAfterResponse: vi.fn() }))
vi.mock('@/lib/waitlist', () => ({ notifyClubWaitlist: vi.fn() }))
vi.mock('@/lib/stripe-connect', () => ({ getClubForShow: vi.fn(), isClubPayoutReady: vi.fn() }))
vi.mock('@/lib/show-publish', () => ({ firstOpenRequirement: vi.fn() }))
vi.mock('@/lib/booking-engine', () => ({
  ENGINE_STATUSES: ['booking', 'fullbooked', 'published'],
  expireStaleOffers: vi.fn(),
  offerDetails: vi.fn(),
  runBookingWave: vi.fn(),
}))

const { cancelConfirmedSpotForOffer, startAutoBooking } = await import('@/lib/actions/booking')

beforeEach(() => vi.clearAllMocks())

describe('startAutoBooking', () => {
  it('lifts the pause when the wave restarts on the spot', async () => {
    const { db, queries } = fakeQueryDb({ shows: () => ({ data: { status: 'booking' } }) })
    mocks.db = db

    await startAutoBooking('show-1', 'req-1', { restart: true })

    const update = queries.find((query) => query.table === 'show_requirements' && query.write === 'update')
    expect(update?.values).toMatchObject({ rebook_paused_at: null, auto_started_at: expect.any(String) })
    expect(update?.filters).toMatchObject({ id: 'req-1', show_id: 'show-1' })
  })

  it('leaves a paused spot alone when Start booking only fills in missing stamps', async () => {
    const { db, queries } = fakeQueryDb({ shows: () => ({ data: { status: 'booking' } }) })
    mocks.db = db

    await startAutoBooking('show-1')

    const update = queries.find((query) => query.table === 'show_requirements' && query.write === 'update')
    expect(update?.values).not.toHaveProperty('rebook_paused_at')
  })
})

describe('cancelling an accepted offer from the status menu', () => {
  it('pauses the spot for the booker instead of restarting the wave', async () => {
    const { db, queries } = fakeQueryDb({
      confirmed_spots: () => ({ data: [{ show_id: 'show-1', show_requirement_id: 'req-1', artist_id: 'removed' }] }),
    })
    mocks.db = db

    const { removedArtistIds } = await cancelConfirmedSpotForOffer('offer-1')

    expect(removedArtistIds).toEqual(['removed'])
    const updates = queries.filter((query) => query.table === 'show_requirements' && query.write === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].filters).toMatchObject({ id: 'req-1' })
    expect(updates[0].values).toEqual({ rebook_paused_at: expect.any(String) })
  })
})
