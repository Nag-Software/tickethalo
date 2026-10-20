// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  formatLongEnglishDate,
  formatShortEnglishDate,
  showEmailBody,
  showEmailSubject,
  showMaterialText,
  type MarketingCopyInput,
} from '@/lib/marketing/copy'
import { materialFileName } from '@/lib/marketing/material-files'

const input: MarketingCopyInput = {
  title: 'Friday Night Live',
  date: '2026-10-09',
  startTime: '20:00:00',
  venue: 'Crønch',
  city: 'Oslo',
  description: 'The best comics in town.',
  ticketUrl: 'https://tickethalo.com/events/friday',
  priceLabel: 'NOK 250',
  lineup: [
    { name: 'Per', roleLabel: null },
    { name: 'Ida', roleLabel: 'Headliner' },
  ],
}

describe('show email subject', () => {
  it('follows the form in the task: New show from <club> - Sat 9 Oct - <title>', () => {
    expect(showEmailSubject({ clubName: 'Crønch Comedy', date: '2026-10-09', title: 'Friday Night Live' }))
      .toBe('New show from Crønch Comedy - Fri 9 Oct - Friday Night Live')
    expect(showEmailSubject({ clubName: ' Crønch ', date: '2027-10-09', title: ' Late show ' }))
      .toBe('New show from Crønch - Sat 9 Oct - Late show')
  })

  it('writes September as Sep, not the Sept newer ICU gives en-GB', () => {
    expect(formatShortEnglishDate('2026-09-05')).toBe('Sat 5 Sep')
  })

  it('never slips to the day before, whatever the time zone', () => {
    expect(formatShortEnglishDate('2026-01-01')).toBe('Thu 1 Jan')
    expect(formatLongEnglishDate('2026-12-31')).toBe('Thursday 31 December 2026')
  })

  it('passes through a date it cannot read', () => {
    expect(formatShortEnglishDate('TBA')).toBe('TBA')
  })
})

describe('show email body', () => {
  it('starts with the show text, puts the headliner first and ends with the details', () => {
    expect(showEmailBody(input)).toBe([
      'The best comics in town.',
      '',
      'Line-up',
      '• Ida (Headliner)',
      '• Per',
      '',
      '• Friday 9 October 2026, 20:00',
      '• Crønch, Oslo',
      '• Tickets from NOK 250',
    ].join('\n'))
  })

  it('writes a line of its own when the show has no description or line-up yet', () => {
    const body = showEmailBody({ ...input, description: null, lineup: [] })
    expect(body.startsWith('Join us for Friday Night Live')).toBe(true)
    expect(body).not.toContain('Line-up')
  })
})

describe('show material text', () => {
  it('adds each comedian’s bio and skips empty ones', () => {
    const text = showMaterialText({ ...input, bios: [{ name: 'Ida', bio: ' Ida is funny. ' }, { name: 'Per', bio: null }] })
    expect(text).toContain('ABOUT THE COMEDIANS\n\nIda\nIda is funny.')
    expect(text).not.toContain('\nPer\n')
    expect(text).toContain('• Tickets: https://tickethalo.com/events/friday')
    expect(text.endsWith('\n')).toBe(true)
  })
})

describe('material file names', () => {
  it('uses the comedian’s name, keeps æøå and numbers duplicates', () => {
    const used = new Set<string>()
    expect(materialFileName('Bjørn Åsheim', 'jpg', used)).toBe('Bjørn Åsheim.jpg')
    expect(materialFileName('bjørn åsheim', 'jpg', used)).toBe('bjørn åsheim (2).jpg')
    expect(materialFileName('AC/DC: "Live"', 'png', used)).toBe('ACDC Live.png')
    expect(materialFileName('...', 'png', used)).toBe('file.png')
  })
})
