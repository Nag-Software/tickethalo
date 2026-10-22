/**
 * Eksport av klubbens kontaktliste: den vanlige CSV-fila og kundelista til Meta.
 *
 * Den vanlige fila er for norsk Excel: UTF-8 med BOM og semikolon. Uten BOM
 * leser Excel fila som Windows-1252 og æøå blir «Ã¦Ã¸Ã¥»; komma er
 * desimaltegnet, så semikolon er skilletegnet Excel venter. Ingen `sep=;`-linje:
 * med den ignorerer Excel BOM-en, og æøå blir feil likevel.
 *
 * Meta-fila følger Metas kundeliste-format (Custom Audience): kolonnenavnene
 * er identifikatorene deres, komma, ingen BOM — en BOM ville blitt en del av
 * første kolonnenavn. Meta hasher verdiene ved opplasting; vi gjør dem bare
 * like nok til at de matcher.
 *
 * Ingen Node-avhengigheter, så alt kan testes uten basen.
 */

export type ContactStatusFilter = 'all' | 'subscribed' | 'unsubscribed' | 'ads'

export type AdsConsentFields = {
  ads_consent_at: string | null
  ads_withdrawn_at: string | null
  unsubscribed_at: string | null
}

/**
 * Kan være med i Meta-lista: har sagt ja til annonser, har ikke trukket det
 * tilbake, og står fortsatt på e-postlista. Samme regel som den delvise
 * indeksen i migrasjon 090.
 */
export function isAdsAudience(contact: AdsConsentFields): boolean {
  return Boolean(contact.ads_consent_at) && !contact.ads_withdrawn_at && !contact.unsubscribed_at
}

export type AdsConsentState = 'active' | 'withdrawn' | 'none'

export function adsConsentState(contact: AdsConsentFields): AdsConsentState {
  if (isAdsAudience(contact)) return 'active'
  return contact.ads_consent_at ? 'withdrawn' : 'none'
}

// ─────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────

const BOM = '﻿'

/** Et telefonnummer som «+47 912 34 567». Det er ikke en formel. */
const PHONE_LIKE = /^\+[\d\s().-]+$/

/**
 * Én celle. Anførselstegn rundt når den har skilletegnet, `"` eller
 * linjeskift; `"` inni dobles.
 *
 * Navnene kommer fra kjøpere. En celle som starter med `=`, `+`, `-` eller `@`
 * er en formel i Excel («=HYPERLINK(…)»), så den får en `'` foran — da vises
 * den som tekst. Telefonnummer med landskode er unntatt.
 */
export function csvCell(value: string | number | null | undefined, delimiter: string): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text) && !PHONE_LIKE.test(text)) text = `'${text}`
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(
  rows: Array<Array<string | number | null | undefined>>,
  options: { delimiter: ',' | ';'; bom: boolean },
): string {
  const body = rows.map((row) => row.map((value) => csvCell(value, options.delimiter)).join(options.delimiter)).join('\r\n')
  return `${options.bom ? BOM : ''}${body}\r\n`
}

// ─────────────────────────────────────────────────────────────
// Den vanlige fila
// ─────────────────────────────────────────────────────────────

export type ExportContact = AdsConsentFields & {
  email: string
  name: string | null
  phone: string | null
  source: string
  consent_at: string | null
  consent_text: string | null
  ads_consent_text: string | null
  last_purchase_at: string | null
  last_show: { title: string; date: string | null } | null
}

const SOURCE_LABELS: Record<string, string> = {
  purchase: 'Purchase',
  import: 'Import',
  signup: 'Sign-up',
}

export const CONTACT_EXPORT_HEADERS = [
  'Name',
  'Email',
  'Phone',
  'Source',
  'Consent date',
  'Consent text',
  'Status',
  'Unsubscribed date',
  'Ads consent',
  'Ads consent date',
  'Ads consent text',
  'Last show',
  'Last show date',
] as const

/** «2026-10-22 18:30», norsk tid — sorterbar i Excel, og uten tidssone å lure på. */
export function formatExportDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Oslo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

const ADS_LABELS: Record<AdsConsentState, string> = { active: 'Yes', withdrawn: 'Withdrawn', none: 'No' }

export function contactExportCsv(contacts: ExportContact[]): string {
  return toCsv(
    [
      [...CONTACT_EXPORT_HEADERS],
      ...contacts.map((contact) => [
        contact.name,
        contact.email,
        contact.phone,
        SOURCE_LABELS[contact.source] ?? contact.source,
        formatExportDate(contact.consent_at),
        contact.consent_text,
        contact.unsubscribed_at ? 'Unsubscribed' : 'Subscribed',
        formatExportDate(contact.unsubscribed_at),
        ADS_LABELS[adsConsentState(contact)],
        formatExportDate(contact.ads_consent_at),
        contact.ads_consent_text,
        contact.last_show?.title ?? '',
        // Showdatoen er en dato uten klokkeslett («2026-11-14»).
        contact.last_show?.date ?? '',
      ]),
    ],
    { delimiter: ';', bom: true },
  )
}

