import { describe, expect, it } from 'vitest'
import { artistReadinessBlockers, isArtistBookable } from '@/lib/artist-readiness'
import { artistFactory, resetFactorySequence } from '@/tests/factories/domain'

describe('artist readiness', () => {
  it('accepts an approved artist with a recognized role', () => {
    resetFactorySequence()
    expect(isArtistBookable(artistFactory())).toBe(true)
  })

  it('requires platform approval', () => {
    expect(artistReadinessBlockers(artistFactory({ status: 'pending' }))).toEqual(['approval'])
  })

  it('requires a club role', () => {
    expect(artistReadinessBlockers(artistFactory({ category: [] }))).toEqual(['role'])
  })

  it('returns blockers in the order an admin should resolve them', () => {
    expect(artistReadinessBlockers(artistFactory({ status: 'pending', category: [] }))).toEqual([
      'approval',
      'role',
    ])
  })
})
