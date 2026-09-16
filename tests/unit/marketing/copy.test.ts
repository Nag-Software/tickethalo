import { describe, expect, it } from 'vitest'
import {
  facebookEventDescription,
  facebookEventTitle,
  formatNorwegianDate,
  socialCaption,
  type MarketingCopyInput,
} from '@/lib/marketing/copy'

const base: MarketingCopyInput = {
  title: 'Friday Laughs',
  date: '2026-09-18',
  startTime: '20:30:00',
  venue: 'Comedy House',
  city: 'Oslo',
  description: 'A sharp night of stand-up.',
  ticketUrl: 'https://tickethalo.com/events/friday-laughs',
  priceLabel: 'NOK 250',
  lineup: [
    { name: 'Support Star', roleLabel: 'Stand-up' },
    { name: 'Main Name', roleLabel: 'Headliner' },
  ],
}

describe('marketing copy', () => {
  it('formats a valid date in Norwegian', () => {
    expect(formatNorwegianDate('2026-09-18')).toBe('fredag 18. september 2026')
  })

  it('preserves an invalid date rather than inventing one', () => {
    expect(formatNorwegianDate('not-a-date')).toBe('not-a-date')
  })

  it('puts headliners first in the event description', () => {
    const copy = facebookEventDescription(base)
    expect(copy.indexOf('Main Name')).toBeLessThan(copy.indexOf('Support Star'))
  })

  it.each([
    ['A sharp night of stand-up.'],
    ['LINEUP'],
    ['• Main Name (Headliner)'],
    ['fredag 18. september 2026, kl. 20:30'],
    ['• Comedy House, Oslo'],
    ['• Billetter fra NOK 250'],
    ['Billetter: https://tickethalo.com/events/friday-laughs'],
  ])('includes required event information %s', (line) => {
    expect(facebookEventDescription(base)).toContain(line)
  })

  it('uses safe fallback copy and lineup placeholder', () => {
    const copy = facebookEventDescription({ ...base, description: ' ', lineup: [] })
    expect(copy).toContain('Friday Laughs — en kveld med stand-up.')
    expect(copy).toContain('• Lineup annonseres snart')
  })

  it.each([
    ['startTime', null, 'kl.'],
    ['venue', null, 'Comedy House'],
    ['priceLabel', null, 'Billetter fra'],
    ['ticketUrl', null, 'Billetter:'],
  ] as const)('omits optional %s content', (key, value, absent) => {
    expect(facebookEventDescription({ ...base, [key]: value })).not.toContain(absent)
  })

  it('does not produce three consecutive blank lines', () => {
    expect(facebookEventDescription({ ...base, venue: null, priceLabel: null, ticketUrl: null })).not.toContain('\n\n\n')
  })

  it('creates a compact caption with natural name joining', () => {
    expect(socialCaption(base)).toContain('Support Star og Main Name')
  })

  it('handles one artist without a conjunction', () => {
    expect(socialCaption({ ...base, lineup: [{ name: 'Solo', roleLabel: null }] })).toContain('\nSolo\n')
  })

  it('falls back to bio ticket copy when URL is missing', () => {
    expect(socialCaption({ ...base, ticketUrl: null })).toMatch(/Billetter i bio$/)
  })

  it('adds the headliner to the Facebook title', () => {
    expect(facebookEventTitle(base)).toBe('Friday Laughs — Main Name')
  })

  it('keeps the original title without a headliner', () => {
    expect(facebookEventTitle({ ...base, lineup: [{ name: 'Solo', roleLabel: 'Host' }] })).toBe('Friday Laughs')
  })
})
