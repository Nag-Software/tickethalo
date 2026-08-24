/**
 * Valutaene en klubb kan selge i.
 *
 * Ikke hele ISO 4217 — lista er der for å velges fra, og 180 rader gjør et
 * søkefelt tregere å bruke, ikke bedre. De nordiske og europeiske ligger
 * øverst fordi det er der klubbene er; resten er med for turnéer og gjester.
 *
 * `name` is in English, since the list is only shown in the admin app.
 */

export type Currency = {
  /** ISO 4217. */
  code: string
  name: string
  symbol: string
}

export const CURRENCIES: Currency[] = [
  { code: 'NOK', name: 'Norwegian krone', symbol: 'kr' },
  { code: 'SEK', name: 'Swedish krona', symbol: 'kr' },
  { code: 'DKK', name: 'Danish krone', symbol: 'kr' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British pound', symbol: '£' },
  { code: 'USD', name: 'US dollar', symbol: '$' },
  { code: 'ISK', name: 'Icelandic krona', symbol: 'kr' },
  { code: 'CHF', name: 'Swiss franc', symbol: 'CHF' },
  { code: 'PLN', name: 'Polish zloty', symbol: 'zł' },
  { code: 'CZK', name: 'Czech koruna', symbol: 'Kč' },
  { code: 'HUF', name: 'Hungarian forint', symbol: 'Ft' },
  { code: 'RON', name: 'Romanian leu', symbol: 'lei' },
  { code: 'BGN', name: 'Bulgarian lev', symbol: 'лв' },
  { code: 'HRK', name: 'Croatian kuna', symbol: 'kn' },
  { code: 'RSD', name: 'Serbian dinar', symbol: 'дин' },
  { code: 'TRY', name: 'Turkish lira', symbol: '₺' },
  { code: 'UAH', name: 'Ukrainian hryvnia', symbol: '₴' },
  { code: 'CAD', name: 'Canadian dollar', symbol: '$' },
  { code: 'AUD', name: 'Australian dollar', symbol: '$' },
  { code: 'NZD', name: 'New Zealand dollar', symbol: '$' },
  { code: 'JPY', name: 'Japanese yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese yuan', symbol: '¥' },
  { code: 'HKD', name: 'Hong Kong dollar', symbol: '$' },
  { code: 'SGD', name: 'Singapore dollar', symbol: '$' },
  { code: 'KRW', name: 'South Korean won', symbol: '₩' },
  { code: 'INR', name: 'Indian rupee', symbol: '₹' },
  { code: 'THB', name: 'Thai baht', symbol: '฿' },
  { code: 'AED', name: 'UAE dirham', symbol: 'د.إ' },
  { code: 'ILS', name: 'Israeli shekel', symbol: '₪' },
  { code: 'ZAR', name: 'South African rand', symbol: 'R' },
  { code: 'BRL', name: 'Brazilian real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican peso', symbol: '$' },
  { code: 'ARS', name: 'Argentine peso', symbol: '$' },
  { code: 'CLP', name: 'Chilean peso', symbol: '$' },
]

export const DEFAULT_CURRENCY = 'NOK'

const CURRENCY_BY_CODE = new Map(CURRENCIES.map((currency) => [currency.code, currency]))

export function findCurrency(code: string | null | undefined): Currency | null {
  if (!code) return null
  return CURRENCY_BY_CODE.get(code.trim().toUpperCase()) ?? null
}

/** Unknown codes fall back to the default currency rather than failing. */
export function normalizeCurrency(code: string | null | undefined): string {
  return findCurrency(code)?.code ?? DEFAULT_CURRENCY
}

/** "NOK — Norwegian krone", the label both the trigger and the list use. */
export function formatCurrencyLabel(currency: Currency): string {
  return `${currency.code} — ${currency.name}`
}

/** Matches on code, name or symbol, ignoring accents and case. */
export function currencyMatches(currency: Currency, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true

  return (
    currency.code.toLowerCase().includes(needle) ||
    currency.name.toLowerCase().includes(needle) ||
    currency.symbol.toLowerCase().includes(needle)
  )
}
