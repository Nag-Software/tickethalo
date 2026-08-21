/**
 * Valutaene en klubb kan selge i.
 *
 * Ikke hele ISO 4217 — lista er der for å velges fra, og 180 rader gjør et
 * søkefelt tregere å bruke, ikke bedre. De nordiske og europeiske ligger
 * øverst fordi det er der klubbene er; resten er med for turnéer og gjester.
 *
 * `name` er på norsk, siden lista bare vises i admin-appen.
 */

export type Currency = {
  /** ISO 4217. */
  code: string
  name: string
  symbol: string
}

export const CURRENCIES: Currency[] = [
  { code: 'NOK', name: 'Norske kroner', symbol: 'kr' },
  { code: 'SEK', name: 'Svenske kroner', symbol: 'kr' },
  { code: 'DKK', name: 'Danske kroner', symbol: 'kr' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'Britiske pund', symbol: '£' },
  { code: 'USD', name: 'Amerikanske dollar', symbol: '$' },
  { code: 'ISK', name: 'Islandske kroner', symbol: 'kr' },
  { code: 'CHF', name: 'Sveitsiske franc', symbol: 'CHF' },
  { code: 'PLN', name: 'Polske zloty', symbol: 'zł' },
  { code: 'CZK', name: 'Tsjekkiske koruna', symbol: 'Kč' },
  { code: 'HUF', name: 'Ungarske forint', symbol: 'Ft' },
  { code: 'RON', name: 'Rumenske leu', symbol: 'lei' },
  { code: 'BGN', name: 'Bulgarske lev', symbol: 'лв' },
  { code: 'HRK', name: 'Kroatiske kuna', symbol: 'kn' },
  { code: 'RSD', name: 'Serbiske dinar', symbol: 'дин' },
  { code: 'TRY', name: 'Tyrkiske lira', symbol: '₺' },
  { code: 'UAH', name: 'Ukrainske hryvnia', symbol: '₴' },
  { code: 'CAD', name: 'Kanadiske dollar', symbol: '$' },
  { code: 'AUD', name: 'Australske dollar', symbol: '$' },
  { code: 'NZD', name: 'New Zealand-dollar', symbol: '$' },
  { code: 'JPY', name: 'Japanske yen', symbol: '¥' },
  { code: 'CNY', name: 'Kinesiske yuan', symbol: '¥' },
  { code: 'HKD', name: 'Hongkong-dollar', symbol: '$' },
  { code: 'SGD', name: 'Singapore-dollar', symbol: '$' },
  { code: 'KRW', name: 'Sørkoreanske won', symbol: '₩' },
  { code: 'INR', name: 'Indiske rupi', symbol: '₹' },
  { code: 'THB', name: 'Thailandske baht', symbol: '฿' },
  { code: 'AED', name: 'Emiratdirham', symbol: 'د.إ' },
  { code: 'ILS', name: 'Israelske shekel', symbol: '₪' },
  { code: 'ZAR', name: 'Sørafrikanske rand', symbol: 'R' },
  { code: 'BRL', name: 'Brasilianske real', symbol: 'R$' },
  { code: 'MXN', name: 'Meksikanske peso', symbol: '$' },
  { code: 'ARS', name: 'Argentinske peso', symbol: '$' },
  { code: 'CLP', name: 'Chilenske peso', symbol: '$' },
]

export const DEFAULT_CURRENCY = 'NOK'

const CURRENCY_BY_CODE = new Map(CURRENCIES.map((currency) => [currency.code, currency]))

export function findCurrency(code: string | null | undefined): Currency | null {
  if (!code) return null
  return CURRENCY_BY_CODE.get(code.trim().toUpperCase()) ?? null
}

/** Ukjente koder faller tilbake på standardvalutaen framfor å feile. */
export function normalizeCurrency(code: string | null | undefined): string {
  return findCurrency(code)?.code ?? DEFAULT_CURRENCY
}

/** «NOK — Norske kroner», etiketten både trigger og liste bruker. */
export function formatCurrencyLabel(currency: Currency): string {
  return `${currency.code} — ${currency.name}`
}

/** Treff på kode, navn eller symbol, uten hensyn til aksenter og store bokstaver. */
export function currencyMatches(currency: Currency, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true

  return (
    currency.code.toLowerCase().includes(needle) ||
    currency.name.toLowerCase().includes(needle) ||
    currency.symbol.toLowerCase().includes(needle)
  )
}
