import sharp from 'sharp'
import { getOpenAI } from '@/lib/openai'
import {
  DEFAULT_CANVAS_HEIGHT,
  DEFAULT_CANVAS_WIDTH,
  normalizePhotoFrame,
  normalizeTextSlot,
  type NormBox,
  type PosterPhotoFrame,
  type PosterTextSlot,
} from '@/lib/poster-template'

export type LogoCrop = {
  box: NormBox
  buffer: Buffer // transparent-capable PNG of the cropped logo region
}

export type DraftTemplate = {
  canvasWidth: number
  canvasHeight: number
  palette: string[]
  textSlots: PosterTextSlot[]
  photoFrames: PosterPhotoFrame[]
  logoCrops: LogoCrop[]
  plateBuffer: Buffer | null
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return text.slice(start, i + 1)
  }
  return null
}

function clamp01(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

function clampBox(raw: unknown): NormBox {
  const box = (raw ?? {}) as Record<string, unknown>
  const x = clamp01(box.x, 0)
  const y = clamp01(box.y, 0)
  const width = Math.min(clamp01(box.width, 0.2) || 0.2, 1 - x)
  const height = Math.min(clamp01(box.height, 0.2) || 0.2, 1 - y)
  return { x, y, width: Math.max(0.02, width), height: Math.max(0.02, height) }
}

/**
 * A sensible default layout used when vision extraction is unavailable or
 * returns nothing usable. Title band on top, one centered photo frame, and
 * date/venue/footer bands at the bottom — a safe, editable starting point.
 */
export function defaultLayout(): Omit<DraftTemplate, 'plateBuffer' | 'logoCrops'> {
  return {
    canvasWidth: DEFAULT_CANVAS_WIDTH,
    canvasHeight: DEFAULT_CANVAS_HEIGHT,
    palette: ['#101014', '#ffffff'],
    textSlots: [
      normalizeTextSlot({ role: 'title', box: { x: 0.06, y: 0.05, width: 0.88, height: 0.14 }, align: 'center', color: '#ffffff', fontWeight: 700, uppercase: true, maxLines: 2 }),
      normalizeTextSlot({ role: 'lineup', box: { x: 0.08, y: 0.78, width: 0.84, height: 0.06 }, align: 'center', color: '#ffffff', fontWeight: 500, maxLines: 2 }),
      normalizeTextSlot({ role: 'date', box: { x: 0.08, y: 0.86, width: 0.84, height: 0.05 }, align: 'center', color: '#ffffff', fontWeight: 600, uppercase: true }),
      normalizeTextSlot({ role: 'venue', box: { x: 0.08, y: 0.905, width: 0.84, height: 0.035 }, align: 'center', color: '#cfcfd4', fontWeight: 500 }),
      normalizeTextSlot({ role: 'footer', box: { x: 0.08, y: 0.95, width: 0.84, height: 0.03 }, align: 'center', color: '#9a9aa0', fontWeight: 700, uppercase: true, letterSpacing: 0.06 }),
    ],
    photoFrames: [
      normalizePhotoFrame({ box: { x: 0.24, y: 0.24, width: 0.52, height: 0.42 }, shape: 'rounded', labelRatio: 0.16, fontScale: 0.07 }),
    ],
  }
}

async function dominantPalette(buffer: Buffer): Promise<string[]> {
  try {
    const { dominant } = await sharp(buffer).stats()
    const hex = `#${[dominant.r, dominant.g, dominant.b].map(v => v.toString(16).padStart(2, '0')).join('')}`
    return [hex, '#ffffff']
  } catch {
    return ['#101014', '#ffffff']
  }
}

/**
 * Ask gpt-4.1-mini to read the reference poster and return a normalized layout.
 * The model is unreliable at exact coordinates, so the output is treated as a
 * DRAFT: clamped here and confirmed by the booker in the editor. Falls back to
 * defaultLayout() on any failure.
 */
export async function extractLayout(
  previewBuffer: Buffer,
  options?: { fallbackToDefault?: boolean },
): Promise<Omit<DraftTemplate, 'plateBuffer' | 'logoCrops'> & { logoZones: NormBox[] }> {
  const fallback = { ...defaultLayout(), logoZones: [] as NormBox[] }
  // Draft templates (min-klubb editor) want a usable fallback the booker can
  // fix by hand; the brand-kit cache must NOT persist a silently degraded
  // layout, so it opts out and handles the throw itself.
  const fallbackToDefault = options?.fallbackToDefault ?? true

  try {
    const openai = getOpenAI()
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      temperature: 0.1,
      store: false,
      input: [
        {
          role: 'system',
          content: [{
            type: 'input_text',
            text: 'You analyze event poster layouts and return JSON only (no markdown). All coordinates are normalized 0..1 relative to the full poster.',
          }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                'Identify the reusable layout of this comedy poster so we can drop in a new lineup and event details.',
                'Return JSON exactly like:',
                '{',
                '  "palette": ["#112233", "#ffffff"],',
                '  "textSlots": [{"role":"title","box":{"x":0.1,"y":0.05,"width":0.8,"height":0.12},"align":"center","color":"#ffffff","uppercase":true}],',
                '  "photoFrames": [{"box":{"x":0.2,"y":0.25,"width":0.6,"height":0.4},"shape":"rounded"}],',
                '  "logoZones": [{"x":0.4,"y":0.92,"width":0.2,"height":0.05}]',
                '}',
                'Rules:',
                '- role is one of: title, headliner, lineup, date, venue, footer.',
                '- Include a textSlot ONLY for text that changes per event: show title, comedian names, date/time, venue.',
                '- Do NOT create textSlots for static brand text (club name, slogans, taglines, website/URL lines, "presenterer" lines) — that text stays in the background and must be left alone.',
                '- photoFrames = areas where comedian portraits sit. One per portrait slot, ALL of them. shape is rect, rounded or circle.',
                '- If portraits have name labels under/over them, set the frame box to cover photo + label area.',
                '- logoZones = club/sponsor logos or brand marks (NOT comedian photos, NOT text).',
                '- color = approximate hex of the text in that slot.',
                '- Keep every box fully inside 0..1 and non-overlapping where possible.',
              ].join('\n'),
            },
            {
              type: 'input_image',
              image_url: `data:image/jpeg;base64,${previewBuffer.toString('base64')}`,
              detail: 'high',
            },
          ],
        },
      ],
    })

    const json = extractJsonObject(response.output_text ?? '')
    if (!json) {
      if (!fallbackToDefault) throw new Error('Layout extraction returned no JSON')
      return fallback
    }
    const parsed = JSON.parse(json) as Record<string, unknown>

    const textSlots = Array.isArray(parsed.textSlots) ? parsed.textSlots.map(normalizeTextSlot) : []
    const photoFrames = Array.isArray(parsed.photoFrames) ? parsed.photoFrames.map(normalizePhotoFrame) : []
    const logoZones = Array.isArray(parsed.logoZones) ? parsed.logoZones.map(clampBox) : []
    const palette = Array.isArray(parsed.palette)
      ? parsed.palette.filter((c): c is string => typeof c === 'string').slice(0, 6)
      : []

    if (textSlots.length === 0 && photoFrames.length === 0) {
      if (!fallbackToDefault) throw new Error('Layout extraction found no slots or frames')
      return fallback
    }

    return {
      canvasWidth: DEFAULT_CANVAS_WIDTH,
      canvasHeight: DEFAULT_CANVAS_HEIGHT,
      palette: palette.length ? palette : fallback.palette,
      textSlots: textSlots.length ? textSlots : fallback.textSlots,
      photoFrames,
      logoZones,
    }
  } catch (error) {
    if (!fallbackToDefault) throw error
    console.warn('[Poster] Template layout extraction failed, using default layout:', error)
    return fallback
  }
}

