// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { decodeCsvBytes, detectDelimiter, parseCsv } from '@/lib/marketing/csv'

/** Windows-1252-bytes for en streng med bare latin-1-tegn — slik norsk Excel lagrer. */
function windows1252(text: string) {
  return Uint8Array.from([...text].map((char) => char.charCodeAt(0)))
}

describe('decodeCsvBytes', () => {
  it('reads UTF-8 and drops the byte order mark Mailchimp writes', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Email,Name\nida@example.test,Ida Ø')])
    expect(decodeCsvBytes(bytes)).toBe('Email,Name\nida@example.test,Ida Ø')
  })

  it('falls back to Windows-1252 for a Norwegian Excel export, so æøå survive', () => {
    const text = decodeCsvBytes(windows1252('Navn;E-post\nBjørn Åsheim;bjorn@example.test\nKæthe;kaethe@example.test'))
    expect(text).toContain('Bjørn Åsheim')
    expect(text).toContain('Kæthe')
  })
})

describe('detectDelimiter', () => {
  it('picks semicolon for a Norwegian Excel header', () => {
    expect(detectDelimiter('Navn;E-post;Telefon\n')).toBe(';')
  })

  it('picks comma and ignores commas inside quotes', () => {
    expect(detectDelimiter('"Etternavn, fornavn",Email\n')).toBe(',')
    expect(detectDelimiter('"a;b;c";"d";e,f\n')).toBe(';')
  })

  it('picks tab for a pasted spreadsheet', () => {
    expect(detectDelimiter('Email\tName\n')).toBe('\t')
  })
})

describe('parseCsv', () => {
  it('splits headers from rows', () => {
    expect(parseCsv('Email,Name\nida@example.test,Ida\nper@example.test,Per')).toEqual({
      headers: ['Email', 'Name'],
      rows: [['ida@example.test', 'Ida'], ['per@example.test', 'Per']],
      delimiter: ',',
    })
  })

  it('handles quoted fields with delimiters, doubled quotes and line breaks', () => {
    const { rows } = parseCsv('Name,Email,Note\n"Nordmann, Ola",ola@example.test,"Said ""yes""\nat the bar"')
    expect(rows).toEqual([['Nordmann, Ola', 'ola@example.test', 'Said "yes"\nat the bar']])
  })

  it('reads CRLF and lone CR line endings', () => {
    expect(parseCsv('Email\r\na@example.test\r\nb@example.test').rows).toEqual([['a@example.test'], ['b@example.test']])
    expect(parseCsv('Email\ra@example.test\rb@example.test').rows).toEqual([['a@example.test'], ['b@example.test']])
  })

  it('follows the sep= line Excel writes and does not treat it as a header', () => {
    const parsed = parseCsv('sep=;\r\nNavn;E-post\r\nIda;ida@example.test\r\n')
    expect(parsed.delimiter).toBe(';')
    expect(parsed.headers).toEqual(['Navn', 'E-post'])
    expect(parsed.rows).toEqual([['Ida', 'ida@example.test']])
  })

  it('drops empty lines and rows of bare delimiters from a formatted sheet', () => {
    const parsed = parseCsv('Navn;E-post\n\nIda;ida@example.test\n;;\n ; \n')
    expect(parsed.rows).toEqual([['Ida', 'ida@example.test']])
  })

  it('trims unquoted fields but keeps the spaces inside quotes', () => {
    expect(parseCsv('a , b\n  x  ," y "').rows).toEqual([['x', ' y ']])
  })

  it('keeps a trailing empty field', () => {
    expect(parseCsv('Name;Email;Phone\nIda;ida@example.test;').rows).toEqual([['Ida', 'ida@example.test', '']])
  })

  it('returns no rows for an empty file', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [], delimiter: ',' })
  })
})
