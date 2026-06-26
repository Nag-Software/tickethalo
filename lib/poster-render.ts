import sharp from 'sharp'
import { POSTER_FONT_FAMILY, ensurePosterFonts } from '@/lib/poster-fonts'
import {
  buildPosterFaceTile,
  escapeSvgText,
  fetchPosterFaceAssets,
  type PosterArtist,
} from '@/lib/poster-compose'
import type {
  NormBox,
  PosterTemplateSchema,
  PosterTextRole,
  PosterTextSlot,
} from '@/lib/poster-template'

export type RenderTemplateInput = {
  schema: PosterTemplateSchema
  title: string
  dateText: string
  timeText: string
  venue: string
  headliners: PosterArtist[]
  supporting: PosterArtist[]
  footerText?: string
}

type PixelBox = { left: number; top: number; width: number; height: number }

const HORIZONTAL_PAD_RATIO = 0.04 // inside-box padding as a ratio of box width

function toPixelBox(box: NormBox, canvasW: number, canvasH: number): PixelBox {
  const left = Math.round(box.x * canvasW)
  const top = Math.round(box.y * canvasH)
  const width = Math.max(1, Math.round(box.width * canvasW))
  const height = Math.max(1, Math.round(box.height * canvasH))
  return { left, top, width, height }
}

/**
 * Render a poster fully deterministically from a template schema + show data.
 * No image-model calls: the plate is composited as-is, faces are placed in the
 * template's photo frames, and every text element + logo is drawn from real
 * fonts / real PNG assets — so logos and Norwegian text are always exact.
 */
export async function renderPosterFromTemplate(input: RenderTemplateInput): Promise<Buffer> {
  ensurePosterFonts()

  const { schema, title, dateText, timeText, venue, headliners, supporting } = input
  const canvasW = schema.canvasWidth
  const canvasH = schema.canvasHeight
  const sorted = [...headliners, ...supporting]

  const base = await buildBasePlate(schema, canvasW, canvasH)
  const composites: sharp.OverlayOptions[] = []

  // 1) Faces into photo frames (with name labels), in headliner-first order.
  const framesUsed = Math.min(schema.photoFrames.length, sorted.length)
  if (framesUsed > 0) {
    const assets = await fetchPosterFaceAssets(sorted.slice(0, framesUsed))
    for (let i = 0; i < framesUsed; i += 1) {
      const frame = schema.photoFrames[i]
      const artist = sorted[i]
      const px = toPixelBox(frame.box, canvasW, canvasH)
      const labelHeight = frame.labelRatio > 0
        ? Math.min(px.height - 20, Math.max(28, Math.round(px.height * frame.labelRatio)))
        : 0
      const fontSize = Math.max(14, Math.round(px.height * frame.fontScale))

      const photo = assets[i]?.buffer ?? null
      const tile = labelHeight > 0
        ? await buildPosterFaceTile({
          name: artist.name,
          photoBuffer: photo,
          width: px.width,
          height: px.height,
          labelHeight,
          fontSize,
        })
        : await buildBarePhoto(photo, px.width, px.height, artist.name)

      const shaped = await applyShape(tile, frame.shape, px.width, px.height)
      composites.push({ input: shaped, left: px.left, top: px.top })
    }
  }

  // 2) Logos — real transparent PNG assets, never regenerated.
  for (const logo of schema.logos) {
    try {
      const buf = await fetchImageBuffer(logo.assetUrl)
      if (!buf) continue
      const px = toPixelBox(logo.box, canvasW, canvasH)
      const resized = await sharp(buf)
        .resize({
          width: px.width,
          height: px.height,
          fit: logo.fit === 'cover' ? 'cover' : 'inside',
          withoutEnlargement: false,
        })
        .png()
        .toBuffer()
      const meta = await sharp(resized).metadata()
      const w = meta.width ?? px.width
      const offsetX = logo.align === 'left' ? 0 : logo.align === 'right' ? px.width - w : Math.round((px.width - w) / 2)
      composites.push({ input: resized, left: px.left + Math.max(0, offsetX), top: px.top })
    } catch (error) {
      console.warn('[Poster] Skipped logo composite:', error)
    }
  }

  // 3) Text slots — one canvas-sized SVG overlay rendered with real fonts.
  const textSvg = buildTextOverlaySvg({
    slots: schema.textSlots,
    canvasW,
    canvasH,
    resolve: (role, slot) => resolveSlotContent(role, slot, {
      title,
      dateText,
      timeText,
      venue,
      headliners,
      supporting,
      framesUsed,
      footerText: input.footerText,
    }),
  })
  if (textSvg) {
    composites.push({ input: Buffer.from(textSvg), left: 0, top: 0 })
  }

  return base.composite(composites).png().toBuffer()
}

