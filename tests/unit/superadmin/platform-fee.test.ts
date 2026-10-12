import { describe, expect, it } from 'vitest'
import { formatCommissionPercent, parseCommissionPercent } from '@/lib/platform-fee'

describe('parseCommissionPercent', () => {
  it('turns a percentage into basis points', () => {
    expect(parseCommissionPercent('10')).toEqual({ bps: 1000 })
    expect(parseCommissionPercent('7')).toEqual({ bps: 700 })
    expect(parseCommissionPercent('7.5')).toEqual({ bps: 750 })
    expect(parseCommissionPercent(' 12 ')).toEqual({ bps: 1200 })
  })

  it('accepts a Norwegian decimal comma', () => {
    expect(parseCommissionPercent('7,5')).toEqual({ bps: 750 })
  })

  it('rounds to a hundredth of a percent', () => {
    expect(parseCommissionPercent('7.123')).toEqual({ bps: 712 })
  })

  it('refuses an empty or non-numeric value', () => {
    expect(parseCommissionPercent('')).toEqual({ error: 'Provisjon er påkrevd.' })
    expect(parseCommissionPercent(null)).toEqual({ error: 'Provisjon er påkrevd.' })
    expect(parseCommissionPercent('ti')).toEqual({ error: 'Provisjonen må være et tall.' })
  })

  // Under 5 % taper Tickethalo penger på hvert salg; over 30 % er en skrivefeil.
  it('keeps the commission between the floor and the ceiling', () => {
    const error = { error: 'Provisjonen må være mellom 5 og 30 %.' }
    expect(parseCommissionPercent('4.9')).toEqual(error)
    expect(parseCommissionPercent('0')).toEqual(error)
    expect(parseCommissionPercent('-5')).toEqual(error)
    expect(parseCommissionPercent('30.1')).toEqual(error)
    expect(parseCommissionPercent('5')).toEqual({ bps: 500 })
    expect(parseCommissionPercent('30')).toEqual({ bps: 3000 })
  })
})

describe('formatCommissionPercent', () => {
  it('writes basis points as the percentage the form shows', () => {
    expect(formatCommissionPercent(1000)).toBe('10')
    expect(formatCommissionPercent(750)).toBe('7.5')
    expect(formatCommissionPercent(500)).toBe('5')
  })
})
