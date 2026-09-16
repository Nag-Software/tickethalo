import { describe, expect, it } from 'vitest'
import { artistDisplayName, artistInitials } from '@/lib/public-artists'
import { formatMoney, visibleArtistPath } from '@/lib/artist-portal'
import { formatLanguageSummary } from '@/lib/languages'

describe('public comedian identity', () => {
  it('prefers a stage name', () => {
    expect(artistDisplayName({ full_name: 'Ada Nord', stage_name: 'Ada N' })).toBe('Ada N')
  })

  it('falls back to the full name when stage name is null', () => {
    expect(artistDisplayName({ full_name: 'Ada Nord', stage_name: null })).toBe('Ada Nord')
  })

  it.each([
    [{ full_name: 'Ada Nord', stage_name: null }, 'AN'],
    [{ full_name: 'Ada Nord', stage_name: 'The Comedian' }, 'TC'],
    [{ full_name: 'Prince', stage_name: null }, 'P'],
    [{ full_name: 'Ada Beate Cecilie', stage_name: null }, 'AB'],
    [{ full_name: 'åse ødegård', stage_name: null }, 'ÅØ'],
  ] as const)('creates initials for %#', (artist, initials) => {
    expect(artistInitials(artist)).toBe(initials)
  })
})

describe('artist portal presentation', () => {
  it.each([
    ['/artist-app', '/'], ['/artist-app/profile', '/profile'], ['/artist-app/bookings', '/bookings'],
  ] as const)('maps %s to visible path %s', (pathname, expected) => {
    expect(visibleArtistPath(pathname)).toBe(expected)
  })

  it('does not alter an unrelated absolute path', () => {
    expect(visibleArtistPath('/events')).toBe('/events')
  })

  it('formats whole and fractional minor-unit money', () => {
    expect(formatMoney(100_000, 'NOK')).toMatch(/1[\s ]000/)
    expect(formatMoney(14_328, 'NOK')).toMatch(/143,28/)
  })

  it('treats a missing amount as zero', () => {
    expect(formatMoney(null, 'NOK')).toMatch(/0/)
  })

  it('formats languages in catalogue order', () => {
    expect(formatLanguageSummary(['de', 'en', 'no'])).toBe('Norwegian, English, German')
  })
})
