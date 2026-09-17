import { describe, expect, it } from 'vitest'
import { formatScore, scoreFromRatings } from '@/lib/artist-score'
import type { PerformanceRating } from '@/types/database'

const repeat = (rating: PerformanceRating, times: number): PerformanceRating[] =>
  Array.from({ length: times }, () => rating)

/**
 * Tabellen i docs/booking-algoritmen.md, punkt 3. Endrer noen tallene her,
 * endres køen for alle komikere på plattformen — så testen er fasiten.
 */
describe('scoren fra vurderingene', () => {
  it('starter på 5,0 for den som ikke har spilt ennå', () => {
    expect(scoreFromRatings([])).toBe(5)
  })

  it('følger tabellen', () => {
    expect(scoreFromRatings(['strong'])).toBe(6.7)
    expect(scoreFromRatings(['strong', 'strong'])).toBe(8.3)
    expect(scoreFromRatings(['medium', 'strong', 'strong', 'strong'])).toBe(8.8)
    expect(scoreFromRatings(['no_show', ...repeat('strong', 5)])).toBe(7.1)
    expect(scoreFromRatings(['weak', 'weak'])).toBe(1.7)
  })

  it('lar ikke én kveld avgjøre alt', () => {
    // Uten utfyllingen til tre kvelder ville én sterk gitt 10,0 og en plass
    // foran alle andre, og én svak 0,0 og en vei ut som tar fem show.
    expect(scoreFromRatings(['strong'])).toBeLessThan(10)
    expect(scoreFromRatings(['weak'])).toBeGreaterThan(0)
  })

  it('teller «avlyste» som to svake kvelder', () => {
    expect(scoreFromRatings(['no_show'])).toBeLessThan(scoreFromRatings(['weak']))
  })

  it('ser bare på de ti siste', () => {
    // Elleve sterke og så én svak: den svake faller utenfor vinduet.
    expect(scoreFromRatings([...repeat('strong', 10), 'weak'])).toBe(10)
  })

  it('lar ingen bygge seg fast på toppen', () => {
    const afterTenStrong = scoreFromRatings(repeat('strong', 10))
    const afterOneBadNight = scoreFromRatings(['weak', ...repeat('strong', 9)])
    expect(afterOneBadNight).toBeLessThan(afterTenStrong)
  })

  it('lar en dårlig kveld hentes inn igjen', () => {
    const afterBadNight = scoreFromRatings(['weak'])
    const afterRecovery = scoreFromRatings([...repeat('strong', 4), 'weak'])
    expect(afterRecovery).toBeGreaterThan(afterBadNight)
  })

  it('holder seg innenfor 0 og 10', () => {
    expect(scoreFromRatings(repeat('strong', 10))).toBe(10)
    expect(scoreFromRatings(repeat('weak', 10))).toBe(0)
    expect(scoreFromRatings(repeat('no_show', 10))).toBe(0)
  })
})

describe('scoren som tekst', () => {
  it('skrives med én desimal og norsk komma', () => {
    expect(formatScore(7.5)).toBe('7,5')
    expect(formatScore(10)).toBe('10,0')
  })

  it('viser en strek når scoren mangler', () => {
    expect(formatScore(null)).toBe('–')
    expect(formatScore(undefined)).toBe('–')
  })
})
