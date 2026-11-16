import { describe, expect, it } from 'vitest'
import {
  artistMatchesRole,
  canonicalRoleLabel,
  clubRoleValues,
  normalizeArtistRole,
  normalizeArtistRoleList,
} from '@/lib/artist-roles'
import {
  bookAsOptions,
  sameSpotType,
  spotTypeForRole,
  spotTypeMenuOptions,
  unpaidNoteForRole,
  unpaidSpotNote,
  type ClubSpotType,
} from '@/lib/spot-types'
import { offerDetails } from '@/lib/booking-engine'
import { bookingOfferTemplate, offerReminderTemplate, spotAvailableTemplate } from '@/lib/email/templates'

const type = (extra: Partial<ClubSpotType>): ClubSpotType => ({
  id: extra.name ?? 'id',
  club_id: 'club-1',
  standard_key: null,
  name: 'Type',
  position: 1,
  active: true,
  is_unpaid: false,
  default_compensation_percent: null,
  ...extra,
})

describe('the six standard spot types', () => {
  it.each([
    ['Host / MC', 'konferansier'],
    ['Opener / Bullet', 'opener'],
    ['Middle / Feature', 'stand-up'],
    ['Showcase Spot', 'showcase'],
    ['Open Spot', 'open mic'],
    ['Closer / Headliner', 'headliner'],
    ['host/mc', 'konferansier'],
    ['Bullet', 'opener'],
    ['Feature', 'stand-up'],
    ['Closer', 'headliner'],
  ] as const)('reads %s as %s', (input, key) => {
    expect(normalizeArtistRole(input)).toBe(key)
  })

  it('still reads the old spot names, so shows already running keep matching', () => {
    expect(normalizeArtistRole('Host')).toBe('konferansier')
    expect(normalizeArtistRole('Headliner')).toBe('headliner')
    expect(normalizeArtistRole('Stand-up')).toBe('stand-up')
    expect(normalizeArtistRole('Open Mic')).toBe('open mic')
  })

  it('does not treat an opener as a middle any more — the opener is only the first act', () => {
    expect(artistMatchesRole('Opener / Bullet', { category: ['stand-up'] })).toBe(false)
    expect(artistMatchesRole('Middle / Feature', { category: ['stand-up'] })).toBe(true)
    expect(artistMatchesRole('Stand-up', { category: ['stand-up'] })).toBe(true)
  })

  it('does not merge two different types written with a slash', () => {
    expect(normalizeArtistRole('host / headliner')).toBeNull()
    expect(normalizeArtistRoleList('host / headliner')).toEqual(['konferansier', 'headliner'])
  })

  it('keeps the old names when a spot is saved again, and tidies free text', () => {
    expect(canonicalRoleLabel('Stand-up')).toBe('Stand-up')
    expect(canonicalRoleLabel('host')).toBe('Host')
    expect(canonicalRoleLabel('mc')).toBe('Host / MC')
    expect(canonicalRoleLabel('Improv')).toBe('Improv')
  })
})

describe('club spot types', () => {
  const types = [
    type({ standard_key: 'open mic', name: 'Open Spot', is_unpaid: true }),
    type({ standard_key: 'headliner', name: 'Closer / Headliner', position: 2 }),
    type({ name: 'Improv', position: 3 }),
    type({ name: 'Guest', position: 4, is_unpaid: true }),
    type({ standard_key: 'showcase', name: 'Showcase Spot', position: 5, active: false }),
  ]

  it('stores a custom type by its name and matches spots on it', () => {
    expect(clubRoleValues(['improv', 'headliner', 'Nope'], ['Improv'])).toEqual(['Improv', 'headliner'])
    expect(artistMatchesRole('Improv', { category: ['Improv'] })).toBe(true)
    expect(artistMatchesRole('improv', { category: ['Improv'] })).toBe(true)
    expect(artistMatchesRole('Improv', { category: ['stand-up'] })).toBe(false)
  })

  it('finds the type of a spot, old names included', () => {
    expect(spotTypeForRole(types, 'Headliner')?.name).toBe('Closer / Headliner')
    expect(spotTypeForRole(types, 'Open Mic')?.name).toBe('Open Spot')
    expect(spotTypeForRole(types, 'improv')?.name).toBe('Improv')
    expect(spotTypeForRole(types, 'Unknown')).toBeNull()
  })

  it('says a spot is unpaid when its type is, with Tom’s wording for Open Spot', () => {
    expect(unpaidNoteForRole(types, 'Open Spot')).toBe(
      'We’d love to have you on the lineup for an Open Spot. Just so there are no surprises, all Open Spots are unpaid sets.',
    )
    expect(unpaidNoteForRole(types, 'Guest')).toBe(unpaidSpotNote('Guest'))
    expect(unpaidNoteForRole(types, 'Closer / Headliner')).toBeNull()
  })

  it('follows the standard when the club has no types', () => {
    expect(unpaidNoteForRole(null, 'Open Mic')).not.toBeNull()
    expect(unpaidNoteForRole(null, 'Headliner')).toBeNull()
  })

  it('lists the active types for Book them as, and keeps a switched-off type a comedian already has', () => {
    expect(bookAsOptions(types).map((option) => option.label)).toEqual(['Open Spot', 'Closer / Headliner', 'Improv', 'Guest'])
    expect(bookAsOptions(types, ['showcase']).map((option) => option.value)).toContain('showcase')
    expect(bookAsOptions([]).map((option) => option.label)).toHaveLength(6)
  })

  it('shows the current spot name in the menu when it is not one of the club types', () => {
    expect(spotTypeMenuOptions(['Host / MC', 'Open Spot'], 'Stand-up')).toEqual(['Stand-up', 'Host / MC', 'Open Spot'])
    expect(spotTypeMenuOptions(['Host / MC', 'Open Spot'], 'open spot')).toEqual(['Host / MC', 'Open Spot'])
    expect(sameSpotType('Host', 'Host / MC')).toBe(true)
    expect(sameSpotType('Improv', 'improv')).toBe(true)
    expect(sameSpotType('Improv', 'Guest')).toBe(false)
  })
})

describe('the unpaid note in the offer', () => {
  const show = { start_time: '20:00:00', venue_name: 'No Stress Bar', venue_address: null, currency: 'DKK' }
  const openSpot = { role_name: 'Open Spot', compensation_type: 'percent' as const, compensation_amount: null, compensation_percent: 0 }

  it('goes into every offer email for an unpaid spot, and nowhere else', () => {
    const details = offerDetails(show, openSpot)
    expect(details.unpaid_note).toContain('all Open Spots are unpaid sets')
    const input = { full_name: 'Ida', show_title: 'Mic', show_date: '2026-11-18', response_url: 'https://x.test/o', unpaid_note: details.unpaid_note }
    for (const template of [bookingOfferTemplate(input), spotAvailableTemplate(input), offerReminderTemplate(input)]) {
      expect(template.html).toContain('unpaid sets')
      expect(template.text).toContain('unpaid sets')
    }

    const paid = offerDetails(show, { ...openSpot, role_name: 'Closer / Headliner', compensation_percent: 15 })
    expect(paid.unpaid_note).toBeNull()
    expect(bookingOfferTemplate({ ...input, unpaid_note: paid.unpaid_note }).html).not.toContain('unpaid')
  })
})
