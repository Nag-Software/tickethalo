import { describe, expect, it } from 'vitest'
import { artistDisplayName, buildMarketingSlots, templateFit, usableSlots } from '@/lib/marketing/slots'

const artists = [
  { id: 'head', full_name: 'Helen Head', stage_name: 'Helen', profile_image_url: '/head.jpg' },
  { id: 'host', full_name: 'Håkon Host', stage_name: null, profile_image_url: '/host.jpg' },
  { id: 'support', full_name: 'Sara Support', stage_name: null, profile_image_url: null },
]

const requirements = [
  { id: 'support-r', role_name: 'Stand-up', quantity: 1, lineup_position: 1 },
  { id: 'head-r', role_name: 'Headliner', quantity: 1, lineup_position: 3 },
  { id: 'host-r', role_name: 'MC', quantity: 1, lineup_position: 2 },
]

const spots = [
  { artist_id: 'support', show_requirement_id: 'support-r', status: 'confirmed' },
  { artist_id: 'head', show_requirement_id: 'head-r', status: 'paid' },
  { artist_id: 'host', show_requirement_id: 'host-r', status: 'completed' },
]

describe('marketing slot matching', () => {
  it('prefers stage name and handles unknown artists', () => {
    expect(artistDisplayName(artists[0])).toBe('Helen')
    expect(artistDisplayName(null)).toBe('Unknown artist')
  })

  it('ranks headliner, host, then stand-up independently of requirement order', () => {
    const result = buildMarketingSlots({ requirements, spots, artists })
    expect(result.map((slot) => slot.artistId)).toEqual(['head', 'host', 'support'])
    expect(result.map((slot) => slot.roleLabel)).toEqual(['Headliner', 'Host', 'Stand-up'])
  })

  it.each(['confirmed', 'completed', 'paid'])('accepts %s spots', (status) => {
    const result = buildMarketingSlots({
      requirements: [requirements[1]],
      spots: [{ artist_id: 'head', show_requirement_id: 'head-r', status }],
      artists,
    })
    expect(result[0].artistId).toBe('head')
  })

  it.each(['cancelled', 'declined', 'sent'])('ignores %s spots', (status) => {
    const result = buildMarketingSlots({
      requirements: [requirements[1]],
      spots: [{ artist_id: 'head', show_requirement_id: 'head-r', status }],
      artists,
    })
    expect(result[0].artistId).toBeNull()
  })

  it('numbers repeated roles', () => {
    const result = buildMarketingSlots({
      requirements: [{ id: 'r1', role_name: 'Stand-up', quantity: 3, lineup_position: 1 }],
      spots: [], artists: [],
    })
    expect(result.map((slot) => slot.roleLabel)).toEqual(['Stand-up 1', 'Stand-up 2', 'Stand-up 3'])
  })

  it('keeps more filled artists than the stale requirement quantity', () => {
    const result = buildMarketingSlots({
      requirements: [{ id: 'r1', role_name: 'Stand-up', quantity: 1, lineup_position: 1 }],
      spots: [
        { artist_id: 'head', show_requirement_id: 'r1', status: 'confirmed' },
        { artist_id: 'host', show_requirement_id: 'r1', status: 'confirmed' },
      ], artists,
    })
    expect(result).toHaveLength(2)
  })

  it('retains an artist whose requirement was deleted', () => {
    const result = buildMarketingSlots({
      requirements: [],
      spots: [{ artist_id: 'head', show_requirement_id: 'deleted', status: 'confirmed' }],
      artists,
    })
    expect(result[0]).toMatchObject({ artistId: 'head', roleLabel: 'Stand-up' })
  })

  it('extends the plan to the selected template slot count', () => {
    const result = buildMarketingSlots({ requirements: [], spots: [], artists: [], templateSlotCount: 4 })
    expect(result.map((slot) => slot.roleLabel)).toEqual(['Slot 1', 'Slot 2', 'Slot 3', 'Slot 4'])
  })

  it('lets a manual artist override automatic matching', () => {
    const [slot] = buildMarketingSlots({
      requirements: [requirements[1]], spots: [spots[1]], artists,
      stored: [{ slot_index: 1, artist_id: 'host', image_url: null }],
    })
    expect(slot).toMatchObject({ artistId: 'host', artistName: 'Håkon Host', isManual: true })
  })

  it('treats a manually empty slot as intentional', () => {
    const [slot] = buildMarketingSlots({
      requirements: [requirements[1]], spots: [spots[1]], artists,
      stored: [{ slot_index: 1, artist_id: null, image_url: null }],
    })
    expect(slot).toMatchObject({ artistId: null, imageUrl: null, isManual: true })
  })

  it('uses a custom slot image ahead of the profile image', () => {
    const [slot] = buildMarketingSlots({
      requirements: [requirements[1]], spots: [spots[1]], artists,
      stored: [{ slot_index: 1, artist_id: 'head', image_url: '/press.jpg' }],
    })
    expect(slot).toMatchObject({ imageUrl: '/press.jpg', profileImageUrl: '/head.jpg', hasCustomImage: true })
  })

  it('filters usable slots to those with both artist and image', () => {
    const result = buildMarketingSlots({ requirements, spots, artists })
    expect(usableSlots(result).map((slot) => slot.artistId)).toEqual(['head', 'host'])
  })
})

describe('marketing template fit', () => {
  it.each([
    [0, 5, 2, 'unknown'],
    [5, 5, 0, 'exact'],
    [6, 5, 1, 'close'],
    [4, 5, 1, 'close'],
    [8, 5, 6, 'off'],
  ] as const)('scores %i slots for %i artists', (slots, lineup, score, tone) => {
    expect(templateFit(slots, lineup)).toMatchObject({ score, tone })
  })

  it('explains whether the close mismatch is empty or overflowing', () => {
    expect(templateFit(6, 5).label).toContain('one stays empty')
    expect(templateFit(4, 5).label).toContain("one artist won't fit")
  })
})
