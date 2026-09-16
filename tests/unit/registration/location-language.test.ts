import { describe, expect, it } from 'vitest'
import {
  defaultLanguagesForCountry,
  distanceToCity,
  foldName,
  formatDistance,
  haversineKm,
  lookupCountry,
  lookupPlace,
  nearestPlace,
  searchPlaces,
} from '@/lib/geo'
import { formatLanguageSummary, normalizeLanguages } from '@/lib/languages'

const languageCases: Array<[string | string[], string[]]> = [
  ['Begge', ['no', 'en']],
  ['Norsk og engelsk', ['no', 'en']],
  ['Deutsch / English', ['en', 'de']],
  [['svenska', 'Swedish', 'en'], ['sv', 'en']],
]

describe('registration country and language normalization', () => {
  it.each([
    ['NO', ['no']], ['SE', ['sv']], ['DK', ['da']], ['GB', ['en']], ['US', ['en']],
  ] as const)('suggests languages for %s', (country, languages) => {
    expect(defaultLanguagesForCountry(country)).toEqual(languages)
  })

  it('returns no defaults for an unknown country', () => {
    expect(defaultLanguagesForCountry('XX')).toEqual([])
    expect(lookupCountry('XX')).toBeUndefined()
  })

  it.each(languageCases)('normalizes language input %#', (input, expected) => {
    expect(normalizeLanguages(input)).toEqual(expected)
  })

  it('drops unknown languages', () => {
    expect(normalizeLanguages('Klingon')).toEqual([])
  })

  it('formats a stable language summary', () => {
    expect(formatLanguageSummary(['en', 'no'])).toBe('Norwegian, English')
    expect(formatLanguageSummary(null, 'None')).toBe('None')
  })
})

describe('registration place lookup', () => {
  it.each([
    ['Tromsø', 'tromso'], ['Ålesund', 'alesund'], ['København', 'kobenhavn'], ['Malmö', 'malmo'],
  ])('folds %s for keyboard-friendly search', (input, expected) => {
    expect(foldName(input)).toBe(expected)
  })

  it('resolves a city without accents', () => {
    expect(lookupPlace('tromso')?.name).toBe('Tromsø')
  })

  it('returns no place for empty or unknown input', () => {
    expect(lookupPlace(null)).toBeUndefined()
    expect(lookupPlace('Atlantis')).toBeUndefined()
  })

  it('ranks prefix matches ahead of substring matches', () => {
    expect(searchPlaces('sand', undefined, 3).map((place) => place.name)).toEqual(['Sandnes', 'Sandvika', 'Sandefjord'])
  })

  it('limits search results', () => {
    expect(searchPlaces('a', undefined, 2)).toHaveLength(2)
  })

  it('calculates zero distance for identical coordinates', () => {
    expect(haversineKm({ lat: 1, lon: 2 }, { lat: 1, lon: 2 })).toBe(0)
  })

  it('finds the closest known place', () => {
    expect(nearestPlace({ lat: 59.914, lon: 10.752 })?.name).toBe('Oslo')
  })

  it('returns null distance for an unknown city', () => {
    expect(distanceToCity({ lat: 59.9, lon: 10.7 }, 'Atlantis')).toBeNull()
  })

  it.each([[0.6, '600 m'], [1.25, '1.3 km'], [12.6, '13 km']] as const)(
    'formats %s km as %s',
    (distance, label) => expect(formatDistance(distance)).toBe(label),
  )
})
