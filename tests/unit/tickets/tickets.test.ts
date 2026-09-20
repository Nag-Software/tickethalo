import { describe, expect, it } from 'vitest'
import {
  MIN_TICKET_PRICE_MINOR,
  extractTicketCode,
  formatTicketCode,
  isTicketPriceBelowMinimum,
  ticketCodeCandidates,
  ticketPriceError,
} from '@/lib/tickets'

describe('ticket codes', () => {
  it('extracts and decodes a code from a verification URL', () => {
    expect(extractTicketCode('https://tickethalo.com/verify?code=ABCD%201234')).toBe('ABCD 1234')
  })

  it('extracts the last path segment from a URL without a query code', () => {
    expect(extractTicketCode('https://tickethalo.com/tickets/verify/ABCD1234/')).toBe('ABCD1234')
  })

  it('removes manual-entry separators', () => {
    expect(extractTicketCode(' ABCD-12 34 ')).toBe('ABCD1234')
  })

  it('formats an eight-character code for humans', () => {
    expect(formatTicketCode('ABCD1234')).toBe('ABCD-1234')
  })

  it('leaves legacy code lengths unchanged', () => {
    expect(formatTicketCode('abcdef')).toBe('abcdef')
  })

  it('returns unique exact-match case variants', () => {
    expect(ticketCodeCandidates('Ab12-Cd34')).toEqual(['Ab12Cd34', 'ab12cd34', 'AB12CD34'])
  })
})

// Et show til 2 kr ble publisert med Kjøp-knapp, og Stripe avviste hver
// betaling (under 3 kr) — kjøperen fikk bare «prøv igjen senere».
describe('minimum ticket price', () => {
  it('is 10 in the major unit', () => {
    expect(MIN_TICKET_PRICE_MINOR).toBe(1000)
  })

  it('rejects a price between zero and the minimum', () => {
    expect(isTicketPriceBelowMinimum(200)).toBe(true)
    expect(isTicketPriceBelowMinimum(999)).toBe(true)
    expect(isTicketPriceBelowMinimum(-500)).toBe(true)
    expect(isTicketPriceBelowMinimum(Number.NaN)).toBe(true)
  })

  it('accepts the minimum, anything above, a free show and an empty price', () => {
    expect(isTicketPriceBelowMinimum(1000)).toBe(false)
    expect(isTicketPriceBelowMinimum(25_000)).toBe(false)
    expect(isTicketPriceBelowMinimum(0)).toBe(false)
    expect(isTicketPriceBelowMinimum(null)).toBe(false)
    expect(isTicketPriceBelowMinimum(undefined)).toBe(false)
  })

  it('names the minimum in the currency of the show', () => {
    expect(ticketPriceError(200, 'SEK')).toBe('The ticket price must be at least 10 SEK.')
    expect(ticketPriceError(200, null)).toBe('The ticket price must be at least 10 NOK.')
    expect(ticketPriceError(1000, 'NOK')).toBeNull()
  })
})
