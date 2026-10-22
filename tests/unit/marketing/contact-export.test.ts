// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  CONTACT_EXPORT_HEADERS,
  adsConsentState,
  contactExportCsv,
  csvCell,
  exportFileName,
  formatExportDate,
  isAdsAudience,
  metaAudienceCsv,
  metaAudienceRows,
  metaEmail,
  metaNames,
  metaPhone,
  toCsv,
  type ExportContact,
  type MetaContact,
} from '@/lib/marketing/contact-export'
import { parseCsv } from '@/lib/marketing/csv'

const consented = { ads_consent_at: '2026-10-22T10:00:00Z', ads_withdrawn_at: null, unsubscribed_at: null }

function contact(overrides: Partial<ExportContact> = {}): ExportContact {
  return {
    email: 'ola@example.com',
    name: 'Ola Nordmann',
    phone: '+47 912 34 567',
    source: 'purchase',
    consent_at: '2026-10-22T16:30:00Z',
    consent_text: 'Yes, send me emails from Latterklubben about upcoming shows.',
    unsubscribed_at: null,
    ads_consent_at: null,
    ads_consent_text: null,
    ads_withdrawn_at: null,
    last_purchase_at: '2026-10-22T16:30:00Z',
    last_show: { title: 'Fredagsmoro', date: '2026-11-14' },
    ...overrides,
  }
}

describe('ads consent', () => {
  it('counts only a yes that is neither withdrawn nor unsubscribed', () => {
    expect(isAdsAudience(consented)).toBe(true)
    expect(isAdsAudience({ ...consented, ads_consent_at: null })).toBe(false)
    expect(isAdsAudience({ ...consented, ads_withdrawn_at: '2026-10-23T00:00:00Z' })).toBe(false)
    expect(isAdsAudience({ ...consented, unsubscribed_at: '2026-10-23T00:00:00Z' })).toBe(false)
  })

  it('tells a withdrawn yes apart from never having said yes', () => {
    expect(adsConsentState(consented)).toBe('active')
    expect(adsConsentState({ ...consented, ads_withdrawn_at: '2026-10-23T00:00:00Z' })).toBe('withdrawn')
    expect(adsConsentState({ ...consented, unsubscribed_at: '2026-10-23T00:00:00Z' })).toBe('withdrawn')
    expect(adsConsentState({ ...consented, ads_consent_at: null })).toBe('none')
  })
})

describe('csv cells', () => {
  it('quotes delimiters, quotes and line breaks, and doubles the quotes inside', () => {
    expect(csvCell('plain', ';')).toBe('plain')
    expect(csvCell('a;b', ';')).toBe('"a;b"')
    expect(csvCell('a,b', ';')).toBe('a,b')
    expect(csvCell('a,b', ',')).toBe('"a,b"')
    expect(csvCell('Ola "Latter" Nordmann', ';')).toBe('"Ola ""Latter"" Nordmann"')
    expect(csvCell('two\nlines', ';')).toBe('"two\nlines"')
    expect(csvCell(null, ';')).toBe('')
    expect(csvCell(3, ';')).toBe('3')
  })

  it('keeps æøå as they are', () => {
    expect(csvCell('Bjørn Ærø Åsen', ';')).toBe('Bjørn Ærø Åsen')
  })

  it('turns a formula into text, but not a phone number with a country code', () => {
    expect(csvCell('=HYPERLINK("http://x","click")', ';')).toBe(`"'=HYPERLINK(""http://x"",""click"")"`)
    expect(csvCell('+SUM(A1)', ';')).toBe("'+SUM(A1)")
    expect(csvCell('-1+2', ';')).toBe("'-1+2")
    expect(csvCell('@cmd', ';')).toBe("'@cmd")
    expect(csvCell('+47 912 34 567', ';')).toBe('+47 912 34 567')
  })

  it('writes CRLF lines and a BOM only when asked', () => {
    expect(toCsv([['a', 'b'], ['c', 'd']], { delimiter: ';', bom: true })).toBe('﻿a;b\r\nc;d\r\n')
    expect(toCsv([['a', 'b']], { delimiter: ',', bom: false })).toBe('a,b\r\n')
  })
})

describe('the contacts file', () => {
  it('starts with a BOM, uses semicolons and reads back with our own parser', () => {
    const csv = contactExportCsv([
      contact({ name: 'Bjørn; "Den store" Ærø' }),
      contact({ email: 'kari@example.com', name: null, phone: null, last_show: null, ...consented, ads_consent_text: 'Show me relevant ads from Latterklubben on Facebook and Instagram.' }),
    ])
    expect(csv.startsWith('﻿Name;Email;Phone;')).toBe(true)

    const table = parseCsv(csv)
    expect(table.delimiter).toBe(';')
    expect(table.headers).toEqual([...CONTACT_EXPORT_HEADERS])
    expect(table.rows[0]).toEqual([
      'Bjørn; "Den store" Ærø',
      'ola@example.com',
      '+47 912 34 567',
      'Purchase',
      '2026-10-22 18:30',
      'Yes, send me emails from Latterklubben about upcoming shows.',
      'Subscribed',
      '',
      'No',
      '',
      '',
      'Fredagsmoro',
      '2026-11-14',
    ])
    expect(table.rows[1].slice(8, 11)).toEqual([
      'Yes',
      '2026-10-22 12:00',
      'Show me relevant ads from Latterklubben on Facebook and Instagram.',
    ])
  })

  it('marks unsubscribed and withdrawn contacts', () => {
    const [row] = parseCsv(
      contactExportCsv([contact({ ...consented, unsubscribed_at: '2026-10-23T07:05:00Z', ads_withdrawn_at: '2026-10-23T07:05:00Z' })]),
    ).rows
    expect(row[6]).toBe('Unsubscribed')
    expect(row[7]).toBe('2026-10-23 09:05')
    expect(row[8]).toBe('Withdrawn')
  })

  it('formats dates in Oslo time, summer and winter', () => {
    expect(formatExportDate('2026-07-01T10:00:00Z')).toBe('2026-07-01 12:00')
    expect(formatExportDate('2026-12-31T23:30:00Z')).toBe('2027-01-01 00:30')
    expect(formatExportDate(null)).toBe('')
    expect(formatExportDate('not a date')).toBe('')
  })
})

