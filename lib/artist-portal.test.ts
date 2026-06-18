import { describe, expect, it } from 'vitest'
import { isArtistBookable, isArtistGloballyApproved } from './artist-portal'

describe('artist portal approval', () => {
  it('treats global approved status as bookable', () => {
    const artist = { status: 'approved' as const, is_flagged: false }
    expect(isArtistGloballyApproved(artist)).toBe(true)
    expect(isArtistBookable(artist)).toBe(true)
  })

  it('does not treat pending status as bookable', () => {
    const artist = { status: 'pending_review' as const, is_flagged: false }
    expect(isArtistGloballyApproved(artist)).toBe(false)
    expect(isArtistBookable(artist)).toBe(false)
  })

  it('rejects flagged artists', () => {
    const artist = { status: 'approved' as const, is_flagged: true }
    expect(isArtistBookable(artist)).toBe(false)
  })
})
