import sharp from 'sharp'
import { rgbToHsl, toHexColor, type Rgb } from '@/lib/club-brand'
import { paletteFromColors, paletteFromSeed, DEFAULT_MARKETING_SEED } from '@/lib/marketing/palette'
import type { MarketingPalette } from '@/types/database'

/**
 * Plukker de mest fremtredende *kulørte* fargene ut av et bilde.
 *
 * Samme idé som `lib/club-logo-color.ts`, men den returnerer én farge til
 * klubbsiden. Her trenger vi flere, og de må være ulike nok til å bli en
 * palett: to nyanser av samme rødt er ikke et fargevalg.
 */

const MIN_ALPHA = 128
const MIN_SATURATION = 0.16
const MIN_LIGHTNESS = 0.06
const MAX_LIGHTNESS = 0.95
/** 5-bits kvantisering: nyanser av samme farge havner i samme bøtte. */
const QUANT = 8
/** Under så mange grader fra hverandre er to farger «samme farge». */
const MIN_HUE_DISTANCE = 28

type Bucket = { count: number; r: number; g: number; b: number; saturation: number }

function hueDistance(a: number, b: number) {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}

export async function extractImageColors(input: Buffer | Uint8Array, limit = 4): Promise<string[]> {
  const { data, info } = await sharp(input)
    .resize(96, 96, { fit: 'inside', withoutEnlargement: true })
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

  // Vekten favoriserer flate framfor renhet, men ikke så mye at en stor,
  // nesten grå flate slår en mindre, tydelig kulørt en.
  const ranked = [...buckets.values()]
    .sort((a, b) => (b.count * (0.4 + b.saturation / b.count)) - (a.count * (0.4 + a.saturation / a.count)))
    .map((bucket) => ({
      rgb: { r: bucket.r / bucket.count, g: bucket.g / bucket.count, b: bucket.b / bucket.count },
    }))

  const picked: Array<{ hex: string; hue: number }> = []
  for (const candidate of ranked) {
    const { h } = rgbToHsl(candidate.rgb)
    if (picked.some((chosen) => hueDistance(chosen.hue, h) < MIN_HUE_DISTANCE)) continue
    picked.push({ hex: toHexColor(candidate.rgb), hue: h })
    if (picked.length >= limit) break
  }

  return picked.map((entry) => entry.hex)
}

async function colorsFromUrl(url: string | null | undefined): Promise<string[]> {
  if (!url) return []
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return []
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) return []
    return await extractImageColors(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.warn('[Marketing] Could not read colours from', url, error)
    return []
  }
}

/**
 * Foreslår en palett for et show.
 *
 * Kildene i prioritert rekkefølge: den valgte malen (den *er* designet),
 * så plakaten som allerede ligger på showet, så klubbens logo. Finner vi
 * ingenting brukbart, utledes paletten fra klubbens farge.
 */
export async function suggestPalette(sources: {
  templateUrl?: string | null
  posterUrl?: string | null
  clubLogoUrl?: string | null
  clubBrandColor?: string | null
}): Promise<{ palette: MarketingPalette; source: 'template' | 'poster' | 'logo' | 'brand' }> {
  const ordered: Array<{ source: 'template' | 'poster' | 'logo'; url: string | null | undefined }> = [
    { source: 'template', url: sources.templateUrl },
    { source: 'poster', url: sources.posterUrl },
    { source: 'logo', url: sources.clubLogoUrl },
  ]

  for (const candidate of ordered) {
    const colors = await colorsFromUrl(candidate.url)
    if (colors.length > 0) {
      return { palette: paletteFromColors(colors), source: candidate.source }
    }
  }

  return {
    palette: paletteFromSeed(sources.clubBrandColor ?? DEFAULT_MARKETING_SEED),
    source: 'brand',
  }
}
