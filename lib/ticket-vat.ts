/**
 * Moms på billettsalget, per land.
 *
 * I Norge er adgang til kulturarrangement unntatt mva (mval. § 3-7), så
 * hovedboken har aldri kjent til moms. Danmark legger 25 % på billetter til
 * teater, konserter og lignende (momsloven § 13 stk. 1 nr. 6 unntar dem
 * ikke), Sverige 6 % (tillträde till föreställning). Komikerens eget honorar
 * er momsfritt i alle tre land.
 *
 * Prisen klubben setter er prisen publikum betaler, inkl. moms. Momsen
 * regnes *ut av* beløpet, aldri oppå. Den rører ikke kontantstrømmen —
 * klubben får fortsatt brutto minus provisjon utbetalt og gjør opp momsen
 * selv — men den skal ut av honorargrunnlaget: komikerne deler klubbens
 * inntekt, ikke pengene som skal videre til skattemyndigheten.
 *
 * Satsen står på klubben (`clubs.ticket_vat_bps`) og settes fra landet, men
 * kan overstyres: en dansk forening eller svensk ideell förening kan være
 * momsfri. Beløpet låses på ordren ved kjøpet (`orders.ticket_vat_amount`,
 * migrasjon 068), samme regel som provisjonen: en satsendring gjelder neste
 * kjøp og rører ikke ordrer som alt er betalt.
 */

export const CLUB_COUNTRIES = [
  { code: 'NO', label: 'Norge', ticketVatBps: 0, currency: 'NOK' },
  { code: 'DK', label: 'Danmark', ticketVatBps: 2500, currency: 'DKK' },
  { code: 'SE', label: 'Sverige', ticketVatBps: 600, currency: 'SEK' },
] as const

export type ClubCountryCode = (typeof CLUB_COUNTRIES)[number]['code']

export const DEFAULT_CLUB_COUNTRY: ClubCountryCode = 'NO'

/** Ingen europeisk standardsats er over 27 %. Mer enn dette er en skrivefeil. */
export const MAX_TICKET_VAT_PERCENT = 30

export function isClubCountry(value: string): value is ClubCountryCode {
  return CLUB_COUNTRIES.some((country) => country.code === value)
}

function countryEntry(code: string) {
  return CLUB_COUNTRIES.find((country) => country.code === code) ?? CLUB_COUNTRIES[0]
}

/** Standardsatsen for landet. Ukjent land regnes som Norge: 0. */
export function defaultTicketVatBps(country: string): number {
  return countryEntry(country).ticketVatBps
}

/** Valutaen en ny klubb i landet selger i. */
export function defaultCurrencyFor(country: string): string {
  return countryEntry(country).currency
}

export function clubCountryLabel(country: string): string {
  return countryEntry(country).label
}

/**
 * Momsen som ligger inne i et beløp inkl. moms. 200 DKK med 25 % er 160 + 40,
 * ikke 200 + 50. Samme formel som `complete_checkout_order` bruker når
 * ordren skrives, så siden og hovedboken aldri kan være uenige.
 */
export function vatIncludedIn(grossAmount: number, bps: number): number {
  if (bps <= 0 || grossAmount <= 0) return 0
  return Math.round((grossAmount * bps) / (10000 + bps))
}

export type CountryInput = { country: ClubCountryCode } | { error: string }

export function parseClubCountry(raw: FormDataEntryValue | null | undefined): CountryInput {
  const text = String(raw ?? '').trim().toUpperCase()
  if (!text) return { error: 'Land er påkrevd.' }
  if (!isClubCountry(text)) return { error: 'Landet støttes ikke ennå.' }
  return { country: text }
}

export type VatInput = { bps: number } | { error: string }

/** «25», «6» og «0» er alle gyldige, også med komma. Avrundes til hundredels prosent. */
export function parseVatPercent(raw: FormDataEntryValue | null | undefined): VatInput {
  const text = String(raw ?? '').trim().replace(',', '.')
  if (!text) return { error: 'Momssats er påkrevd. Skriv 0 når billettene er momsfrie.' }

  const percent = Number(text)
  if (!Number.isFinite(percent)) return { error: 'Momssatsen må være et tall.' }
  if (percent < 0 || percent > MAX_TICKET_VAT_PERCENT) {
    return { error: `Momssatsen må være mellom 0 og ${MAX_TICKET_VAT_PERCENT} %.` }
  }

  return { bps: Math.round(percent * 100) }
}

/** 2500 → «25», 600 → «6». Til skjemaets startverdi og til tekst. */
export function formatVatPercent(bps: number): string {
  return String(bps / 100)
}

// ─────────────────────────────────────────────────────────────
// Hva som står på kvitteringen og i vilkårene
// ─────────────────────────────────────────────────────────────

/** Hva foretaksnummeret heter der klubben er: «CVR-nr» i Danmark, «Org.nr» ellers. */
export function orgNumberLabel(country: string | null | undefined, locale: 'nb' | 'en' = 'nb'): string {
  if (country === 'DK') return 'CVR-nr'
  return locale === 'en' ? 'Org. no.' : 'Org.nr'
}

/**
 * Momssetningen på kvitteringen. Norske billetter er unntatt mva, og det
 * skal stå med hjemmel, slik det alltid har gjort. Billetter med moms sier
 * hvor mye som ligger i prisen — prisen kunden så er fortsatt prisen kunden
 * betalte.
 */
export function receiptVatNote(
  seller: { ticket_vat_bps?: number | null },
  locale: 'nb' | 'en' = 'nb',
): string {
  const bps = seller.ticket_vat_bps ?? 0
  if (bps > 0) {
    const percent = formatVatPercent(bps)
    return locale === 'en'
      ? `The ticket price includes ${percent}% VAT.`
      : `Billettprisen er inkl. ${percent} % moms.`
  }
  return locale === 'en'
    ? 'No VAT is added to the ticket price — admission to a cultural event is outside the scope of Norwegian VAT (mval. § 3-7).'
    : 'Billettprisen er uten merverdiavgift — adgang til kulturarrangement er unntatt mva. (mval. § 3-7).'
}
