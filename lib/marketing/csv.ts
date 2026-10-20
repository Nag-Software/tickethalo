/**
 * CSV-lesing for import til klubbens e-postliste.
 *
 * Fila kommer fra Mailchimp, et annet billettsystem eller et Excel-ark noen
 * har tatt vare på. Norsk Excel er den vanskelige: «CSV (semikolondelt)»
 * bruker semikolon fordi komma er desimaltegn, skriver ofte Windows-1252 i
 * stedet for UTF-8 (æøå blir «Ã¦Ã¸Ã¥» om det leses feil), og kan sette en
 * `sep=;`-linje øverst. Mailchimp skriver UTF-8 med komma og BOM.
 *
 * En egen parser framfor et bibliotek: det er femti linjer, og de vanlige
 * bibliotekene gjetter ikke tegnsett uansett. Ingen Node-avhengigheter —
 * fila leses i nettleseren, så klubben ser forhåndsvisningen før noe sendes.
 */

export type CsvDelimiter = ',' | ';' | '\t'

export type ParsedCsv = {
  headers: string[]
  rows: string[][]
  delimiter: CsvDelimiter
}

const DELIMITERS: CsvDelimiter[] = [';', ',', '\t']

/**
 * Bytes → tekst. UTF-8 hvis fila er gyldig UTF-8, ellers Windows-1252.
 *
 * Det går an fordi Windows-1252 med æøå nesten aldri er gyldig UTF-8: «ø» er
 * én byte (0xF8) som UTF-8 avviser. Motsatt vei finnes ingen slik sjekk, så
 * rekkefølgen betyr noe.
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes)
  }
  return text.replace(/^﻿/, '')
}

/**
 * Skilletegnet er det som forekommer oftest i første linje, utenfor
 * anførselstegn. En overskrift som «Navn;E-post» har ett semikolon og null
 * komma; «"Etternavn, fornavn",Email» har ett komma utenfor sitatet.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts = new Map<CsvDelimiter, number>(DELIMITERS.map((d) => [d, 0]))
  let quoted = false
  for (const char of text) {
    if (char === '"') quoted = !quoted
    else if (!quoted && (char === '\n' || char === '\r')) break
    else if (!quoted && counts.has(char as CsvDelimiter)) {
      counts.set(char as CsvDelimiter, (counts.get(char as CsvDelimiter) ?? 0) + 1)
    }
  }
  let best: CsvDelimiter = ','
  for (const delimiter of DELIMITERS) {
    if ((counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0)) best = delimiter
  }
  return best
}

/** Alle radene, med felt som kan ha anførselstegn, `""` og linjeskift inni seg. */
function splitRows(text: string, delimiter: CsvDelimiter): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  // Et felt som startet med anførselstegn beholder mellomrommene sine; et
  // uten trimmes, så «Navn ; E-post» blir to rene overskrifter.
  let wasQuoted = false

  const endField = () => {
    row.push(wasQuoted ? field : field.trim())
    field = ''
    wasQuoted = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field.trim() === '') {
      quoted = true
      wasQuoted = true
      field = ''
    } else if (char === delimiter) {
      endField()
    } else if (char === '\r') {
      if (text[i + 1] === '\n') i++
      endRow()
    } else if (char === '\n') {
      endRow()
    } else {
      field += char
    }
  }

  if (field !== '' || row.length > 0 || wasQuoted) endRow()
  return rows
}

export function parseCsv(input: string, options: { delimiter?: CsvDelimiter } = {}): ParsedCsv {
  let text = input.replace(/^﻿/, '')

  // Excel skriver `sep=;` på første linje når fila skal åpnes med et annet
  // skilletegn enn maskinens. Linja er en instruks, ikke en overskrift.
  let delimiter = options.delimiter
  const sepLine = text.match(/^sep=(.)\r?\n/i)
  if (sepLine) {
    const declared = sepLine[1] as CsvDelimiter
    if (DELIMITERS.includes(declared)) delimiter = delimiter ?? declared
    text = text.slice(sepLine[0].length)
  }
  delimiter = delimiter ?? detectDelimiter(text)

  // Rader uten innhold — tomme linjer, eller `;;;` fra et Excel-ark med
  // formatering langt ned — er ikke rader.
  const rows = splitRows(text, delimiter).filter((row) => row.some((cell) => cell.trim() !== ''))
  const [headers = [], ...rest] = rows
  return { headers, rows: rest, delimiter }
}
