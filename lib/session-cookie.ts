/**
 * Lesing av Supabase-sesjonscookien uten å spørre Supabase.
 *
 * Proxyen fornyet sesjonen på *hver* request, inkludert hver RSC-navigering.
 * Kallet går over nett og koster 200–300 ms. Access-tokenet lever en time, så
 * runden er bare verdt å bruke når tokenet nærmer seg utløp — resten av tiden
 * holder det å lese utløpstidspunktet ut av cookien vi allerede har.
 *
 * Alt her feiler mot «spør Supabase»: klarer vi ikke lese cookien, oppfører
 * proxyen seg som før.
 */

const BASE64_PREFIX = 'base64-'

/** Sekunder før utløp der det er verdt å bruke en runde på fornying. */
const REFRESH_MARGIN_SECONDS = 120

/** base64url → base64. `atob` i V8 tåler at padding mangler, og det gjør den. */
function decodeBase64Url(value: string) {
  return atob(value.replace(/-/g, '+').replace(/_/g, '/'))
}

/**
 * Når sesjonen i cookien utløper, i sekunder siden epoch.
 * `null` betyr «vet ikke».
 */
export function getSessionExpiry(cookieValue: string): number | null {
  try {
    const raw = cookieValue.startsWith(BASE64_PREFIX)
      ? decodeBase64Url(cookieValue.slice(BASE64_PREFIX.length))
      : cookieValue

    const session = JSON.parse(raw) as { expires_at?: unknown; access_token?: unknown }

    if (typeof session.expires_at === 'number') return session.expires_at

    // Eldre cookies har ikke `expires_at` — da leser vi `exp` ut av JWT-en.
    if (typeof session.access_token === 'string') {
      const payload = session.access_token.split('.')[1]
      if (!payload) return null

      const claims = JSON.parse(decodeBase64Url(payload)) as { exp?: unknown }
      if (typeof claims.exp === 'number') return claims.exp
    }

    return null
  } catch {
    return null
  }
}

/** Skal proxyen bruke en runde til Supabase på å fornye sesjonen nå? */
export function needsSessionRefresh(cookieValue: string, now = Date.now()): boolean {
  const expiresAt = getSessionExpiry(cookieValue)
  if (expiresAt === null) return true

  return expiresAt - REFRESH_MARGIN_SECONDS <= Math.floor(now / 1000)
}