describe('Meta formatting', () => {
  it('trims and lowercases the email', () => {
    expect(metaEmail('  Ola.Nordmann@Example.COM ')).toBe('ola.nordmann@example.com')
    expect(metaEmail(null)).toBe('')
  })

  it('writes Norwegian numbers as digits with the country code', () => {
    expect(metaPhone('+47 912 34 567', 'NO')).toBe('4791234567')
    expect(metaPhone('0047 912 34 567', 'NO')).toBe('4791234567')
    expect(metaPhone('912 34 567', 'NO')).toBe('4791234567')
    expect(metaPhone('91234567', 'no')).toBe('4791234567')
    expect(metaPhone('(+47) 912-34-567', 'NO')).toBe('4791234567')
  })

  it('keeps a foreign country code and leaves out what cannot be a number', () => {
    expect(metaPhone('+46 70 123 45 67', 'NO')).toBe('46701234567')
    expect(metaPhone('+44 7700 900123', 'NO')).toBe('447700900123')
    expect(metaPhone('070-123 45 67', 'SE')).toBe('46701234567')
    expect(metaPhone('1234', 'NO')).toBe('')
    expect(metaPhone('912 34 56', 'NO')).toBe('')
    expect(metaPhone('call me', 'NO')).toBe('')
    expect(metaPhone('91234567', 'US')).toBe('')
    expect(metaPhone('+0 123 456 789', 'NO')).toBe('')
    expect(metaPhone('', 'NO')).toBe('')
    expect(metaPhone(null, 'NO')).toBe('')
  })

  it('splits the name into first and last, lowercase without punctuation', () => {
    expect(metaNames('Ola Nordmann')).toEqual({ fn: 'ola', ln: 'nordmann' })
    expect(metaNames('  Kari  Bjørg Ødegård-Hansen ')).toEqual({ fn: 'kari', ln: 'ødegårdhansen' })
    expect(metaNames("Æsa O'Brien")).toEqual({ fn: 'æsa', ln: 'obrien' })
    expect(metaNames('Cher')).toEqual({ fn: 'cher', ln: '' })
    expect(metaNames('J. R.')).toEqual({ fn: 'j', ln: 'r' })
    expect(metaNames(null)).toEqual({ fn: '', ln: '' })
  })

  it('exports only people with ads consent, once each, in Meta’s columns', () => {
    const contacts: MetaContact[] = [
      { email: 'Ola@Example.com', name: 'Ola Nordmann', phone: '912 34 567', ...consented },
      { email: 'ola@example.com ', name: 'Ola N', phone: null, ...consented },
      { email: 'kari@example.com', name: 'Kari', phone: null, ...consented, ads_consent_at: null },
      { email: 'per@example.com', name: 'Per', phone: null, ...consented, ads_withdrawn_at: '2026-10-23T00:00:00Z' },
      { email: 'liv@example.com', name: 'Liv', phone: null, ...consented, unsubscribed_at: '2026-10-23T00:00:00Z' },
      { email: 'åse@example.com', name: 'Åse Ås', phone: '+46 70 123 45 67', ...consented },
    ]
    const rows = metaAudienceRows(contacts, 'NO')
    expect(rows).toEqual([
      ['ola@example.com', '4791234567', 'ola', 'nordmann', 'no'],
      ['åse@example.com', '46701234567', 'åse', 'ås', 'no'],
    ])
    expect(metaAudienceCsv(rows)).toBe(
      'email,phone,fn,ln,country\r\nola@example.com,4791234567,ola,nordmann,no\r\nåse@example.com,46701234567,åse,ås,no\r\n',
    )
  })

  it('has no BOM, so Meta reads the first column name as email', () => {
    expect(metaAudienceCsv([]).charCodeAt(0)).toBe('e'.charCodeAt(0))
  })

  it('leaves the country out when the club has none that looks like a code', () => {
    expect(metaAudienceRows([{ email: 'a@example.com', name: null, phone: null, ...consented }], '')).toEqual([
      ['a@example.com', '', '', '', ''],
    ])
  })
})

describe('file names', () => {
  it('uses a plain slug of the club and the date in Oslo', () => {
    expect(exportFileName('Bærum Komiklubb – Ås', 'contacts', new Date('2026-10-22T23:30:00Z'))).toBe(
      'baerum-komiklubb-as-contacts-2026-10-23.csv',
    )
    expect(exportFileName('!!!', 'meta', new Date('2026-10-22T10:00:00Z'))).toBe('club-meta-audience-2026-10-22.csv')
  })
})
