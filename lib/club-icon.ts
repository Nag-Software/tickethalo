import { createHash } from 'node:crypto'
import sharp from 'sharp'

/**
 * Klubblogoen som ikon på klubbens Stripe-konto.
 *
 * Stripe Checkout viser kontoens ikon ved siden av navnet øverst på siden,
 * og for direct charges er det klubbens konto som gjelder. Klubben har ingen
 * tilgang til å laste opp ikonet selv i Express — det er plattformens jobb.
 * Logoen i Tickethalo er derfor kilden, og dette er oversettelsen til det
 * Stripe godtar: kvadratisk, minst 128 px, PNG under 512 kB.
 */

/** Stripes grense for `business_icon`. */
export const CLUB_ICON_MAX_BYTES = 512 * 1024

/** Størst først. Neste steg tas bare når fila ellers blir for stor. */
const ICON_SIZES = [512, 256, 128] as const

/**
 * Filnavnet Stripe får, med et fingeravtrykk av logo-adressen i seg.
 *
 * Hver opplasting i Tickethalo får en ny adresse, så adressen sier hvilken
 * logo fila ble laget av. Slik kan synken lese navnet på ikonet Stripe har
 * og se om det er dagens logo — uten en ekstra kolonne i databasen.
 */
export function clubIconFilename(club: { id: string; logo_url: string }): string {
  const fingerprint = createHash('sha256').update(club.logo_url).digest('hex').slice(0, 16)
  return `tickethalo-club-${club.id}-${fingerprint}.png`
}

/**
 * Henter logoen og gjør den til et kvadratisk PNG-ikon.
 *
 * Logoen legges midt i kvadratet med gjennomsiktig kant rundt, så en bred
 * logo ikke blir klemt. Et for detaljert bilde prøves i mindre størrelser
 * før vi gir opp. Kaster når logoen ikke kan hentes eller ikke får plass.
 */
export async function buildClubIcon(logoUrl: string): Promise<Buffer> {
  const response = await fetch(logoUrl)
  if (!response.ok) throw new Error(`Could not download the club logo (${response.status})`)
  const source = Buffer.from(await response.arrayBuffer())

  for (const size of ICON_SIZES) {
    const png = await sharp(source)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer()
    if (png.length <= CLUB_ICON_MAX_BYTES) return png
  }

  throw new Error(`The club logo does not fit Stripe's ${CLUB_ICON_MAX_BYTES / 1024} KB icon limit`)
}
