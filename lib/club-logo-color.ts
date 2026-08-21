import sharp from 'sharp'
import { normalizeBrandColor, rgbToHsl, toHexColor, type Rgb } from '@/lib/club-brand'

/**
 * Henter merkevarefargen ut av en klubblogo.
 *
 * Klubben skal ikke måtte plukke farger i admin — logoen *er* fargevalget.
 * Vi ser derfor etter den mest fremtredende *kulørte* fargen i logoen, ikke
 * den vanligste fargen: de fleste logoer er stort sett hvite eller svarte
 * flater med litt farge i, og gjennomsnittet av alt blir grått.
 */

/** Piksler under dette alfanivået er bakgrunn i en PNG-logo. */
const MIN_ALPHA = 128
/** Under dette er fargen grå — ikke en merkevarefarge. */
const MIN_SATURATION = 0.18
/** Nesten hvitt eller nesten svart sier ingenting om fargeprofilen. */
const MIN_LIGHTNESS = 0.08
const MAX_LIGHTNESS = 0.94
/** 5-bits kvantisering: nyanser av samme farge havner i samme bøtte. */
const QUANT = 8

type Bucket = { count: number; r: number; g: number; b: number; saturation: number }

export async function extractLogoBrandColor(input: Buffer | Uint8Array): Promise<string | null> {
  try {
    const { data, info } = await sharp(input)
      .resize(64, 64, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const channels = info.channels
    const buckets = new Map<number, Bucket>()

    for (let i = 0; i < data.length; i += channels) {
      const alpha = channels === 4 ? data[i + 3] : 255
      if (alpha < MIN_ALPHA) continue

      const rgb: Rgb = { r: data[i], g: data[i + 1], b: data[i + 2] }
      const { s, l } = rgbToHsl(rgb)
      if (s < MIN_SATURATION || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) continue

      const key =
        (Math.floor(rgb.r / QUANT) << 10) |
        (Math.floor(rgb.g / QUANT) << 5) |
        Math.floor(rgb.b / QUANT)

      const bucket = buckets.get(key)
      if (bucket) {
        bucket.count += 1
        bucket.r += rgb.r
        bucket.g += rgb.g
        bucket.b += rgb.b
        bucket.saturation += s
      } else {
        buckets.set(key, { count: 1, r: rgb.r, g: rgb.g, b: rgb.b, saturation: s })
      }
    }

    if (buckets.size === 0) return null

    // Vekten favoriserer flate framfor renhet, men ikke så mye at en stor,
    // nesten grå flate slår en mindre, tydelig kulørt en.
    const best = [...buckets.values()].reduce((winner, bucket) => {
      const score = (candidate: Bucket) =>
        candidate.count * (0.4 + (candidate.saturation / candidate.count))
      return score(bucket) > score(winner) ? bucket : winner
    })

    const average: Rgb = {
      r: best.r / best.count,
      g: best.g / best.count,
      b: best.b / best.count,
    }

    return toHexColor(normalizeBrandColor(average))
  } catch {
    // En farge er pynt. Feiler uthentingen, faller klubbsiden tilbake på
    // Tickethalo-oransje — opplastingen av logoen skal ikke ryke av det.
    return null
  }
}
