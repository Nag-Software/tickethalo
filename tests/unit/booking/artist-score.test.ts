import { describe, expect, it } from 'vitest'
import { formatScore, globalScore, meetsSkillLevel, NEUTRAL_SCORE, scoreFromRatings, SKILL_LEVELS, SKILL_REQUIREMENT_LABELS, skillLevelFromScore } from '@/lib/artist-score'
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

// Tersklene er bestemt av eieren 2026-10-20: under 4 Low, over 7 High.
describe('skill level fra scoren', () => {
  it('følger tersklene, med 4,0 og 7,0 som Medium', () => {
    expect(skillLevelFromScore(0)).toBe('low')
    expect(skillLevelFromScore(3.9)).toBe('low')
    expect(skillLevelFromScore(4)).toBe('medium')
    expect(skillLevelFromScore(7)).toBe('medium')
    expect(skillLevelFromScore(7.1)).toBe('high')
    expect(skillLevelFromScore(10)).toBe('high')
  })

  it('gir Medium til den som ikke er vurdert ennå', () => {
    expect(skillLevelFromScore(NEUTRAL_SCORE)).toBe('medium')
    expect(skillLevelFromScore(scoreFromRatings([]))).toBe('medium')
    expect(skillLevelFromScore(null)).toBe('medium')
  })

  it('krever to sterke kvelder for High, og to svake gir Low', () => {
    expect(skillLevelFromScore(scoreFromRatings(['strong']))).toBe('medium')
    expect(skillLevelFromScore(scoreFromRatings(['strong', 'strong']))).toBe('high')
    expect(skillLevelFromScore(scoreFromRatings(['weak', 'weak']))).toBe('low')
  })

  it('slipper inn nivået og alt over', () => {
    expect(meetsSkillLevel(2, null)).toBe(true)
    expect(meetsSkillLevel(2, 'low')).toBe(true)
    expect(meetsSkillLevel(2, 'medium')).toBe(false)
    expect(meetsSkillLevel(5, 'medium')).toBe(true)
    expect(meetsSkillLevel(8, 'medium')).toBe(true)
    expect(meetsSkillLevel(7, 'high')).toBe(false)
    expect(meetsSkillLevel(7.1, 'high')).toBe(true)
  })

  // ClickUp 869fm9avq: «higher» og «High» ble lest om hverandre.
  it('navngir minstekravet uten å gjenta «high»', () => {
    expect(SKILL_LEVELS.map((level) => SKILL_REQUIREMENT_LABELS[level])).toEqual([
      'Low (or better)',
      'Medium (or better)',
      'High',
    ])
    expect(Object.values(SKILL_REQUIREMENT_LABELS).filter((label) => /high/i.test(label))).toEqual(['High'])
  })
})

describe('den globale scoren', () => {
  it('er tom når ingen klubb har vurdert komikeren', () => {
    expect(globalScore([])).toEqual({ score: null, reviewCount: 0, clubCount: 0 })
    expect(globalScore([{ score: 5, reviewCount: 0 }])).toEqual({ score: null, reviewCount: 0, clubCount: 0 })
  })

  it('vekter hver klubb med hvor mange vurderinger den har gitt', () => {
    // (8 × 3 + 2 × 1) / 4 = 6,5 — ikke det uvektede snittet 5,0.
    expect(globalScore([{ score: 8, reviewCount: 3 }, { score: 2, reviewCount: 1 }])).toEqual({
      score: 6.5,
      reviewCount: 4,
      clubCount: 2,
    })
  })

  it('tar ikke med klubber som bare står på nøytrale 5,0 uten vurderinger', () => {
    expect(globalScore([{ score: 9, reviewCount: 2 }, { score: 5, reviewCount: 0 }])).toEqual({
      score: 9,
      reviewCount: 2,
      clubCount: 1,
    })
  })

  it('runder til én desimal', () => {
    expect(globalScore([{ score: 8.3, reviewCount: 2 }, { score: 6.7, reviewCount: 1 }]).score).toBe(7.8)
  })
})
