import { hslToRgb, parseHexColor, readableInkOn, rgbToHsl, toHexColor } from '@/lib/club-brand'
import {
  POSTER_CANVAS,
  type NormBox,
  type PosterFontId,
  type PosterLayout,
  type PosterTextField,
  type PosterTextStyle,
} from '@/lib/poster/layout'
import type { MarketingPalette } from '@/types/database'

/**
 * De innebygde layoutene — brukt når klubben ikke har valgt en mal.
 *
 * All tekst står på flater i klubbens egne farger, aldri rett på bakgrunnen.
 * Bakgrunnen kommer fra en bildemodell og kan være hva som helst; teksten skal
 * være lesbar uansett. Bakgrunnen synes i margene og mellom rutene, og det er
 * nok til å gi plakaten sitt preg.
 *
 * Layouten velges av lineupen: én headliner gir en stor hovedrute med navnet
 * ved siden av, flere (eller ingen) gir én felles rad. Rutene i raden tegnes
 * av koden, så antallet følger lineupen.
 */

const MARGIN = 0.06
const TITLE_FONTS: PosterFontId[] = ['anton', 'archivo-black', 'fredoka', 'bebas-neue', 'dm-serif-display', 'oswald']

/** Skriften som passer til titlene: smal til smal, rund til rund. */
const BODY_FONT: Record<PosterFontId, PosterFontId> = {
  anton: 'oswald',
  'archivo-black': 'geist',
  fredoka: 'fredoka',
  'bebas-neue': 'oswald',
  'dm-serif-display': 'geist',
  oswald: 'oswald',
  geist: 'geist',
}

function ink(hexColor: string): string {
  const parsed = parseHexColor(hexColor)
  return parsed ? toHexColor(readableInkOn(parsed)) : '#ffffff'
}

/** Lyse, avdempede varianter av merkevarefargene — flatene bak bildene. */
function frameFills(palette: MarketingPalette): string[] {
  return [palette.primary, palette.accent, palette.primary].map((hexColor, index) => {
    const parsed = parseHexColor(hexColor)
    if (!parsed) return '#e9e4dc'
    const { h, s } = rgbToHsl(parsed)
    return toHexColor(hslToRgb({ h: (h + index * 14) % 360, s: Math.min(0.55, s * 0.6), l: 0.8 - index * 0.03 }))
  })
}

function field(
  id: string,
  role: PosterTextField['role'],
  box: NormBox,
  style: Partial<PosterTextStyle> & Pick<PosterTextStyle, 'font' | 'color'>,
  text: string | null = null,
): PosterTextField {
  return {
    id,
    role,
    box,
    text,
    align: 'center',
    vAlign: 'middle',
    uppercase: true,
    maxLines: 1,
    letterSpacing: 0.02,
    background: null,
    ...style,
  }
}

export type BuiltinLayoutInput = {
  /** Artister som får rute. */
  framedCount: number
  /** Hvor mange av dem som er headlinere — de står først. */
  headlinerCount: number
  palette: MarketingPalette
  /** Velger skrift. Samme frø gir samme plakat. */
  seed: number
}

