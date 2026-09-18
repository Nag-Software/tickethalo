import sharp from 'sharp'
import {
  hasLineupField,
  layoutCapacity,
  type NormBox,
  type PosterFrameShape,
  type PosterLayout,
  type PosterTextField,
  type PosterTextStyle,
} from '@/lib/poster/layout'
import { fitText, loadPosterFonts, PosterTextOverflowError, type FittedText, type PosterFontSet } from '@/lib/poster/text'

/**
 * Setter sammen plakaten: bakgrunn, bilder, navn og tekst.
 *
 * Ingen bildemodell er involvert her. Hvert bilde legges i sin rute av kode,
 * og navnet under kommer fra den samme artistraden — det finnes ikke noe sted
 * i denne fila der et navn og et ansikt kan komme fra hver sin kilde.
 */

export type PosterArtist = {
  id: string | null
  name: string
  /** Normalisert bilde, eller null når artisten ikke har noe. */
  photo: Buffer | null
  isHeadliner: boolean
}

export type PosterContent = {
  title: string
  dateText: string
  timeText: string
  venue: string
  footer: string
  /** Rangert: headlinerne først. */
  artists: PosterArtist[]
}

type PixelBox = { left: number; top: number; width: number; height: number }

export type PosterPlacement = {
  artist: PosterArtist
  /** `frame:<id>` for en fast rute, `grid:<n>` for en rute koden tegnet. */
  slot: string
  photoBox: PixelBox
  nameBox: PixelBox | null
  shape: PosterFrameShape
  fill: string
  nameStyle: (Omit<PosterTextStyle, 'align' | 'vAlign' | 'maxLines'> & Partial<PosterTextStyle>) | null
}

export type PosterPlan = {
  placements: PosterPlacement[]
  /** Artister som står med bare navn, i lineup-feltet. */
  listed: PosterArtist[]
}

export class PosterCapacityError extends Error {
  constructor(public readonly capacity: number, public readonly needed: number) {
    super(
      `The template has ${capacity} photo ${capacity === 1 ? 'slot' : 'slots'}, but the lineup has ${needed} artists. `
      + 'Pick a template with enough slots, or use one with a flexible lineup area.',
    )
    this.name = 'PosterCapacityError'
  }
}

function toPixels(box: NormBox, layout: PosterLayout): PixelBox {
  const { width, height } = layout.canvas
  const left = Math.round(box.x * width)
  const top = Math.round(box.y * height)
  return {
    left,
    top,
    width: Math.max(1, Math.min(width - left, Math.round(box.width * width))),
    height: Math.max(1, Math.min(height - top, Math.round(box.height * height))),
  }
}

/** Navnestripas minstehøyde som andel av lerretet — under dette blir navn uleselige. */
const MIN_LABEL_HEIGHT = 0.03

/** Forholdet bredde/høyde på selve bildet i en rute koden tegner. */
const GRID_PHOTO_ASPECT = 0.82

/**
 * Deler lineupfeltet i `count` like ruter.
 *
 * Prøver én, to og tre rader og beholder det oppsettet som gir størst ruter.
 * En ufullstendig siste rad sentreres, så fem komikere blir tre over to og
 * ikke tre over to-og-et-hull.
 */
