/**
 * Hvor komikeren sendes etter registreringen, når siden hen kom fra ba om
 * det — typisk et show på klubbsiden hen ville søke på.
 *
 * Bare stier inne i portalen, samme regel som innloggingen
 * (`normalizeNext` i login/submit/route.ts). En åpen `next` ville gjort
 * registreringen til en videresending hvem som helst kunne lenke til.
 */
export function signupNext(value: string): string | null {
  if (value !== '/artist-app' && !value.startsWith('/artist-app/') && !value.startsWith('/artist-app?')) return null
  return value
}