/**
 * Layout boxes are measured on the reference in its ORIGINAL aspect ratio,
 * but the plate and every render happen on a cover-cropped canvas (default
 * 2:3). For a non-2:3 reference the cover crop shifts everything — this
 * returns a mapper from original-frame normalized boxes to canvas-frame
 * normalized boxes (null when a box falls entirely outside the crop).
 */
export function coverCropBoxMapper(
  originalW: number,
  originalH: number,
  canvasW: number,
  canvasH: number,
): (box: NormBox) => NormBox | null {
  const scale = Math.max(canvasW / originalW, canvasH / originalH)
  const cropLeft = (originalW * scale - canvasW) / 2
  const cropTop = (originalH * scale - canvasH) / 2

  return (box: NormBox) => {
    const left = box.x * originalW * scale - cropLeft
    const top = box.y * originalH * scale - cropTop
    const width = box.width * originalW * scale
    const height = box.height * originalH * scale

    const clampedLeft = Math.max(0, left)
    const clampedTop = Math.max(0, top)
    const clampedRight = Math.min(canvasW, left + width)
    const clampedBottom = Math.min(canvasH, top + height)
    if (clampedRight - clampedLeft < 4 || clampedBottom - clampedTop < 4) return null

    return {
      x: clampedLeft / canvasW,
      y: clampedTop / canvasH,
      width: (clampedRight - clampedLeft) / canvasW,
      height: (clampedBottom - clampedTop) / canvasH,
    }
  }
}

