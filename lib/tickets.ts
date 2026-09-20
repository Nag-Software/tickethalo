/** Så mange billetter én bestilling kan ta. Over dette er det gruppesalg. */
export const MAX_TICKETS_PER_ORDER = 10

/**
 * Laveste billettpris, i minste valutaenhet (10 kr).
 *
 * Stripe avviser betalinger under 3 kr, og da fikk kjøperen bare «prøv igjen
 * senere» på et show bookeren trodde var i salg. Grensen ligger godt over, så
 * provisjonen og Stripe-gebyret også gir mening. 0 er fortsatt lov: et gratis
 * show er et valg, og det selges ikke gjennom Tickethalo.
 */
export const MIN_TICKET_PRICE_MINOR = 1000

/** Satt, men for lav til å selges. 0 og tom pris er ikke «for lav». */
export function isTicketPriceBelowMinimum(priceMinor: number | null | undefined): boolean {
  if (priceMinor === null || priceMinor === undefined) return false
  if (Number.isNaN(priceMinor)) return true
  return priceMinor !== 0 && priceMinor < MIN_TICKET_PRICE_MINOR
}

/** Meldingen bookeren får. `null` når prisen er i orden. */
export function ticketPriceError(priceMinor: number | null | undefined, currency?: string | null): string | null {
  if (!isTicketPriceBelowMinimum(priceMinor)) return null
  return `The ticket price must be at least ${MIN_TICKET_PRICE_MINOR / 100} ${currency?.trim() || 'NOK'}.`
}

/**
 * Billettkoden slik den kommer inn i døra.
 *
 * QR-koden på billetten inneholder en verifiseringslenke, ikke koden alene —
 * en skanner gir derfor tilbake hele URL-en. Personalet kan i tillegg taste
 * koden manuelt, og da kommer den gjerne med bindestreken den vises med, eller
 * med mellomrom. Begge veier må ende på det samme.
 */
export function extractTicketCode(raw: string): string {
  const text = raw.trim()
  if (!text) return ''

  const query = text.match(/[?&]code=([^&\s]+)/i)
  if (query) {
    try {
      return decodeURIComponent(query[1]).trim()
    } catch {
      return query[1].trim()
    }
  }

  // En lenke uten `code` har koden sist i stien: /tickets/verify/<kode>.
  if (/^https?:\/\//i.test(text)) {
    const lastSegment = text.split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop()
    return (lastSegment ?? '').trim()
  }

  return stripSeparators(text)
}

/** Bindestrek og mellomrom er lesehjelp, ikke en del av koden. */
function stripSeparators(value: string) {
  return value.replace(/[\s-]+/g, '')
}

/**
 * Koden slik den skal leses: `A1B2-C3D4`.
 *
 * Grupperingen er der for at den skal kunne leses opp og skrives ned uten å
 * miste tellingen. Gamle 32-tegns koder grupperes ikke — de er ikke ment for
 * å skrives inn, og et gitter av åtte grupper hjelper ingen.
 */
export function formatTicketCode(code: string | null | undefined) {
  const value = (code ?? '').trim()
  if (value.length !== 8) return value

  return `${value.slice(0, 4)}-${value.slice(4)}`
}

/**
 * Kandidatene et oppslag på en billettkode skal matche eksakt.
 *
 * Koden lagres som små heksadesimaler, men kan tastes inn med store
 * bokstaver. `ilike` ville løst det — og samtidig gjort `%` og `_` til
 * jokertegn, slik at en delvis kjent kode kunne truffet en annens billett.
 * Eksakt match mot noen få varianter er både trygt og presist.
 */
export function ticketCodeCandidates(raw: string): string[] {
  const code = extractTicketCode(raw)
  if (!code) return []

  // Nye koder er store bokstaver, gamle er små heksadesimaler, og en som
  // taster inn gjetter uansett.
  return [...new Set([code, code.toLowerCase(), code.toUpperCase()])]
}
