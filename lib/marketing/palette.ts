/**
 * Merkevarefargene et show markedsføres i.
 *
 * Klubben har allerede én farge (`clubs.brand_color`, hentet ut av logoen).
 * Plakater og eksportfiler trenger tre: en flatefarge, en mørk motvekt og en
 * aksent som løfter datoen og billettlenken. Denne fila utleder de tre fra én,
 * slik at «foreslå farger» alltid har noe å svare med — også for en klubb som
 * aldri har lastet opp en logo.
 *
 * Ingen Node-avhengigheter: både server og klient bruker den. Uthenting av
 * farger fra en bildefil ligger i `lib/marketing/palette-extract.ts`, som er
 * server-only fordi den bruker sharp.
 */

import {
  contrastRatio,
  ensureContrast,
  hslToRgb,
  normalizeBrandColor,
  parseHexColor,
  readableInkOn,
  rgbToHsl,
  toHexColor,
  type Rgb,
} from '@/lib/club-brand'
import type { MarketingPalette } from '@/types/database'

/** Tickethalo-oransje. Brukes når klubben verken har logo eller valgt farge. */
export const DEFAULT_MARKETING_SEED = '#ff5b24'

const SURFACE_DARK: Rgb = { r: 18, g: 14, b: 12 }

export const MARKETING_PALETTE_ROLES = [
  { key: 'primary', label: 'Primary', hint: 'Flatefarge — bakgrunn, bånd og knapper.' },
  { key: 'secondary', label: 'Secondary', hint: 'Mørk motvekt — tekstflater og dybde.' },
  { key: 'accent', label: 'Accent', hint: 'Blikkfang — dato, pris og billettlenke.' },
] as const satisfies ReadonlyArray<{ key: keyof MarketingPalette; label: string; hint: string }>

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && parseHexColor(value) !== null
}

/** Normaliserer «#ABC», «abcdef» og liknende til «#aabbcc». */
export function normalizeHex(value: string | null | undefined, fallback: string): string {
  const parsed = parseHexColor(value)
  return parsed ? toHexColor(parsed) : fallback
}

/**
 * Bygger de tre fargene ut fra én frøfarge.
 *
 * Sekundærfargen er samme kulør trukket mot mørkt, slik at den leses som
 * «samme merkevare». Aksenten flyttes 150° rundt fargesirkelen — nok til å
 * skille seg fra primærfargen uten å bli det rene komplementet, som ofte
 * vibrerer stygt i trykk.
 */
export function paletteFromSeed(seed: string | null | undefined): MarketingPalette {
  const parsed = parseHexColor(seed) ?? parseHexColor(DEFAULT_MARKETING_SEED)!
  const primary = normalizeBrandColor(parsed)
  const { h, s } = rgbToHsl(primary)

  const secondary = hslToRgb({
    h: (h + 12) % 360,
    s: Math.min(0.9, Math.max(0.35, s * 0.85)),
    l: 0.16,
  })

  const accentBase = hslToRgb({
    h: (h + 150) % 360,
    s: Math.min(0.98, Math.max(0.6, s + 0.18)),
    l: 0.54,
  })

  return {
    primary: toHexColor(primary),
    secondary: toHexColor(secondary),
    accent: toHexColor(ensureContrast(accentBase, SURFACE_DARK, 3)),
  }
}

/**
 * Setter sammen en palett av farger som faktisk er plukket ut av et bilde.
 * Er det bare én brukbar farge, faller de to andre tilbake på utledningen.
 */
export function paletteFromColors(colors: string[]): MarketingPalette {
  const valid = colors.filter(isHexColor)
  if (valid.length === 0) return paletteFromSeed(DEFAULT_MARKETING_SEED)

  const derived = paletteFromSeed(valid[0])
  if (valid.length === 1) return derived

  // Den mørkeste brukbare fargen blir sekundær, den mest kulørte som ikke er
  // primærfargen blir aksent. Da speiler paletten bildet i stedet for regelen.
  const rgbs = valid.map((hex) => ({ hex, rgb: parseHexColor(hex)! }))
  const primary = rgbs[0]
  const rest = rgbs.slice(1)

  const darkest = [...rest].sort((a, b) => rgbToHsl(a.rgb).l - rgbToHsl(b.rgb).l)[0]
  const mostSaturated = [...rest]
    .filter((c) => c.hex !== darkest?.hex)
    .sort((a, b) => rgbToHsl(b.rgb).s - rgbToHsl(a.rgb).s)[0]

  const secondary = darkest && rgbToHsl(darkest.rgb).l < 0.42
    ? toHexColor(hslToRgb({ ...rgbToHsl(darkest.rgb), l: Math.min(0.22, rgbToHsl(darkest.rgb).l) }))
    : derived.secondary

  const accentCandidate = mostSaturated?.rgb
  const accent = accentCandidate && contrastRatio(accentCandidate, primary.rgb) > 1.6
    ? toHexColor(ensureContrast(accentCandidate, SURFACE_DARK, 3))
    : derived.accent

  return { primary: toHexColor(normalizeBrandColor(primary.rgb)), secondary, accent }
}

/** Leser en palett fra databasen. Ugyldige eller manglende felter fylles inn. */
export function resolvePalette(
  stored: unknown,
  clubBrandColor?: string | null,
): MarketingPalette {
  const fallback = paletteFromSeed(clubBrandColor ?? DEFAULT_MARKETING_SEED)
  if (!stored || typeof stored !== 'object') return fallback

  const raw = stored as Partial<Record<keyof MarketingPalette, unknown>>
  return {
    primary: normalizeHex(raw.primary as string, fallback.primary),
    secondary: normalizeHex(raw.secondary as string, fallback.secondary),
    accent: normalizeHex(raw.accent as string, fallback.accent),
  }
}

/** Tekstfargen som leser best oppå en av palettfargene. */
export function inkOn(hex: string): string {
  const parsed = parseHexColor(hex)
  return parsed ? toHexColor(readableInkOn(parsed)) : '#ffffff'
}

/** `rgba(...)`-variant, til hårfine bakgrunner i admin-flaten. */
export function tint(hex: string, alpha: number): string {
  const parsed = parseHexColor(hex)
  if (!parsed) return 'transparent'
  const { r, g, b } = parsed
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`
}

/** Palettens farger som en linje AI-en kan lese i plakatprompten. */
export function palettePromptLine(palette: MarketingPalette): string {
  return [
    `Primary surface colour ${palette.primary}`,
    `secondary/dark colour ${palette.secondary}`,
    `accent colour ${palette.accent} for date, price and ticket call-to-action`,
  ].join(', ')
}