export function gridCells(
  area: PixelBox,
  count: number,
  gapRatio: number,
  labelRatio: number,
  /** Navnestripa blir aldri lavere enn dette, uansett hvor små rutene er. */
  minLabelHeight = 0,
): Array<{ photo: PixelBox; label: PixelBox | null }> {
  if (count <= 0) return []
  const gap = Math.round(area.width * gapRatio)
  const labelFor = (photoH: number) => (labelRatio > 0 ? Math.max(minLabelHeight, photoH * labelRatio) : 0)

  let best: { rows: number; cols: number; photoW: number } | null = null
  for (let rows = 1; rows <= Math.min(3, count); rows++) {
    const cols = Math.ceil(count / rows)
    const cellW = (area.width - gap * (cols - 1)) / cols
    const cellH = (area.height - gap * (rows - 1)) / rows
    // Cella er bilde pluss navnestripe. Stripa har et gulv, så bildet får det
    // som er igjen når gulvet er trukket fra.
    const byRatio = cellH / (1 + labelRatio)
    const photoH = Math.min(labelFor(byRatio) > byRatio * labelRatio ? cellH - minLabelHeight : byRatio, cellW / GRID_PHOTO_ASPECT)
    const photoW = Math.min(cellW, photoH * GRID_PHOTO_ASPECT)
    if (photoW > 0 && (!best || photoW > best.photoW * 1.02)) best = { rows, cols, photoW }
  }
  if (!best) return []

  const { rows, cols } = best
  const photoW = Math.floor(best.photoW)
  const photoH = Math.floor(best.photoW / GRID_PHOTO_ASPECT)
  const labelH = Math.round(labelFor(photoH))
  const cellH = photoH + labelH
  const blockH = rows * cellH + gap * (rows - 1)
  const top0 = area.top + Math.round((area.height - blockH) / 2)

  const cells: Array<{ photo: PixelBox; label: PixelBox | null }> = []
  for (let index = 0; index < count; index++) {
    const row = Math.floor(index / cols)
    const inRow = row === rows - 1 ? count - cols * (rows - 1) : cols
    const rowW = inRow * photoW + gap * (inRow - 1)
    const left = area.left + Math.round((area.width - rowW) / 2) + (index - row * cols) * (photoW + gap)
    const top = top0 + row * (cellH + gap)
    cells.push({
      photo: { left, top, width: photoW, height: photoH },
      label: labelH > 0 ? { left, top: top + photoH, width: photoW, height: labelH } : null,
    })
  }
  return cells
}

/**
 * Bestemmer hvem som står hvor — uten å tegne noe.
 *
 * Skilt ut fra renderingen fordi det er her reglene ligger: ingen artist
 * droppes i det stille, og ingen står to steder.
 */
export function planPoster(layout: PosterLayout, artists: PosterArtist[]): PosterPlan {
  const canList = hasLineupField(layout)
  // Uten et lineupfelt har en artist uten bilde ingen andre steder å stå, og
  // får en rute med initialer i stedet for å forsvinne fra plakaten.
  const framed = canList ? artists.filter((artist) => artist.photo) : artists
  const listed = canList ? artists.filter((artist) => !artist.photo) : []

  const capacity = layoutCapacity(layout)
  if (framed.length > capacity) throw new PosterCapacityError(capacity, framed.length)

  const { frameStyle } = layout
  const fill = (index: number) => frameStyle.fills[index % frameStyle.fills.length]
  const placements: PosterPlacement[] = []

  const fixed = framed.slice(0, layout.frames.length)
  fixed.forEach((artist, index) => {
    const frame = layout.frames[index]
    const photoBox = toPixels(frame.box, layout)
    const label = frameStyle.label
    placements.push({
      artist,
      slot: `frame:${frame.id}`,
      photoBox,
      shape: frame.shape,
      fill: fill(index),
      nameBox: frame.nameField
        ? toPixels(frame.nameField.box, layout)
        : label
          ? { ...photoBox, top: photoBox.top + photoBox.height, height: Math.round(photoBox.height * label.heightRatio) }
          : null,
      nameStyle: frame.nameField ?? label,
    })
  })

  const rest = framed.slice(layout.frames.length)
  if (rest.length > 0 && layout.lineupArea) {
    const cells = gridCells(
      toPixels(layout.lineupArea.box, layout),
      rest.length,
      layout.lineupArea.gap,
      frameStyle.label?.heightRatio ?? 0,
      Math.round(layout.canvas.height * MIN_LABEL_HEIGHT),
    )
    rest.forEach((artist, index) => {
      placements.push({
        artist,
        slot: `grid:${index + 1}`,
        photoBox: cells[index].photo,
        nameBox: cells[index].label,
        shape: frameStyle.shape,
        fill: fill(fixed.length + index),
        nameStyle: frameStyle.label,
      })
    })
  }

  // Siste skanse. Reglene over skal gjøre dette umulig; sjekken finnes for at
  // en framtidig endring ikke skal kunne bryte det uten at noe sier fra.
  const seen = new Set<PosterArtist>()
  for (const artist of [...placements.map((placement) => placement.artist), ...listed]) {
    if (seen.has(artist)) throw new Error(`Poster plan placed "${artist.name}" twice.`)
    seen.add(artist)
  }
  const missing = artists.find((artist) => !seen.has(artist))
  if (missing) throw new Error(`Poster plan left out "${missing.name}".`)

  return { placements, listed }
}

