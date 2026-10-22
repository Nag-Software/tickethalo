// @vitest-environment node

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCsv } from '@/lib/marketing/csv'
import {
  checkoutAdsOptInLabel,
  checkoutOptInLabel,
  importAdsConsentStatement,
  importMayGrantAds,
  guessColumnMapping,
  isMailable,
  isValidEmail,
  normalizeEmail,
  prepareImportRows,
  skippedRowsCsv,
  withHeaderRow,
} from '@/lib/marketing/contacts'

describe('normalizeEmail / isValidEmail', () => {
  it('lowercases and strips what spreadsheets put around addresses', () => {
    expect(normalizeEmail('  Ida@Example.TEST ')).toBe('ida@example.test')
    expect(normalizeEmail('mailto:per@example.test')).toBe('per@example.test')
    expect(normalizeEmail('<kari@example.test>')).toBe('kari@example.test')
  })

  it('accepts ordinary addresses and rejects obvious mistakes', () => {
    expect(isValidEmail('ida.bjornstad+show@example.co.uk')).toBe(true)
    expect(isValidEmail('ida@example')).toBe(false)
    expect(isValidEmail('ida example@test.no')).toBe(false)
    expect(isValidEmail('ida@@example.test')).toBe(false)
    expect(isValidEmail('a@b.c')).toBe(false)
    expect(isValidEmail('ida@example.test;per@example.test')).toBe(false)
  })
})

describe('isMailable', () => {
  it('needs consent and no unsubscribe', () => {
    expect(isMailable({ consent_at: '2026-10-01T10:00:00Z', unsubscribed_at: null })).toBe(true)
    expect(isMailable({ consent_at: '2026-10-01T10:00:00Z', unsubscribed_at: '2026-10-02T10:00:00Z' })).toBe(false)
    expect(isMailable({ consent_at: null, unsubscribed_at: null })).toBe(false)
  })
})

describe('guessColumnMapping', () => {
  it('maps Norwegian Excel headers', () => {
    const table = parseCsv('Fornavn;Etternavn;E-post;Mobil\nIda;Bjørnstad;ida@example.test;900 00 000')
    expect(guessColumnMapping(table)).toEqual({ email: 2, name: null, firstName: 0, lastName: 1, phone: 3 })
  })

  it('maps a Mailchimp export', () => {
    const table = parseCsv('Email Address,First Name,Last Name,Phone Number\nida@example.test,Ida,B,123')
    expect(guessColumnMapping(table)).toMatchObject({ email: 0, firstName: 1, lastName: 2, phone: 3 })
  })

  it('finds the email column by its values when the header says nothing', () => {
    const table = parseCsv('Kunde;Kontakt\nIda;ida@example.test\nPer;per@example.test')
    expect(guessColumnMapping(table).email).toBe(1)
  })
})

describe('withHeaderRow', () => {
  it('treats a first row with an address as a contact, not a header', () => {
    const table = withHeaderRow(parseCsv('ida@example.test;Ida\nper@example.test;Per'))
    expect(table.hasHeaderRow).toBe(false)
    expect(table.headers).toEqual(['Column 1', 'Column 2'])
    expect(table.rows).toHaveLength(2)
  })
})

describe('prepareImportRows', () => {
  const mapping = { email: 1, name: 0, firstName: null, lastName: null, phone: 2 }

  it('dedupes, explains each skipped row and keeps spreadsheet row numbers', () => {
    const { valid, skipped } = prepareImportRows(
      [
        ['Ida', 'IDA@example.test', ' 900 00 000 '],
        ['Per', 'not-an-email', ''],
        ['Ida igjen', 'ida@example.test', ''],
        ['Kari', '', ''],
      ],
      mapping,
    )
    expect(valid).toEqual([{ line: 2, email: 'ida@example.test', name: 'Ida', phone: '900 00 000' }])
    expect(skipped).toEqual([
      { line: 3, value: 'not-an-email', reason: 'invalid_email' },
      { line: 4, value: 'ida@example.test', reason: 'duplicate_in_file' },
      { line: 5, value: 'Kari', reason: 'missing_email' },
    ])
  })

  it('joins first and last name when there is no full name column', () => {
    const { valid } = prepareImportRows([['Ida', 'Bjørnstad', 'ida@example.test']], {
      email: 2, name: null, firstName: 0, lastName: 1, phone: null,
    })
    expect(valid[0].name).toBe('Ida Bjørnstad')
  })

  it('writes skipped rows as a CSV the club can open', () => {
    expect(skippedRowsCsv([{ line: 3, value: 'a"b', reason: 'invalid_email' }])).toBe(
      'Row,Value,Reason\r\n3,"a""b","Not a valid email address"',
    )
  })
})

describe('checkoutOptInLabel', () => {
  it('names the club the consent is for', () => {
    expect(checkoutOptInLabel('Crønch Comedy')).toBe('Yes, send me emails from Crønch Comedy about upcoming shows.')
    expect(checkoutOptInLabel(null)).toBe('Yes, send me emails from the organiser about upcoming shows.')
  })
})

describe('ads consent', () => {
  it('names the club in the checkout box and the import confirmation', () => {
    expect(checkoutAdsOptInLabel('Crønch Comedy')).toBe('Show me relevant ads from Crønch Comedy on Facebook and Instagram.')
    expect(checkoutAdsOptInLabel(' ')).toBe('Show me relevant ads from the organiser on Facebook and Instagram.')
    expect(importAdsConsentStatement('Crønch Comedy')).toBe(
      'These people have also agreed to see ads from Crønch Comedy on Facebook and Instagram.',
    )
  })

  it('stores the same words in the database as the checkout shows', () => {
    // Triggeren i 090 bygger teksten selv. Står den ikke likt, lagres en annen
    // ordlyd enn den kjøperen sa ja til.
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/090_club_contact_ads_consent.sql'), 'utf8')
    const [before, after] = checkoutAdsOptInLabel('§CLUB§').split('§CLUB§')
    expect(sql).toContain(`'${before}' || coalesce(v_club_name, 'the organiser') || '${after}'`)
  })

  it('lets an import grant ads only to someone who never said yes or no', () => {
    const none = { ads_consent_at: null, ads_withdrawn_at: null, unsubscribed_at: null }
    expect(importMayGrantAds(none)).toBe(true)
    expect(importMayGrantAds({ ...none, ads_consent_at: '2026-10-22T10:00:00Z' })).toBe(false)
    expect(importMayGrantAds({ ...none, ads_consent_at: '2026-10-22T10:00:00Z', ads_withdrawn_at: '2026-10-23T10:00:00Z' })).toBe(false)
    expect(importMayGrantAds({ ...none, unsubscribed_at: '2026-10-23T10:00:00Z' })).toBe(false)
  })
})