async function buildBasePlate(schema: PosterTemplateSchema, canvasW: number, canvasH: number) {
  const bgColor = schema.palette[0] ?? '#111111'
  if (schema.plateUrl) {
    const buf = await fetchImageBuffer(schema.plateUrl)
    if (buf) {
      const plate = await sharp(buf, { animated: false })
        .rotate()
        .toColorspace('srgb')
        .resize({ width: canvasW, height: canvasH, fit: 'cover', position: 'centre' })
        .png()
        .toBuffer()
      return sharp(plate)
    }
  }
  return sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: bgColor,
    },
  })
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) return null
    return Buffer.from(await response.arrayBuffer())
  } catch (error) {
    console.warn('[Poster] Could not fetch image:', url, error)
    return null
  }
}

async function buildBarePhoto(photoBuffer: Buffer | null, width: number, height: number, name: string): Promise<Buffer> {
  if (photoBuffer) {
    return sharp(photoBuffer)
      .resize({ width, height, fit: 'cover', position: 'attention' })
      .png()
      .toBuffer()
  }
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?'
  const fontSize = Math.max(20, Math.round(Math.min(width, height) * 0.3))
  const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#27272a"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="${POSTER_FONT_FAMILY}, sans-serif" font-size="${fontSize}" font-weight="800" fill="#e4e4e7">${escapeSvgText(initials)}</text>
  </svg>`)
  return sharp(svg).png().toBuffer()
}

async function applyShape(tile: Buffer, shape: 'rect' | 'rounded' | 'circle', width: number, height: number): Promise<Buffer> {
  if (shape === 'rect') return tile
  const radius = shape === 'circle' ? Math.min(width, height) / 2 : Math.round(Math.min(width, height) * 0.12)
  const cx = width / 2
  const cy = height / 2
  const mask = shape === 'circle'
    ? `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${cx}" cy="${cy}" rx="${width / 2}" ry="${height / 2}" fill="#fff"/></svg>`
    : `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`
  return sharp(tile)
    .composite([{ input: Buffer.from(mask), blend: 'dest-in' }])
    .png()
    .toBuffer()
}

type SlotContext = {
  title: string
  dateText: string
  timeText: string
  venue: string
  headliners: PosterArtist[]
  supporting: PosterArtist[]
  framesUsed: number
  footerText?: string
}

function resolveSlotContent(role: PosterTextRole, slot: PosterTextSlot, ctx: SlotContext): string {
  const sorted = [...ctx.headliners, ...ctx.supporting]
  const dateLine = ctx.timeText ? `${ctx.dateText} · ${ctx.timeText}` : ctx.dateText

  switch (role) {
    case 'title':
      return ctx.title
    case 'date':
      return dateLine
    case 'venue':
      return ctx.venue
    case 'footer':
      return slot.text || ctx.footerText || 'BILLETTER · HUMOR.EVENTS'
    case 'custom':
      return slot.text ?? ''
    case 'headliner': {
      // If faces cover the headliners as labels, don't repeat them as text.
      if (ctx.framesUsed >= ctx.headliners.length && ctx.framesUsed > 0) return ''
      return ctx.headliners.map(a => a.name).join(' & ')
    }
    case 'lineup': {
      const remaining = ctx.framesUsed > 0 ? sorted.slice(ctx.framesUsed) : sorted
      return remaining.map(a => a.name).join('  ·  ')
    }
    default:
      return ''
  }
}