// ─────────────────────────────────────────────────────────────
// Meta
// ─────────────────────────────────────────────────────────────

/** Landskoder for land der klubber kan ligge. Brukes når et nummer står uten landskode. */
const CALLING_CODES: Record<string, string> = {
  NO: '47',
  SE: '46',
  DK: '45',
  FI: '358',
  IS: '354',
  DE: '49',
  GB: '44',
}

/** Metas regel: trim og små bokstaver. */
export function metaEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

/**
 * Bare sifre, med landskode og uten `+` — det Meta gjør før hashing.
 *
 * «+47 912 34 567» og «0047 91234567» har landskoden. «912 34 567» har den
 * ikke; da brukes klubbens land, men bare når lengden stemmer for Norge (8
 * sifre), så et utenlandsk nummer uten landskode ikke får feil prefiks.
 * Det som ikke kan bli et nummer, blir tomt — e-posten matcher fortsatt.
 */
export function metaPhone(phone: string | null | undefined, clubCountry: string | null | undefined): string {
  const raw = (phone ?? '').trim()
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')

  let international: string | null = null
  // «(+47) 912 …»: parentesen foran teller ikke.
  if (raw.replace(/^[^\d+]+/, '').startsWith('+')) international = digits
  else if (digits.startsWith('00')) international = digits.slice(2)

  if (international === null) {
    const country = (clubCountry ?? '').toUpperCase()
    const callingCode = CALLING_CODES[country]
    const national = digits.replace(/^0+/, '')
    if (!callingCode) return ''
    if (country === 'NO' && national.length !== 8) return ''
    if (national.length < 6) return ''
    international = callingCode + national
  }

  // E.164: maks 15 sifre, og ingen landskode starter med 0.
  if (international.length < 8 || international.length > 15 || international.startsWith('0')) return ''
  return international
}

function metaNamePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{M}]/gu, '')
}

/**
 * Fornavn og etternavn fra ett navnefelt: første ord og siste ord. «Ola
 * Nordmann Hansen» → ola / hansen. Ett ord er et fornavn. Små bokstaver uten
 * tegnsetting; æøå beholdes — Meta tar UTF-8 og normaliserer selv.
 */
export function metaNames(name: string | null | undefined): { fn: string; ln: string } {
  const words = (name ?? '')
    .split(/\s+/)
    .map(metaNamePart)
    .filter(Boolean)
  if (words.length === 0) return { fn: '', ln: '' }
  return { fn: words[0], ln: words.length > 1 ? words[words.length - 1] : '' }
}

export const META_EXPORT_HEADERS = ['email', 'phone', 'fn', 'ln', 'country'] as const

export type MetaContact = AdsConsentFields & {
  email: string
  name: string | null
  phone: string | null
}

/**
 * Radene i kundelista til Meta. Tar bare med kontakter med aktivt
 * annonsesamtykke, også om den får andre — filteret står her, ikke bare i
 * spørringen. Samme adresse to ganger blir én rad.
 */
export function metaAudienceRows(contacts: MetaContact[], clubCountry: string | null | undefined): string[][] {
  const country = (clubCountry ?? '').trim().toLowerCase()
  const seen = new Set<string>()
  const rows: string[][] = []
  for (const contact of contacts) {
    if (!isAdsAudience(contact)) continue
    const email = metaEmail(contact.email)
    if (!email || seen.has(email)) continue
    seen.add(email)
    const { fn, ln } = metaNames(contact.name)
    rows.push([email, metaPhone(contact.phone, clubCountry), fn, ln, /^[a-z]{2}$/.test(country) ? country : ''])
  }
  return rows
}

export function metaAudienceCsv(rows: string[][]): string {
  return toCsv([[...META_EXPORT_HEADERS], ...rows], { delimiter: ',', bom: false })
}

// ─────────────────────────────────────────────────────────────
// Filnavn
// ─────────────────────────────────────────────────────────────

/** «Oslo Comedy Club» → «oslo-comedy-club». æøå blir ae/o/a, så filnavnet er ASCII. */
export function fileSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug.slice(0, 60) || 'club'
}

export function exportFileName(clubName: string, kind: 'contacts' | 'meta', now: Date = new Date()): string {
  const day = formatExportDate(now.toISOString()).slice(0, 10)
  return `${fileSlug(clubName)}-${kind === 'meta' ? 'meta-audience' : 'contacts'}-${day}.csv`
}