export function builtinPosterLayout(input: BuiltinLayoutInput): PosterLayout {
  const { palette } = input
  const titleFont = TITLE_FONTS[Math.abs(input.seed) % TITLE_FONTS.length]
  const bodyFont = BODY_FONT[titleFont]
  const width = 1 - MARGIN * 2

  const hasHero = input.headlinerCount === 1 && input.framedCount >= 1
  const supportCount = input.framedCount - (hasHero ? 1 : 0)
  const onDark = ink(palette.secondary)
  const onAccent = ink(palette.accent)

  const titleStyle = { font: titleFont, color: onDark, background: palette.secondary, maxLines: 2, letterSpacing: 0.01 }
  const bottom: PosterTextField[] = [
    field('datetime', 'datetime', { x: MARGIN, y: 0.852, width, height: 0.058 }, {
      font: titleFont, color: onAccent, background: palette.accent, letterSpacing: 0.03,
    }),
    field('venue', 'venue', { x: MARGIN, y: 0.91, width, height: 0.04 }, {
      font: bodyFont, color: onAccent, background: palette.accent, letterSpacing: 0.06,
    }),
    field('footer', 'footer', { x: 0, y: 0.966, width: 1, height: 0.034 }, {
      font: bodyFont, color: onDark, background: palette.secondary, letterSpacing: 0.14,
    }),
  ]

  const base = {
    version: 1 as const,
    canvas: { ...POSTER_CANVAS },
    clearZones: [],
    customFont: null,
    grain: 0.35,
    blankTemplate: true,
    fixedTitle: null,
    frameStyle: {
      shape: 'rect' as const,
      fills: frameFills(palette),
      label: {
        font: bodyFont,
        color: onDark,
        uppercase: true,
        letterSpacing: 0.03,
        background: palette.secondary,
        heightRatio: 0.15,
      },
    },
  }

  // Bare headlineren: hele plakaten er én stor rute.
  if (hasHero && supportCount === 0) {
    return {
      ...base,
      frames: [{
        id: 'hero',
        box: { x: 0.14, y: 0.045, width: 0.72, height: 0.5 },
        shape: 'rect',
        nameField: {
          box: { x: 0.14, y: 0.545, width: 0.72, height: 0.07 },
          font: titleFont, color: onDark, background: palette.secondary,
          align: 'center', vAlign: 'middle', uppercase: true, maxLines: 1, letterSpacing: 0.03,
        },
      }],
      lineupArea: null,
      textFields: [
        field('title', 'title', { x: 0, y: 0.655, width: 1, height: 0.165 }, titleStyle),
        ...bottom,
      ],
    }
  }

  // Én headliner og mange i støtte: hovedruta krymper, så raden under får to
  // rader å bre seg på. Ellers blir sju ruter i én rad på størrelse med frimerker.
  if (hasHero && supportCount > 4) {
    return {
      ...base,
      frames: [{
        id: 'hero',
        box: { x: MARGIN, y: 0.03, width: 0.31, height: 0.245 },
        shape: 'rect',
        nameField: {
          box: { x: 0.37, y: 0.085, width: 0.57, height: 0.135 },
          font: titleFont, color: onDark, background: palette.secondary,
          align: 'center', vAlign: 'middle', uppercase: true, maxLines: 2, letterSpacing: 0.02,
        },
      }],
      lineupArea: { box: { x: MARGIN, y: 0.405, width, height: 0.43 }, maxFrames: 12, gap: 0.02 },
      textFields: [
        field('title', 'title', { x: 0, y: 0.29, width: 1, height: 0.1 }, titleStyle),
        ...bottom,
      ],
    }
  }

  // Én headliner og støtte: hovedrute øverst med navnet ved siden av.
  if (hasHero) {
    return {
      ...base,
      frames: [{
        id: 'hero',
        box: { x: MARGIN, y: 0.04, width: 0.44, height: 0.36 },
        shape: 'rect',
        nameField: {
          box: { x: 0.5, y: 0.13, width: 0.44, height: 0.18 },
          font: titleFont, color: onDark, background: palette.secondary,
          align: 'center', vAlign: 'middle', uppercase: true, maxLines: 2, letterSpacing: 0.02,
        },
      }],
      lineupArea: { box: { x: MARGIN, y: 0.6, width, height: 0.235 }, maxFrames: 9, gap: 0.022 },
      textFields: [
        field('title', 'title', { x: 0, y: 0.425, width: 1, height: 0.15 }, titleStyle),
        ...bottom,
      ],
    }
  }

  // Ingen eller flere headlinere: tittelen øverst, alle i samme felt.
  return {
    ...base,
    frames: [],
    lineupArea: { box: { x: MARGIN, y: 0.25, width, height: 0.585 }, maxFrames: 12, gap: 0.022 },
    textFields: [
      field('title', 'title', { x: 0, y: 0.045, width: 1, height: 0.175 }, titleStyle),
      ...bottom,
    ],
  }
}

/** Stabilt frø fra showets id, så «samme show» gir samme skrift. */
export function posterSeed(value: string): number {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}
