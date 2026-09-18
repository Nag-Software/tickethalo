import { readFileSync } from 'node:fs'
import path from 'node:path'
import opentype from 'opentype.js'
import type { PosterCustomFont, PosterFontId, PosterFontRef } from '@/lib/poster/layout'

/**
 * Tekst som vektorbaner.
 *
 * Plakatteksten rendres ikke som `<text>` — da avhenger resultatet av hvilke
 * fonter maskinen har, og Vercel har ingen. I stedet leses fontfila med
 * opentype.js, og hver bokstav blir en `<path>`. Det gir tre ting:
 *
 *  - samme resultat lokalt og i produksjon, uten fontconfig
 *  - nøyaktige mål, så «passer teksten i feltet?» er et regnestykke og ikke et
 *    anslag på tegnbredde
 *  - klubbens egen fontfil kan brukes rett fra en buffer
 *
 * Skriftstørrelsen søkes ikke fram: bredden er lineær i størrelsen, så den
 * største størrelsen som passer regnes ut direkte for hvert linjetall.
 */

const FONT_FILES: Record<PosterFontId, string> = {
  geist: 'Geist-Bold.ttf',
  anton: 'anton-latin-400-normal.woff',
  'archivo-black': 'archivo-black-latin-400-normal.woff',
  'bebas-neue': 'bebas-neue-latin-400-normal.woff',
  'dm-serif-display': 'dm-serif-display-latin-400-normal.woff',
  fredoka: 'fredoka-latin-700-normal.woff',
  oswald: 'oswald-latin-700-normal.woff',
}

const FONT_DIR = path.join(process.cwd(), 'lib', 'poster', 'fonts')
const LINE_HEIGHT = 1.12

const bundledFonts = new Map<PosterFontId, opentype.Font>()
const customFonts = new Map<string, opentype.Font>()

function parseFont(buffer: Buffer): opentype.Font {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  return opentype.parse(arrayBuffer)
}

function bundledFont(id: PosterFontId): opentype.Font {
  let font = bundledFonts.get(id)
  if (!font) {
    font = parseFont(readFileSync(path.join(FONT_DIR, FONT_FILES[id])))
    bundledFonts.set(id, font)
  }
  return font
}

/** Kaster hvis fila ikke er en font opentype.js kan lese (TTF, OTF, WOFF). */
export function assertReadableFont(buffer: Buffer): { family: string } {
  try {
    const font = parseFont(buffer)
    if (font.charToGlyphIndex('A') === 0) throw new Error('no latin glyphs')
    const family = font.names.fontFamily?.en ?? Object.values(font.names.fontFamily ?? {})[0] ?? 'Club font'
    return { family: String(family) }
  } catch {
    throw new Error('The font file could not be read. Use a TTF, OTF or WOFF file (not WOFF2 or a variable font).')
  }
}

async function loadCustomFont(custom: PosterCustomFont): Promise<opentype.Font> {
  const cached = customFonts.get(custom.url)
  if (cached) return cached

  const response = await fetch(custom.url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`The club font "${custom.name}" could not be fetched.`)
  const font = parseFont(Buffer.from(await response.arrayBuffer()))

  if (customFonts.size >= 8) customFonts.delete(customFonts.keys().next().value as string)
  customFonts.set(custom.url, font)
  return font
}

export type PosterFontSet = {
  get: (ref: PosterFontRef) => opentype.Font
  /** Tegner tegn skriften mangler — Geist har full latinsk dekning. */
  fallback: opentype.Font
}

/** Laster alt en layout kan be om, så selve settingen blir synkron. */
export async function loadPosterFonts(customFont: PosterCustomFont | null): Promise<PosterFontSet> {
  const custom = customFont ? await loadCustomFont(customFont) : null
  const fallback = bundledFont('geist')
  return {
    fallback,
    get: (ref) => (ref === 'custom' ? custom ?? fallback : bundledFont(ref)),
  }
}

export class PosterTextOverflowError extends Error {
  constructor(public readonly text: string, public readonly what: string) {
    super(`"${text}" does not fit in the ${what} at a readable size. Shorten it, or give the field more room.`)
    this.name = 'PosterTextOverflowError'
  }
}

type Run = { glyph: opentype.Glyph; font: opentype.Font }

function runsFor(text: string, font: opentype.Font, fallback: opentype.Font): Run[] {
  return [...text].map((char) => {
    const useFallback = font.charToGlyphIndex(char) === 0 && fallback.charToGlyphIndex(char) !== 0
    const source = useFallback ? fallback : font
    return { glyph: source.charToGlyph(char), font: source }
  })
}

/** Linjas bredde i em. */
function measure(runs: Run[], letterSpacing: number): number {
  let width = 0
  runs.forEach((run, index) => {
    width += (run.glyph.advanceWidth ?? 0) / run.font.unitsPerEm
    const next = runs[index + 1]
    if (next) {
      if (next.font === run.font) width += run.font.getKerningValue(run.glyph, next.glyph) / run.font.unitsPerEm
      width += letterSpacing
    }
  })
  return width
}

/** Alle måter å dele `count` ord på `lines` linjer, som bruddposisjoner. */
function* partitions(count: number, lines: number, start = 1): Generator<number[]> {
  if (lines === 1) {
    yield []
    return
  }
  for (let cut = start; cut <= count - (lines - 1); cut++) {
    for (const rest of partitions(count, lines - 1, cut + 1)) yield [cut, ...rest]
  }
}

/**
 * Deler teksten der den kan brytes: ved mellomrom, og etter bindestrek.
 * «Ødegård-Sæther» er ett ord, men to linjer i en smal navnestripe.
 */