function shapeMask(shape: PosterFrameShape, width: number, height: number): Buffer | null {
  if (shape === 'rect') return null
  const body = shape === 'circle'
    ? `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="#fff"/>`
    : `<rect width="${width}" height="${height}" rx="${Math.round(Math.min(width, height) * 0.08)}" fill="#fff"/>`
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`)
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('nb-NO') ?? '').join('') || '?'
}

async function photoTile(placement: PosterPlacement, fonts: PosterFontSet, minFontSize: number): Promise<Buffer> {
  const { width, height } = placement.photoBox
  const layers: sharp.OverlayOptions[] = []

  if (placement.artist.photo) {
    // `attention` beskjærer mot det mest iøynefallende i bildet — i et
    // portrett er det ansiktet. Flatefargen bak synes bare der bildet er
    // gjennomsiktig (utklipte pressebilder).
    layers.push({
      input: await sharp(placement.artist.photo)
        .resize({ width, height, fit: 'cover', position: 'attention' })
        .png()
        .toBuffer(),
    })
  } else {
    const mark = fitText({
      text: initials(placement.artist.name),
      font: placement.nameStyle?.font ?? 'geist',
      fonts,
      box: { left: 0, top: 0, width, height },
      color: 'rgba(0,0,0,0.35)',
      align: 'center',
      vAlign: 'middle',
      maxLines: 1,
      letterSpacing: 0,
      minFontSize,
      maxFontSize: Math.round(height * 0.34),
      what: 'photo slot',
    })
    if (mark) {
      layers.push({ input: Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${mark.svg}</svg>`) })
    }
  }

  const mask = shapeMask(placement.shape, width, height)
  if (mask) layers.push({ input: mask, blend: 'dest-in' })

  return sharp({ create: { width, height, channels: 4, background: placement.fill } })
    .composite(layers)
    .png()
    .toBuffer()
}

function rect(box: PixelBox, fill: string): string {
  return `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" fill="${fill}"/>`
}

function fieldText(field: PosterTextField, content: PosterContent, listed: PosterArtist[]): string {
  switch (field.role) {
    case 'title': return content.title
    case 'date': return content.dateText
    case 'time': return content.timeText
    case 'datetime': return [content.dateText, content.timeText].filter(Boolean).join(', ')
    case 'venue': return content.venue
    case 'lineup': return listed.map((artist) => artist.name).join('  ·  ')
    case 'footer': return field.text ?? content.footer
    case 'custom': return field.text ?? ''
  }
}

/**
 * Et navn som ikke får plass skal ikke velte hele plakaten.
 *
 * Først hele navnet, så for- og etternavn uten mellomnavn, og til slutt litt
 * mindre skrift enn ellers. Rekker ikke det heller, er ruten for smal til å
 * bære et navn, og da er det layouten som må endres — feilen går videre.
 */
