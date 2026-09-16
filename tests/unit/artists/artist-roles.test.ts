import { describe, expect, it } from 'vitest'
import {
  artistMatchesRole,
  formatArtistRoleSummary,
  normalizeArtistRole,
  normalizeArtistRoleList,
} from '@/lib/artist-roles'

describe('artist roles', () => {
  it.each([
    ['MC', 'konferansier'],
    ['open_mic', 'open mic'],
    ['supporting', 'stand-up'],
  ] as const)('normalizes %s to %s', (input, expected) => {
    expect(normalizeArtistRole(input)).toBe(expected)
  })

  it('deduplicates aliases while preserving role order', () => {
    expect(normalizeArtistRoleList('MC, host / headliner')).toEqual(['konferansier', 'headliner'])
  })

  it('matches an artist against any canonical category', () => {
    expect(artistMatchesRole('Host', { category: ['stand-up', 'konferansier'] })).toBe(true)
  })

  it('uses a fallback when no known role exists', () => {
    expect(formatArtistRoleSummary('unknown', 'Comedian')).toBe('Comedian')
  })
})