export async function cropLogos(originalBuffer: Buffer, logoZones: NormBox[]): Promise<LogoCrop[]> {
  if (logoZones.length === 0) return []
  const crops: LogoCrop[] = []
  try {
    const meta = await sharp(originalBuffer).metadata()
    const W = meta.width ?? 0
    const H = meta.height ?? 0
    if (!W || !H) return []

    for (const box of logoZones.slice(0, 4)) {
      const left = Math.round(box.x * W)
      const top = Math.round(box.y * H)
      const width = Math.min(Math.max(8, Math.round(box.width * W)), W - left)
      const height = Math.min(Math.max(8, Math.round(box.height * H)), H - top)
      if (width < 8 || height < 8) continue
      const buffer = await sharp(originalBuffer)
        .extract({ left, top, width, height })
        .png()
        .toBuffer()
      crops.push({ box, buffer })
    }
  } catch (error) {
    console.warn('[Poster] Logo crop failed:', error)
  }
  return crops
}

/**
 * Build a clean background plate: remove the comedian faces and old show text so
 * new content sits cleanly, while keeping the design, colors and any logos.
 * Tries gpt-image-1.5 inpaint; on any failure falls back to a deterministic
 * sharp blur over the photo + text zones so a usable plate ALWAYS exists.
 */
export async function buildPlate(
  originalBuffer: Buffer,
  zones: NormBox[],
  canvasW: number,
  canvasH: number,
): Promise<Buffer | null> {
  const base = await sharp(originalBuffer, { animated: false })
    .rotate()
    .toColorspace('srgb')
    .resize({ width: canvasW, height: canvasH, fit: 'cover', position: 'centre' })
    .png()
    .toBuffer()

  try {
    const openai = getOpenAI()
    const { toFile } = await import('openai')
    const file = await toFile(base, 'reference-poster.png', { type: 'image/png' })
    const response = await openai.images.edit({
      model: 'gpt-image-1.5',
      image: file,
      prompt: [
        'Produce a CLEAN BACKGROUND PLATE from this poster.',
        'Remove ALL people / portrait photos and ALL event-specific text (show title, comedian names, dates, times, venue).',
        'Reconstruct the background where they were, seamlessly — including any empty photo frames/borders, which must stay exactly where they are.',
        'KEEP everything that is part of the brand: the overall design, color palette, textures, decorative graphics, club/sponsor logos, AND static brand text (club name, slogans, taglines, website/URL lines) exactly as they are.',
        'The result is the same poster design with empty photo slots and no event text, ready for a new lineup to be placed on top.',
      ].join(' '),
      n: 1,
      size: canvasW <= canvasH ? '1024x1536' : '1536x1024',
      quality: 'high',
      input_fidelity: 'high',
      output_format: 'png',
    })
    const b64 = response.data?.[0]?.b64_json
    if (b64) {
      return await sharp(Buffer.from(b64, 'base64'))
        .resize({ width: canvasW, height: canvasH, fit: 'cover', position: 'centre' })
        .png()
        .toBuffer()
    }
  } catch (error) {
    console.warn('[Poster] AI plate inpaint failed, using blur fallback:', error)
  }

  // Deterministic fallback: blur the face/text zones so old content reads as
  // texture. New faces/text fully cover these zones at render time.
  return blurZonesFallback(base, zones, canvasW, canvasH)
}

