import { describe, expect, it } from 'vitest'
import { missingForPublish, publishReadiness } from '@/lib/publish-readiness'

// Showet gikk ut uten plakat, tekst og billettpris fordi det publiserte seg
// selv. Listen er det e-posten til klubben og publiser-dialogen leser.
describe('publishReadiness', () => {
  it('flags an empty event page as missing all three', () => {
    const missing = missingForPublish({ poster_url: null, description: null, ticket_price: null })
    expect(missing.map((item) => item.key)).toEqual(['poster', 'description', 'ticket_price'])
  })

  it('treats whitespace as no description', () => {
    const missing = missingForPublish({ poster_url: 'https://x.test/p.png', description: '   ', ticket_price: 25000 })
    expect(missing.map((item) => item.key)).toEqual(['description'])
  })

  it('accepts a free show: price 0 is a choice, an empty price is not', () => {
    const free = { poster_url: 'https://x.test/p.png', description: 'A night of stand-up.', ticket_price: 0 }
    expect(missingForPublish(free)).toEqual([])
    expect(publishReadiness(free).every((item) => item.done)).toBe(true)
  })
})