function fitName(
  name: string,
  uppercase: boolean,
  fit: (text: string, minFontSize: number) => FittedText | null,
  minFontSize: number,
): FittedText | null {
  const full = uppercase ? name.toLocaleUpperCase('nb-NO') : name
  const parts = full.split(/\s+/).filter(Boolean)
  const short = parts.length > 2 ? `${parts[0]} ${parts[parts.length - 1]}` : full

  const attempts: Array<[string, number]> = [[full, minFontSize], [short, minFontSize], [short, minFontSize * 0.8]]
  let lastError: unknown = null
  for (const [text, minSize] of attempts) {
    try {
      return fit(text, minSize)
    } catch (error) {
      if (!(error instanceof PosterTextOverflowError)) throw error
      lastError = error
    }
  }
  throw lastError
}

async function grainLayer(width: number, height: number, amount: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 10 + amount * 34 } },
  })
    .greyscale()
    .png()
    .toBuffer()
}

export type RenderedPoster = { buffer: Buffer; plan: PosterPlan }

export async function renderPoster(input: {
  layout: PosterLayout
  content: PosterContent
  /** Bakgrunnen: en generert flate, eller klubbmalens tømte plate. */
  background: Buffer
}): Promise<RenderedPoster> {
  const { layout, content } = input
  const { width, height } = layout.canvas
  const fonts = await loadPosterFonts(layout.customFont)
  const plan = planPoster(layout, content.artists)
  const minFontSize = Math.max(11, height * 0.0095)

  const base = await sharp(input.background, { animated: false })
    .rotate()
    .toColorspace('srgb')
    .resize({ width, height, fit: 'cover', position: 'centre' })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer()

  const overlays: sharp.OverlayOptions[] = []
  for (const placement of plan.placements) {
    overlays.push({
      input: await photoTile(placement, fonts, minFontSize),
      left: placement.photoBox.left,
      top: placement.photoBox.top,
    })
  }

  // All tekst og alle flater bak tekst i ett vektorlag oppå bildene.
  const vector: string[] = []
  for (const placement of plan.placements) {
    if (!placement.nameBox || !placement.nameStyle) continue
    const style = placement.nameStyle
    const nameBox = placement.nameBox
    if (style.background) vector.push(rect(nameBox, style.background))
    const fitted = fitName(placement.artist.name, style.uppercase, (text, minSize) => fitText({
      text,
      font: style.font,
      fonts,
      box: nameBox,
      color: style.color,
      align: style.align ?? 'center',
      vAlign: style.vAlign ?? 'middle',
      maxLines: style.maxLines ?? 2,
      letterSpacing: style.letterSpacing,
      minFontSize: minSize,
      maxFontSize: nameBox.height * 0.62,
      padding: { x: 0.06, y: 0.14 },
      what: `name label for ${placement.artist.name}`,
    }), minFontSize)
    if (fitted) vector.push(fitted.svg)
  }

  for (const field of layout.textFields) {
    const raw = fieldText(field, content, plan.listed)
    const text = field.uppercase ? raw.toLocaleUpperCase('nb-NO') : raw
    if (!text.trim()) continue
    const box = toPixels(field.box, layout)
    if (field.background) vector.push(rect(box, field.background))
    const fitted = fitText({
      text,
      font: field.font,
      fonts,
      box,
      color: field.color,
      align: field.align,
      vAlign: field.vAlign,
      maxLines: field.maxLines,
      letterSpacing: field.letterSpacing,
      minFontSize,
      padding: { x: 0.06, y: field.maxLines > 1 ? 0.1 : 0.2 },
      what: `${field.role} field`,
    })
    if (fitted) vector.push(fitted.svg)
  }

  if (vector.length > 0) {
    overlays.push({
      input: Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${vector.join('')}</svg>`),
      left: 0,
      top: 0,
    })
  }

  if (layout.grain > 0) {
    overlays.push({ input: await grainLayer(width, height, layout.grain), blend: 'soft-light', left: 0, top: 0 })
  }

  const buffer = await sharp(base).composite(overlays).png({ compressionLevel: 9 }).toBuffer()
  return { buffer, plan }
}
