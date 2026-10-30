/**
 * Minuttene en lineup-plass gir på scenen (`show_requirements.duration_minutes`).
 *
 * Samme grenser som sjekken i migrasjon 093. Står det ikke noe, skal varigheten
 * ikke nevnes i det hele tatt — et «Coming» i tilbudet ville sett ut som om
 * klubben har glemt noe den skulle sagt.
 */
export const MIN_SPOT_DURATION = 1
export const MAX_SPOT_DURATION = 180

/** «15 min», eller null når plassen ikke har noen varighet. */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null
  return `${Math.round(minutes)} min`
}

/** Feltet i editoren. Tomt = ikke satt. Kaster på noe som ikke er et helt antall minutter i rammen. */
export function parseDuration(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (!text) return null
  const minutes = Number(text)
  if (!Number.isInteger(minutes) || minutes < MIN_SPOT_DURATION || minutes > MAX_SPOT_DURATION) {
    throw new RangeError(`Duration must be a whole number of minutes between ${MIN_SPOT_DURATION} and ${MAX_SPOT_DURATION}.`)
  }
  return minutes
}