type FittedText = { lines: string[]; fontSize: number; lineHeight: number }

function fitText(text: string, boxW: number, boxH: number, maxLines: number, weight: number): FittedText | null {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return null

  // Heavier weights are a touch wider; tune the average glyph width factor.
  const widthFactor = weight >= 700 ? 0.6 : weight >= 600 ? 0.58 : 0.56
  const maxSize = Math.max(12, Math.floor(boxH))
  const words = compact.split(' ')

  for (let size = maxSize; size >= 10; size -= 1) {
    const lineHeight = Math.round(size * 1.14)
    if (lineHeight * 1 > boxH) continue
    const maxCharsPerLine = Math.max(1, Math.floor(boxW / (size * widthFactor)))
    const lines = wrapWords(words, maxCharsPerLine)
    if (!lines) continue
    if (lines.length <= maxLines && lineHeight * lines.length <= boxH) {
      return { lines, fontSize: size, lineHeight }
    }
  }

  // Last resort: single hard-clipped line at the floor size.
  const size = 10
  const maxChars = Math.max(1, Math.floor(boxW / (size * widthFactor)))
  const clipped = compact.length > maxChars ? `${compact.slice(0, Math.max(1, maxChars - 1))}…` : compact
  return { lines: [clipped], fontSize: size, lineHeight: Math.round(size * 1.14) }
}

function wrapWords(words: string[], maxChars: number): string[] | null {
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    // A single word longer than the line can't fit at this size.
    if (word.length > maxChars) return null
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxChars) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function buildTextOverlaySvg(input: {
  slots: PosterTextSlot[]
  canvasW: number
  canvasH: number
  resolve: (role: PosterTextRole, slot: PosterTextSlot) => string
}): string | null {
  const { slots, canvasW, canvasH, resolve } = input
  const parts: string[] = []

  for (const slot of slots) {
    const raw = resolve(slot.role, slot)
    const content = slot.uppercase ? raw.toLocaleUpperCase('nb-NO') : raw
    if (!content.trim()) continue

    const px = toPixelBox(slot.box, canvasW, canvasH)
    const pad = Math.round(px.width * HORIZONTAL_PAD_RATIO)
    const innerW = Math.max(1, px.width - pad * 2)
    const fitted = fitText(content, innerW, px.height, slot.maxLines, slot.fontWeight)
    if (!fitted) continue

    const blockHeight = fitted.lineHeight * fitted.lines.length
    const topOffset = slot.vAlign === 'top'
      ? 0
      : slot.vAlign === 'bottom'
        ? px.height - blockHeight
        : Math.round((px.height - blockHeight) / 2)

    const anchor = slot.align === 'left' ? 'start' : slot.align === 'right' ? 'end' : 'middle'
    const x = slot.align === 'left' ? px.left + pad : slot.align === 'right' ? px.left + px.width - pad : px.left + px.width / 2
    const letterSpacing = slot.letterSpacing ? ` letter-spacing="${(fitted.fontSize * slot.letterSpacing).toFixed(2)}"` : ''
    const baseY = px.top + topOffset + Math.round(fitted.fontSize * 0.82)

    fitted.lines.forEach((line, index) => {
      const y = baseY + index * fitted.lineHeight
      const safe = escapeSvgText(line)
      // Subtle shadow improves legibility over busy plates without dominating.
      parts.push(`<text x="${x}" y="${y + 1}" text-anchor="${anchor}"${letterSpacing} font-family="${POSTER_FONT_FAMILY}, sans-serif" font-size="${fitted.fontSize}" font-weight="${slot.fontWeight}" fill="rgba(0,0,0,0.28)">${safe}</text>`)
      parts.push(`<text x="${x}" y="${y}" text-anchor="${anchor}"${letterSpacing} font-family="${POSTER_FONT_FAMILY}, sans-serif" font-size="${fitted.fontSize}" font-weight="${slot.fontWeight}" fill="${slot.color}">${safe}</text>`)
    })
  }

  if (!parts.length) return null
  return `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`
}
