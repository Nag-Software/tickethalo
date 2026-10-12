import { describe, expect, it } from 'vitest'
import {
  defaultCurrencyFor,
  defaultTicketVatBps,
  formatVatPercent,
  parseClubCountry,
  parseVatPercent,
  vatIncludedIn,
} from '@/lib/ticket-vat'

describe('vatIncludedIn', () => {
  it('takes the VAT out of the price instead of adding it on top', () => {
    // 200 DKK with 25 % VAT is 160 + 40, not 200 + 50.
    expect(vatIncludedIn(20_000, 2500)).toBe(4_000)
    // 150 SEK with 6 % VAT: 150 / 1.06 = 141.51 ex VAT, 8.49 VAT.
    expect(vatIncludedIn(15_000, 600)).toBe(849)
  })

  it('is zero for exempt clubs and for nothing sold', () => {
    expect(vatIncludedIn(20_000, 0)).toBe(0)
    expect(vatIncludedIn(0, 2500)).toBe(0)
    expect(vatIncludedIn(-100, 2500)).toBe(0)
  })

  it('matches the SQL that locks the amount on the order', () => {
    // round(amount * bps / (10000 + bps)) — same formula as migration 068.
    for (const [amount, bps] of [[19_900, 2500], [5_000, 600], [1, 2500], [333, 600]] as const) {
      expect(vatIncludedIn(amount, bps)).toBe(Math.round((amount * bps) / (10000 + bps)))
    }
  })
})

describe('country defaults', () => {
  it.each([
    ['NO', 0, 'NOK'],
    ['DK', 2500, 'DKK'],
    ['SE', 600, 'SEK'],
  ])('%s gets %i bps and %s', (country, bps, currency) => {
    expect(defaultTicketVatBps(country)).toBe(bps)
    expect(defaultCurrencyFor(country)).toBe(currency)
  })

  it('treats an unknown country as Norway rather than failing', () => {
    expect(defaultTicketVatBps('XX')).toBe(0)
    expect(defaultCurrencyFor('XX')).toBe('NOK')
  })
})

describe('parseClubCountry', () => {
  it('accepts the supported countries in any case', () => {
    expect(parseClubCountry('DK')).toEqual({ country: 'DK' })
    expect(parseClubCountry(' se ')).toEqual({ country: 'SE' })
  })

  it('refuses missing and unsupported countries', () => {
    expect(parseClubCountry('')).toEqual({ error: 'Land er påkrevd.' })
    expect(parseClubCountry(null)).toEqual({ error: 'Land er påkrevd.' })
    expect(parseClubCountry('DE')).toEqual({ error: 'Landet støttes ikke ennå.' })
  })
})

describe('parseVatPercent', () => {
  it('turns a percentage into basis points, zero included', () => {
    expect(parseVatPercent('25')).toEqual({ bps: 2500 })
    expect(parseVatPercent('6')).toEqual({ bps: 600 })
    expect(parseVatPercent('0')).toEqual({ bps: 0 })
    expect(parseVatPercent('12,5')).toEqual({ bps: 1250 })
  })

  it('refuses an empty, non-numeric or out-of-range value', () => {
    expect(parseVatPercent('')).toEqual({ error: 'Momssats er påkrevd. Skriv 0 når billettene er momsfrie.' })
    expect(parseVatPercent('moms')).toEqual({ error: 'Momssatsen må være et tall.' })
    expect(parseVatPercent('-1')).toEqual({ error: 'Momssatsen må være mellom 0 og 30 %.' })
    expect(parseVatPercent('31')).toEqual({ error: 'Momssatsen må være mellom 0 og 30 %.' })
  })

  it('round-trips through the form value', () => {
    expect(formatVatPercent(2500)).toBe('25')
    expect(formatVatPercent(600)).toBe('6')
    expect(formatVatPercent(0)).toBe('0')
    expect(parseVatPercent(formatVatPercent(1250))).toEqual({ bps: 1250 })
  })
})
