/**
 * Språk en komiker kan opptre på.
 *
 * Lagres som ISO 639-1-koder i `artists.languages`, ikke som fritekst. Feltet
 * var tidligere én tekststreng skrevet for hånd, og rakk å samle «Norsk»,
 * «Begge» og «Norsk og engelsk» for det som er samme to språk — derfor koder.
 *
 * Ren og klient-trygg: ingen server-import, siden velgeren er en
 * klientkomponent.
 */

export type LanguageCode =
  | 'no' | 'sv' | 'da' | 'fi' | 'is'
  | 'en' | 'de' | 'fr' | 'es' | 'it' | 'nl' | 'pl' | 'pt'

export interface Language {
  code: LanguageCode
  /** Engelsk navn, siden portalen er på engelsk. */
  label: string
  /** Navnet på språket selv — hjelper folk å kjenne igjen sitt eget. */
  native: string
}

export const LANGUAGES: Language[] = [
  { code: 'no', label: 'Norwegian', native: 'Norsk' },
  { code: 'sv', label: 'Swedish', native: 'Svenska' },
  { code: 'da', label: 'Danish', native: 'Dansk' },
  { code: 'fi', label: 'Finnish', native: 'Suomi' },
  { code: 'is', label: 'Icelandic', native: 'Íslenska' },
  { code: 'en', label: 'English', native: 'English' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'nl', label: 'Dutch', native: 'Nederlands' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'it', label: 'Italian', native: 'Italiano' },
  { code: 'pl', label: 'Polish', native: 'Polski' },
  { code: 'pt', label: 'Portuguese', native: 'Português' },
]

const LANGUAGE_BY_CODE = new Map(LANGUAGES.map((language) => [language.code, language]))

/**
 * Fritekst fra det gamle `language`-feltet, og fra folk som skriver språket
 * for hånd. Nøklene er små bokstaver uten diakritikk.
 */
const LANGUAGE_ALIASES: Record<string, LanguageCode[]> = {
  // Gamle verdier fra da feltet var én streng.
  begge: ['no', 'en'],
  both: ['no', 'en'],
  'norsk og engelsk': ['no', 'en'],
  'norwegian and english': ['no', 'en'],
  'norsk/engelsk': ['no', 'en'],

  norsk: ['no'], norwegian: ['no'], no: ['no'], nb: ['no'], nn: ['no'],
  bokmal: ['no'], nynorsk: ['no'],
  engelsk: ['en'], english: ['en'], en: ['en'],
  svensk: ['sv'], swedish: ['sv'], sv: ['sv'], svenska: ['sv'],
  dansk: ['da'], danish: ['da'], da: ['da'],
  finsk: ['fi'], finnish: ['fi'], fi: ['fi'], suomi: ['fi'],
  islandsk: ['is'], icelandic: ['is'], is: ['is'],
  tysk: ['de'], german: ['de'], de: ['de'], deutsch: ['de'],
  nederlandsk: ['nl'], dutch: ['nl'], nl: ['nl'],
  fransk: ['fr'], french: ['fr'], fr: ['fr'],
  spansk: ['es'], spanish: ['es'], es: ['es'],
  italiensk: ['it'], italian: ['it'], it: ['it'],
  polsk: ['pl'], polish: ['pl'], pl: ['pl'],
  portugisisk: ['pt'], portuguese: ['pt'], pt: ['pt'],
}

function fold(value: string) {
  return value
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/**
 * Tar imot koder, fritekst eller en blanding, og gir tilbake unike koder i
 * katalogrekkefølge. Ukjente verdier faller bort i stedet for å bli lagret.
 */
export function normalizeLanguages(input: string | string[] | null | undefined): LanguageCode[] {
  if (input == null) return []

  const parts = (Array.isArray(input) ? input : [input])
    .flatMap((part) => String(part).split(/[,;/|]+| og | and /i))
    .map(fold)
    .filter(Boolean)

  const found = new Set<LanguageCode>()
  for (const part of parts) {
    for (const code of LANGUAGE_ALIASES[part] ?? []) found.add(code)
  }

  return LANGUAGES.map((language) => language.code).filter((code) => found.has(code))
}

export function formatLanguages(input: string | string[] | null | undefined): string[] {
  return normalizeLanguages(input).map((code) => LANGUAGE_BY_CODE.get(code)?.label ?? code)
}

export function formatLanguageSummary(input: string | string[] | null | undefined, fallback = '') {
  const labels = formatLanguages(input)
  return labels.length > 0 ? labels.join(', ') : fallback
}
