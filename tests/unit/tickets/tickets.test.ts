import { describe, expect, it } from 'vitest'
import { extractTicketCode, formatTicketCode, ticketCodeCandidates } from '@/lib/tickets'

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