async function blurZonesFallback(base: Buffer, zones: NormBox[], canvasW: number, canvasH: number): Promise<Buffer> {
  const composites: sharp.OverlayOptions[] = []
  for (const box of zones) {
    const left = Math.round(box.x * canvasW)
    const top = Math.round(box.y * canvasH)
    const width = Math.min(Math.max(8, Math.round(box.width * canvasW)), canvasW - left)
    const height = Math.min(Math.max(8, Math.round(box.height * canvasH)), canvasH - top)
    if (width < 8 || height < 8) continue
    try {
      const patch = await sharp(base)
        .extract({ left, top, width, height })
        .blur(18)
        .modulate({ brightness: 0.92 })
        .png()
        .toBuffer()
      composites.push({ input: patch, left, top })
    } catch {
      // skip an out-of-bounds patch
    }
  }
  if (composites.length === 0) return base
  return sharp(base).composite(composites).png().toBuffer()
}

/**
 * Full extraction: read the uploaded reference poster and produce a draft
 * template (layout + clean plate + cropped logos) for the booker to confirm.
 */
export async function buildDraftTemplate(
  originalBuffer: Buffer,
  options?: { strictLayout?: boolean },
): Promise<DraftTemplate> {
  const previewBuffer = await sharp(originalBuffer, { animated: false })
    .rotate()
    .resize({ width: 768, height: 1152, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()

  const [layout, palette, meta] = await Promise.all([
    extractLayout(previewBuffer, { fallbackToDefault: !options?.strictLayout }),
    dominantPalette(previewBuffer),
    sharp(originalBuffer).rotate().metadata(),
  ])

  const canvasW = layout.canvasWidth
  const canvasH = layout.canvasHeight

  // Boxes were measured on the original aspect ratio; everything downstream
  // works on the cover-cropped canvas — remap before use.
  const mapBox = coverCropBoxMapper(meta.width ?? canvasW, meta.height ?? canvasH, canvasW, canvasH)
  const textSlots = layout.textSlots
    .flatMap((slot) => {
      const box = mapBox(slot.box)
      return box ? [{ ...slot, box }] : []
    })
  const photoFrames = layout.photoFrames
    .flatMap((frame) => {
      const box = mapBox(frame.box)
      return box ? [{ ...frame, box }] : []
    })

  // Zones to clean from the plate = photo frames + text slots (canvas frame).
  const zones: NormBox[] = [
    ...photoFrames.map(f => f.box),
    ...textSlots.map(s => s.box),
  ]

  const [rawLogoCrops, plateBuffer] = await Promise.all([
    // Crop logo pixels in the ORIGINAL frame; store their canvas-frame boxes.
    cropLogos(originalBuffer, layout.logoZones),
    buildPlate(originalBuffer, zones, canvasW, canvasH),
  ])
  const logoCrops = rawLogoCrops.flatMap((crop) => {
    const box = mapBox(crop.box)
    return box ? [{ ...crop, box }] : []
  })

  return {
    canvasWidth: canvasW,
    canvasHeight: canvasH,
    palette: layout.palette.length ? layout.palette : palette,
    textSlots,
    photoFrames,
    logoCrops,
    plateBuffer,
  }
}