function breakable(text: string): string[] {
  return text.split(' ').flatMap((word) => word.split(/(?<=[^-]-)(?=[^-])/))
}

function joinTokens(tokens: string[]): string {
  return tokens.reduce((line, token) => (line === '' || line.endsWith('-') ? line + token : `${line} ${token}`), '')
}

/** Den jevneste delingen: den der den bredeste linja er smalest mulig. */
function balancedLines(words: string[], lineCount: number, width: (line: string) => number): string[] | null {
  if (lineCount > words.length) return null
  if (lineCount === 1) return [joinTokens(words)]

  // Lange navnelister deles grådig — kombinasjonene vokser for fort.
  if (words.length > 22) {
    const perLine = Math.ceil(words.length / lineCount)
    return Array.from({ length: lineCount }, (_, i) => joinTokens(words.slice(i * perLine, (i + 1) * perLine)))
      .filter(Boolean)
  }

  let best: { lines: string[]; widest: number } | null = null
  for (const cuts of partitions(words.length, lineCount)) {
    const bounds = [0, ...cuts, words.length]
    const lines = bounds.slice(0, -1).map((from, i) => joinTokens(words.slice(from, bounds[i + 1])))
    const widest = Math.max(...lines.map(width))
    if (!best || widest < best.widest) best = { lines, widest }
  }
  return best?.lines ?? null
}

export type FittedText = {
  /** `<path>`-elementer, klare til å legges i en SVG på lerretets størrelse. */
  svg: string
  lines: string[]
  fontSize: number
}

export type FitTextInput = {
  text: string
  font: PosterFontRef
  fonts: PosterFontSet
  /** Feltet i piksler. */
  box: { left: number; top: number; width: number; height: number }
  color: string
  align: 'left' | 'center' | 'right'
  vAlign: 'top' | 'middle' | 'bottom'
  maxLines: number
  letterSpacing: number
  /** Under denne størrelsen er teksten ikke lesbar, og settingen feiler. */
  minFontSize: number
  maxFontSize?: number
  /** Luft inne i feltet, som andel av bredde og høyde. */
  padding?: { x: number; y: number }
  /** Hva feltet heter i feilmeldingen: «title field», «name label». */
  what: string
}

export function fitText(input: FitTextInput): FittedText | null {
  const text = input.text.replace(/\s+/g, ' ').trim()
  if (!text) return null

  const font = input.fonts.get(input.font)
  const { fallback } = input.fonts
  const padX = Math.round(input.box.width * (input.padding?.x ?? 0.05))
  const padY = Math.round(input.box.height * (input.padding?.y ?? 0.12))
  const innerW = Math.max(1, input.box.width - padX * 2)
  const innerH = Math.max(1, input.box.height - padY * 2)

  const widthOf = (line: string) => measure(runsFor(line, font, fallback), input.letterSpacing)
  const words = breakable(text)

  let best: { lines: string[]; fontSize: number } | null = null
  for (let lineCount = 1; lineCount <= Math.min(input.maxLines, words.length); lineCount++) {
    const lines = balancedLines(words, lineCount, widthOf)
    if (!lines) continue
    const widest = Math.max(...lines.map(widthOf))
    const fontSize = Math.min(
      innerW / widest,
      innerH / (lines.length * LINE_HEIGHT),
      input.maxFontSize ?? Number.POSITIVE_INFINITY,
    )
    if (!best || fontSize > best.fontSize * 1.04) best = { lines, fontSize }
  }

  if (!best || best.fontSize < input.minFontSize) throw new PosterTextOverflowError(text, input.what)

  const fontSize = Math.floor(best.fontSize * 10) / 10
  const lineHeight = fontSize * LINE_HEIGHT
  const blockHeight = lineHeight * best.lines.length

  // Versalhøyden, ikke hele em-boksen, er det øyet leser som «teksten». Da
  // står en linje med store bokstaver midt i stripa og ikke litt for høyt.
  const capHeight = ((font.tables.os2?.sCapHeight as number | undefined) || font.unitsPerEm * 0.7) / font.unitsPerEm
  const firstBaseline = input.vAlign === 'top'
    ? input.box.top + padY + capHeight * fontSize
    : input.vAlign === 'bottom'
      ? input.box.top + input.box.height - padY - (blockHeight - lineHeight)
      : input.box.top + input.box.height / 2 - (blockHeight - lineHeight) / 2 + (capHeight * fontSize) / 2

  const parts: string[] = []
  best.lines.forEach((line, lineIndex) => {
    const runs = runsFor(line, font, fallback)
    const lineWidth = measure(runs, input.letterSpacing) * fontSize
    let x = input.align === 'left'
      ? input.box.left + padX
      : input.align === 'right'
        ? input.box.left + input.box.width - padX - lineWidth
        : input.box.left + (input.box.width - lineWidth) / 2
    const y = firstBaseline + lineIndex * lineHeight

    runs.forEach((run, index) => {
      const scale = fontSize / run.font.unitsPerEm
      const data = run.glyph.getPath(x, y, fontSize).toPathData(2)
      if (data) parts.push(data)
      x += (run.glyph.advanceWidth ?? 0) * scale
      const next = runs[index + 1]
      if (next) {
        if (next.font === run.font) x += run.font.getKerningValue(run.glyph, next.glyph) * scale
        x += input.letterSpacing * fontSize
      }
    })
  })

  return {
    svg: `<path d="${parts.join('')}" fill="${input.color}"/>`,
    lines: best.lines,
    fontSize,
  }
}
