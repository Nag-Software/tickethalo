import { describe, expect, it } from 'vitest'
import { CURRENCIES, currencyMatches, findCurrency, formatCurrencyLabel, normalizeCurrency } from '@/lib/currencies'

describe('admin currencies', () => {
  it.each([['nok', 'NOK'], [' EUR ', 'EUR'], ['usd', 'USD']] as const)('finds %s', (input, code) => {
    expect(findCurrency(input)?.code).toBe(code)
  })

  it.each([null, undefined, '', 'XYZ'])('falls back to NOK for %j', (input) => {
    expect(normalizeCurrency(input)).toBe('NOK')
  })

  it('formats a stable picker label', () => {
    expect(formatCurrencyLabel(findCurrency('EUR')!)).toBe('EUR — Euro')
  })

  it.each([['eur', true], ['Euro', true], ['€', true], ['dollar', false], ['', true]] as const)(
    'matches EUR against %j as %s',
    (query, expected) => expect(currencyMatches(findCurrency('EUR')!, query)).toBe(expected),
  )

  it('does not contain duplicate currency codes', () => {
    expect(new Set(CURRENCIES.map(({ code }) => code)).size).toBe(CURRENCIES.length)
  })
})
