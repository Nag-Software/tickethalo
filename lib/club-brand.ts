/**
 * Fargelogikken bak klubbsidene.
 *
 * En klubb setter ikke farger for hånd — de hentes ut av logoen ved
 * opplasting (se `lib/club-logo-color.ts`) og lagres som `clubs.brand_color`.
 * Denne fila oversetter den ene hex-verdien til de `--ev-*`-variablene den
 * offentlige flaten allerede leser, slik at klubbsiden bruker nøyaktig samme
 * komponenter som forsiden — bare i klubbens farge.
 *
 * Ingen React- eller Node-avhengigheter her: både server og klient bruker den.
 */

export type Rgb = { r: number; g: number; b: number }
export type Hsl = { h: number; s: number; l: number }

/** Standardflaten fra globals.css, som kontrastene måles mot. */
const SURFACE_BG: Rgb = { r: 255, g: 254, b: 251 } // --ev-bg
const INK_LIGHT: Rgb = { r: 255, g: 244, b: 236 } // --ev-accent-ink på mørk fyllfarge
const INK_DARK: Rgb = { r: 46, g: 12, b: 1 } // --ev-accent-ink på lys fyllfarge

/** WCAG AA for brødtekst. Aksentfargen brukes til små tekster og må tåle det. */
const TEXT_CONTRAST_TARGET = 4.5

export function parseHexColor(value: string | null | undefined): Rgb | null {
  if (!value) return null
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!match) return null

  const hex = match[1].length === 3
    ? match[1].split('').map((char) => char + char).join('')
    : match[1]

  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
  }
}

export function toHexColor({ r, g, b }: Rgb): string {
  const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min
  const l = (max + min) / 2

  if (delta === 0) return { h: 0, s: 0, l }

  const s = delta / (1 - Math.abs(2 * l - 1))
  const h = max === rn
    ? 60 * (((gn - bn) / delta) % 6)
    : max === gn
      ? 60 * ((bn - rn) / delta + 2)
      : 60 * ((rn - gn) / delta + 4)

  return { h: (h + 360) % 360, s, l }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] :
    hp < 2 ? [x, c, 0] :
    hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] :
    hp < 5 ? [x, 0, c] :
             [c, 0, x]

  const m = l - c / 2
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 }
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/** Blekkfargen som leser best oppå `fill`. */
export function readableInkOn(fill: Rgb): Rgb {
  return contrastRatio(fill, INK_LIGHT) >= contrastRatio(fill, INK_DARK) ? INK_LIGHT : INK_DARK
}

/**
 * Mørkner (eller lysner) fargen i HSL til den når kontrastkravet mot
 * bakgrunnen. Fargetonen og metningen holdes — det er den som gjør at teksten
 * fortsatt leses som klubbens farge.
 */
export function ensureContrast(color: Rgb, against: Rgb, target = TEXT_CONTRAST_TARGET): Rgb {
  if (contrastRatio(color, against) >= target) return color

  const hsl = rgbToHsl(color)
  const goDarker = relativeLuminance(against) > 0.18
  const step = goDarker ? -0.02 : 0.02

  let candidate = color
  for (let l = hsl.l + step; l >= 0 && l <= 1; l += step) {
    candidate = hslToRgb({ ...hsl, l })
    if (contrastRatio(candidate, against) >= target) return candidate
  }

  return candidate
}

/**
 * Trekker fargen inn i et område der den fungerer som flatefarge: ikke så lys
 * at hvit tekst ryker, ikke så mørk at den er svart, ikke så grå at det ikke
 * lenger er en merkevarefarge.
 */
export function normalizeBrandColor(color: Rgb): Rgb {
  const { h, s, l } = rgbToHsl(color)
  return hslToRgb({
    h,
    s: clamp(s, 0.32, 0.95),
    l: clamp(l, 0.3, 0.62),
  })
}

export type ClubBrand = {
  /** Flatefarge — knapper, pill-er, tonede bånd. */
  fill: string
  /** Tekst oppå `fill`. */
  ink: string
  /** Aksenttekst på sidens egen bakgrunn, AA-sikret. */
  accent: string
  /** Hårfin bakgrunnstone, til hero-båndet. */
  wash: string
  /** Litt sterkere tone, til kanter og hover. */
  washStrong: string
}

const DEFAULT_BRAND: ClubBrand = {
  fill: '#ff5b24',
  ink: '#fff4ec',
  accent: '#b23004',
  wash: 'rgba(255, 91, 36, 0.08)',
  washStrong: 'rgba(255, 91, 36, 0.16)',
}

/** Hele fargesettet for én klubb. Ugyldig eller manglende farge → Tickethalo-oransje. */
export function clubBrand(brandColor: string | null | undefined): ClubBrand {
  const parsed = parseHexColor(brandColor)
  if (!parsed) return DEFAULT_BRAND

  const fill = normalizeBrandColor(parsed)
  const accent = ensureContrast(fill, SURFACE_BG)
  const { r, g, b } = fill

  return {
    fill: toHexColor(fill),
    ink: toHexColor(readableInkOn(fill)),
    accent: toHexColor(accent),
    wash: `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0.08)`,
    washStrong: `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 0.16)`,
  }
}

/**
 * Overstyringene som legges på `.ev-surface`-scopet. Kortene, knappene og
 * chip-ene på klubbsiden leser de samme variablene som på forsiden, så dette
 * er alt som skal til for å farge hele siden.
 */
export function clubBrandStyle(brandColor: string | null | undefined): Record<string, string> {
  const brand = clubBrand(brandColor)
  return {
    '--ev-accent-fill': brand.fill,
    '--ev-accent-ink': brand.ink,
    '--ev-accent': brand.accent,
    '--club-wash': brand.wash,
    '--club-wash-strong': brand.washStrong,
  }
}
