import { describe, expect, it } from 'vitest'
import { isArtistBookable, isArtistGloballyApproved } from './artist-portal'

describe('artist portal approval', () => {
  it('treats global approved status as bookable', () => {
    const artist = { status: 'approved' as const, is_flagged: false, admin_score: 5 }
    expect(isArtistGloballyApproved(artist)).toBe(true)
    expect(isArtistBookable(artist)).toBe(true)
  })

  it('treats high score with pending status as bookable', () => {
    const artist = { status: 'pending_review' as const, is_flagged: false, admin_score: 7 }
    expect(isArtistGloballyApproved(artist)).toBe(false)
    expect(isArtistBookable(artist)).toBe(true)
  })

  it('rejects flagged artists', () => {
    const artist = { status: 'approved' as const, is_flagged: true, admin_score: 8 }
    expect(isArtistBookable(artist)).toBe(false)
  })
})
