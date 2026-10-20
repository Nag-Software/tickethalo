/**
 * Avmelding fra en klubbs e-postliste.
 *
 * Hver kontakt har sin egen token (migrasjon 077). Den står i to adresser:
 *
 * - `/unsubscribe/<token>` — lenken nederst i e-posten. Siden har én knapp.
 *   Å åpne lenken melder ikke av: Outlook Safe Links og andre skannere åpner
 *   alle lenker i en e-post før mottakeren gjør det, og ville meldt av folk
 *   som aldri trykket.
 * - `/api/unsubscribe/<token>` — `List-Unsubscribe`-headeren. Gmail og Apple
 *   Mail viser sin egen «Unsubscribe»-knapp og sender en POST hit (RFC 8058).
 *   Den melder av med en gang; en skanner sender ikke POST.
 *
 * Ingen Node-avhengigheter: siden og malen bruker den samme.
 */

const TOKEN_PATTERN = /^[0-9a-f]{64}$/

export function isUnsubscribeToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value)
}

function trimOrigin(origin: string) {
  return origin.replace(/\/$/, '')
}

export function unsubscribePageUrl(origin: string, token: string) {
  return `${trimOrigin(origin)}/unsubscribe/${token}`
}

export function oneClickUnsubscribeUrl(origin: string, token: string) {
  return `${trimOrigin(origin)}/api/unsubscribe/${token}`
}

/**
 * Headerne Gmail og Yahoo krever for masseutsendelser siden 2024. Uten dem
 * havner e-posten oftere i søppelposten, og mottakeren som vil ut trykker
 * «Spam» i stedet — som skader klubbens og vårt domene.
 */
export function listUnsubscribeHeaders(origin: string, token: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${oneClickUnsubscribeUrl(origin, token)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

/**
 * «c•••••@nagsoftware.no». Avmeldingssiden er åpen for alle med lenken, så
 * den viser nok til at personen kjenner igjen adressen, men ikke hele.
 */
export function maskEmail(email: string) {
  const at = email.lastIndexOf('@')
  if (at < 1) return '•••'
  const local = email.slice(0, at)
  return `${local[0]}${'•'.repeat(Math.min(Math.max(local.length - 1, 3), 8))}${email.slice(at)}`
}

/** Tokenen i en avmeldingslenke, for å lage one-click-adressen ut fra den lagrede siden. */
export function tokenFromUnsubscribeUrl(url: string | null | undefined): string | null {
  const token = url?.match(/\/unsubscribe\/([0-9a-f]{64})\/?$/)?.[1]
  return token ?? null
}
