/**
 * Klubbens e-postliste: regler som både importdialogen og serveren bruker.
 *
 * Importen gjøres i to steg, som hos Mailchimp: nettleseren leser fila og
 * viser hva som blir importert, serveren gjør det. Reglene for hva som er en
 * gyldig rad står her, så forhåndsvisningen og resultatet er like — og
 * serveren sjekker på nytt, fordi det den får er det nettleseren sendte.
 *
 * Ingen Node-avhengigheter.
 */
import type { ParsedCsv } from './csv'

/** Kolonnene en import kan bruke. Null = ikke i fila. */
export type ColumnMapping = {
  email: number | null
  name: number | null
  firstName: number | null
  lastName: number | null
  phone: number | null
}

export type ImportRow = {
  /** Raden i regnearket, med overskriften som rad 1. Til rapporten. */
  line: number
  email: string
  name: string | null
  phone: string | null
}

export type SkipReason = 'missing_email' | 'invalid_email' | 'duplicate_in_file' | 'unsubscribed'

export type SkippedRow = {
  line: number
  value: string
  reason: SkipReason
}

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  missing_email: 'No email address',
  invalid_email: 'Not a valid email address',
  duplicate_in_file: 'Already earlier in the file',
  unsubscribed: 'Unsubscribed from your list — not added again',
}

/** Rader per serverkall. En server action tar 1 MB; tusen rader er godt under. */
export const IMPORT_CHUNK_SIZE = 1000
/** Øvre grense per fil. Større lister er ikke en klubb i denne fasen. */
export const IMPORT_MAX_ROWS = 50_000

export function importConsentStatement(clubName: string) {
  return `I confirm that these people have agreed to receive emails from ${clubName}.`
}

/** Teksten i checkout. Lagres på kontakten i migrasjon 077 — endres den, endre triggeren også. */
export function checkoutOptInLabel(clubName: string | null | undefined) {
  const name = clubName?.trim()
  return `Yes, send me emails from ${name || 'the organiser'} about upcoming shows.`
}

// ─────────────────────────────────────────────────────────────
// Feltene
// ─────────────────────────────────────────────────────────────

/** Små bokstaver, uten mellomrom, `mailto:` eller `<…>` rundt. */
export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/^<(.*)>$/, '$1')
    .trim()
    .toLowerCase()
}

/**
 * Bevisst enkel: én @, noe på begge sider, en punktum i domenet og ingen
 * mellomrom. Strengere regler avviser ekte adresser; Resend avviser resten.
 */
export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@"<>,;]+@[^\s@"<>,;]+\.[^\s@"<>,;.]{2,}$/.test(email)
}

function cleanText(value: string | null | undefined, max: number): string | null {
  const cleaned = (value ?? '').replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, max) : null
}

export const cleanName = (value: string | null | undefined) => cleanText(value, 200)
export const cleanPhone = (value: string | null | undefined) => cleanText(value, 40)

/** Kan få e-post: har sagt ja, og har ikke meldt seg av. */
export function isMailable(contact: { consent_at: string | null; unsubscribed_at: string | null }): boolean {
  return Boolean(contact.consent_at) && !contact.unsubscribed_at
}

// ─────────────────────────────────────────────────────────────
// Kolonnene
// ─────────────────────────────────────────────────────────────

/** «E-post adresse» → «epostadresse». */
function headerKey(header: string) {
  return header.toLowerCase().normalize('NFKD').replace(/[^a-z0-9æøå]/g, '')
}

const HEADER_ALIASES: Record<keyof ColumnMapping, string[]> = {
  email: ['email', 'emailaddress', 'emailadresse', 'epost', 'epostadresse', 'mail', 'mailadresse'],
  firstName: ['firstname', 'fornavn', 'givenname'],
  lastName: ['lastname', 'etternavn', 'surname', 'familyname'],
  name: ['name', 'navn', 'fullname', 'fulltnavn', 'kunde', 'customer', 'kjøper', 'buyer'],
  phone: ['phone', 'phonenumber', 'telefon', 'telefonnummer', 'tlf', 'mobil', 'mobile', 'mobilnummer', 'mobilephone', 'cell'],
}

