import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQueryDb } from './fake-query-db'

vi.mock('@/lib/artist-reviews', () => ({ recalculateClubArtistScore: vi.fn(async () => {}) }))
vi.mock('@/lib/spot-types-data', () => ({
  getClubSpotTypes: vi.fn(async () => [
    { id: 'g', club_id: 'club-1', standard_key: null, name: 'Guest', position: 7, active: true, is_unpaid: false, default_compensation_percent: null },
  ]),
}))

const { ensureClubArtistForApplicant, markApplicationOffered } = await import('@/lib/applicant-offers')
const { recalculateClubArtistScore } = await import('@/lib/artist-reviews')

describe('an applicant who gets an offer', () => {
  beforeEach(() => vi.clearAllMocks())

  it('joins the club with the type of the spot, and the club’s earlier reviews count', async () => {
    const { db, queries } = fakeQueryDb({ club_artists: (query) => (query.write ? {} : { data: null }) })
    const connected = await ensureClubArtistForApplicant(db as never, { clubId: 'club-1', artistId: 'a1', roleName: 'Middle / Feature' })
    expect(connected).toBe(true)
    expect(queries.find((query) => query.write === 'insert')?.values).toEqual({ club_id: 'club-1', artist_id: 'a1', category: ['stand-up'] })
    expect(recalculateClubArtistScore).toHaveBeenCalledWith(db, 'club-1', 'a1')
  })

  it('gets the club’s own type when the spot is one', async () => {
    const { db, queries } = fakeQueryDb({ club_artists: (query) => (query.write ? {} : { data: null }) })
    await ensureClubArtistForApplicant(db as never, { clubId: 'club-1', artistId: 'a1', roleName: 'guest' })
    expect(queries.find((query) => query.write === 'insert')?.values).toMatchObject({ category: ['Guest'] })
  })

  it('leaves a comedian already on the list alone', async () => {
    const { db, queries } = fakeQueryDb({ club_artists: () => ({ data: { artist_id: 'a1' } }) })
    expect(await ensureClubArtistForApplicant(db as never, { clubId: 'club-1', artistId: 'a1', roleName: 'Host / MC' })).toBe(false)
    expect(queries.some((query) => query.write)).toBe(false)
  })

  it('marks only an open application as answered, with the spot and the offer', async () => {
    const { db, queries } = fakeQueryDb({ show_submissions: () => ({}) })
    await markApplicationOffered(db as never, { showId: 's1', artistId: 'a1', requirementId: 'r1', offerId: 'o1' })
    const update = queries.find((query) => query.write === 'update')
    expect(update?.values).toMatchObject({ status: 'accepted', show_requirement_id: 'r1', booking_offer_id: 'o1' })
    expect(update?.filters).toMatchObject({ show_id: 's1', artist_id: 'a1', 'status:in': ['pending', 'shortlisted'] })
  })
})