/**
 * Hvilke kolonner som er hva, gjettet fra overskriftene — som Mailchimp gjør
 * før klubben retter opp. Finnes ingen e-postoverskrift, velges kolonnen der
 * flest verdier ser ut som e-post.
 */
export function guessColumnMapping(table: ParsedCsv): ColumnMapping {
  const keys = table.headers.map(headerKey)
  const find = (field: keyof ColumnMapping) => {
    const aliases = HEADER_ALIASES[field]
    const exact = keys.findIndex((key) => aliases.includes(key))
    return exact >= 0 ? exact : null
  }

  const mapping: ColumnMapping = {
    email: find('email'),
    firstName: find('firstName'),
    lastName: find('lastName'),
    name: find('name'),
    phone: find('phone'),
  }

  if (mapping.email === null) {
    const sample = table.rows.slice(0, 50)
    let best = { index: -1, hits: 0 }
    for (let index = 0; index < table.headers.length; index++) {
      const hits = sample.filter((row) => isValidEmail(normalizeEmail(row[index]))).length
      if (hits > best.hits) best = { index, hits }
    }
    if (best.index >= 0) mapping.email = best.index
  }

  return mapping
}

/**
 * En fil uten overskrift — første rad er en kontakt. Da får kolonnene
 * nummer, og første rad blir med i importen.
 */
export function withHeaderRow(table: ParsedCsv): ParsedCsv & { hasHeaderRow: boolean } {
  const firstRowIsContact = table.headers.some((cell) => isValidEmail(normalizeEmail(cell)))
  if (!firstRowIsContact) return { ...table, hasHeaderRow: true }

  const width = Math.max(table.headers.length, ...table.rows.map((row) => row.length))
  return {
    ...table,
    headers: Array.from({ length: width }, (_, index) => `Column ${index + 1}`),
    rows: [table.headers, ...table.rows],
    hasHeaderRow: false,
  }
}

// ─────────────────────────────────────────────────────────────
// Radene
// ─────────────────────────────────────────────────────────────

function cell(row: string[], index: number | null) {
  return index === null ? '' : (row[index] ?? '')
}

/**
 * Fra regnearkrader til kontakter. Første forekomst av en adresse vinner;
 * senere blir hoppet over og står i rapporten med radnummeret, så klubben
 * kan finne dem i arket.
 */
export function prepareImportRows(
  rows: string[][],
  mapping: ColumnMapping,
  options: { firstLine?: number } = {},
): { valid: ImportRow[]; skipped: SkippedRow[] } {
  const firstLine = options.firstLine ?? 2
  const valid: ImportRow[] = []
  const skipped: SkippedRow[] = []
  const seen = new Set<string>()

  rows.forEach((row, index) => {
    const line = firstLine + index
    const raw = cell(row, mapping.email).trim()
    const email = normalizeEmail(raw)

    if (!email) {
      skipped.push({ line, value: row.filter(Boolean).join(' ').slice(0, 80), reason: 'missing_email' })
      return
    }
    if (!isValidEmail(email)) {
      skipped.push({ line, value: raw, reason: 'invalid_email' })
      return
    }
    if (seen.has(email)) {
      skipped.push({ line, value: raw, reason: 'duplicate_in_file' })
      return
    }
    seen.add(email)

    const joined = [cell(row, mapping.firstName), cell(row, mapping.lastName)].join(' ')
    valid.push({
      line,
      email,
      name: cleanName(cell(row, mapping.name)) ?? cleanName(joined),
      phone: cleanPhone(cell(row, mapping.phone)),
    })
  })

  return { valid, skipped }
}

/** Hoppede rader som CSV, så klubben kan rette dem i arket og importere på nytt. */
export function skippedRowsCsv(skipped: SkippedRow[]): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
  return [
    'Row,Value,Reason',
    ...skipped.map((row) => `${row.line},${quote(row.value)},${quote(SKIP_REASON_LABELS[row.reason])}`),
  ].join('\r\n')
}
