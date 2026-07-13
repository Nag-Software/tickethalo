import sharp from 'sharp'
import { getOpenAI } from '@/lib/openai'

// Deterministic logo repair for AI-generated posters. Image models cannot
// reliably reproduce small logo lettering («Broremann BAR» becomes
// «Bewangers BAR»), so after generation the reference's REAL logo pixels are
// pasted over the corresponding logos in the output. Every step is
// best-effort and fail-open: any uncertainty returns the poster untouched.

type NormBox = { x: number; y: number; width: number; height: number }

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

function clamp01(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function normalizeZones(raw: unknown): NormBox[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const box = (entry ?? {}) as Record<string, unknown>
    const x = clamp01(box.x)
    const y = clamp01(box.y)
    const width = Math.min(clamp01(box.width), 1 - x)
    const height = Math.min(clamp01(box.height), 1 - y)
    if (width < 0.01 || height < 0.01 || width > 0.5 || height > 0.3) return []
    return [{ x, y, width, height }]
  }).slice(0, 4)
}

/** Ask the vision model for logo bounding boxes in an image. */
async function locateLogoZones(image: Buffer): Promise<NormBox[]> {
  const preview = await sharp(image, { animated: false })
    .rotate()
    .resize({ width: 768, height: 1152, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer()

  const openai = getOpenAI()
  const response = await openai.responses.create({
    model: 'gpt-4.1-mini',
    temperature: 0,
    store: false,
    input: [
      {
        role: 'system',
        content: [{
          type: 'input_text',
          text: 'You locate logos on event posters and return JSON only (no markdown). Coordinates are normalized 0..1 relative to the full image.',
        }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [
              'Locate every club/sponsor/venue LOGO or circular brand stamp on this poster.',
              'Logos only — NOT comedian portraits, NOT plain text lines, NOT decorative graphics.',
              'Return JSON exactly like: {"logoZones":[{"x":0.02,"y":0.9,"width":0.12,"height":0.07}]}',
              'Each box must tightly contain one whole logo. Empty array if there are none.',
            ].join('\n'),
          },
          {
            type: 'input_image',
            image_url: `data:image/jpeg;base64,${preview.toString('base64')}`,
            detail: 'high',
          },
        ],
      },
    ],
  })

  const json = extractJsonObject(response.output_text ?? '')
  if (!json) return []
  const parsed = JSON.parse(json) as Record<string, unknown>
  return normalizeZones(parsed.logoZones)
}

function center(box: NormBox) {
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
}

function iou(a: NormBox, b: NormBox): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  const inter = Math.max(0, right - left) * Math.max(0, bottom - top)
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}

/** Merge overlapping detections (the model sometimes boxes a logo twice). */
function mergeOverlapping(zones: NormBox[]): NormBox[] {
  const merged: NormBox[] = []
  for (const zone of zones) {
    const hit = merged.findIndex((existing) => iou(existing, zone) > 0.25)
    if (hit === -1) {
      merged.push({ ...zone })
      continue
    }
    const existing = merged[hit]
    const left = Math.min(existing.x, zone.x)
    const top = Math.min(existing.y, zone.y)
    const right = Math.max(existing.x + existing.width, zone.x + zone.width)
    const bottom = Math.max(existing.y + existing.height, zone.y + zone.height)
    merged[hit] = { x: left, y: top, width: right - left, height: bottom - top }
  }
  return merged
}

const EDGE_EPS = 0.015

function touchesEdge(box: NormBox): boolean {
  return box.x < EDGE_EPS || box.y < EDGE_EPS
    || box.x + box.width > 1 - EDGE_EPS
    || box.y + box.height > 1 - EDGE_EPS
}

/**
 * Sample the ring just outside a zone; if it is close to a single color,
 * return it (the zone sits on a uniform bar/panel). Null when busy.
 */
async function uniformBorderColor(
  image: Buffer,
  zone: NormBox,
  width: number,
  height: number,
): Promise<{ r: number; g: number; b: number } | null> {
  try {
    const raw = await sharp(image).removeAlpha().raw().toBuffer()
    const left = Math.round(zone.x * width)
    const top = Math.round(zone.y * height)
    const right = Math.min(width - 1, left + Math.round(zone.width * width))
    const bottom = Math.min(height - 1, top + Math.round(zone.height * height))
    const pad = Math.max(4, Math.round(Math.min(width, height) * 0.01))

    const samples: Array<[number, number, number]> = []
    const push = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return
      const i = (y * width + x) * 3
      samples.push([raw[i], raw[i + 1], raw[i + 2]])
    }
    for (let x = left - pad; x <= right + pad; x += 6) {
      push(x, top - pad)
      push(x, bottom + pad)
    }
    for (let y = top - pad; y <= bottom + pad; y += 6) {
      push(left - pad, y)
      push(right + pad, y)
    }
    if (samples.length < 12) return null

    const mean = samples.reduce(
      (acc, [r, g, b]) => ({ r: acc.r + r / samples.length, g: acc.g + g / samples.length, b: acc.b + b / samples.length }),
      { r: 0, g: 0, b: 0 },
    )
    const spread = samples.reduce((acc, [r, g, b]) =>
      acc + Math.abs(r - mean.r) + Math.abs(g - mean.g) + Math.abs(b - mean.b), 0) / samples.length
    if (spread > 36) return null
    return { r: Math.round(mean.r), g: Math.round(mean.g), b: Math.round(mean.b) }
  } catch {
    return null
  }
}

/**
 * Paste the reference's real logo pixels over the generated poster's
 * (re-drawn, often corrupted) logos. Zones are matched by nearest relative
 * position; unmatched or distant zones are left alone.
 */
export async function patchLogosFromReference(poster: Buffer, referenceBuffer: Buffer): Promise<Buffer> {
  try {
    const [rawReferenceZones, rawPosterZones] = await Promise.all([
      locateLogoZones(referenceBuffer),
      locateLogoZones(poster),
    ])
    const referenceZones = mergeOverlapping(rawReferenceZones)
    const posterZones = mergeOverlapping(rawPosterZones)
    if (referenceZones.length === 0 || posterZones.length === 0) return poster

    const refMeta = await sharp(referenceBuffer).rotate().metadata()
    const posterMeta = await sharp(poster).metadata()
    const refW = refMeta.width ?? 0
    const refH = refMeta.height ?? 0
    const outW = posterMeta.width ?? 0
    const outH = posterMeta.height ?? 0
    if (!refW || !refH || !outW || !outH) return poster

    const composites: sharp.OverlayOptions[] = []
    const used = new Set<number>()

    for (const zone of posterZones) {
      // Nearest reference logo by center distance — logos keep their corner
      // in a template edit, so distances are small for true matches.
      let bestIndex = -1
      let bestDistance = Number.POSITIVE_INFINITY
      const { cx, cy } = center(zone)
      referenceZones.forEach((refZone, index) => {
        if (used.has(index)) return
        const rc = center(refZone)
        const distance = Math.hypot(rc.cx - cx, rc.cy - cy)
        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = index
        }
      })
      if (bestIndex < 0 || bestDistance > 0.22) continue

      const refZone = referenceZones[bestIndex]
      // A logo clipped by the reference's own edge cannot be pasted cleanly —
      // half a logo over the AI's rendition looks worse than leaving it.
      if (touchesEdge(refZone)) continue
      // Aspect guard: wildly different shapes means at least one detection is
      // wrong — pasting would smear the logo. Skip rather than distort.
      const zoneAspect = (zone.width * outW) / Math.max(1, zone.height * outH)
      const refAspect = (refZone.width * refW) / Math.max(1, refZone.height * refH)
      if (zoneAspect / refAspect > 2 || refAspect / zoneAspect > 2) continue
      used.add(bestIndex)

      const crop = await sharp(referenceBuffer)
        .rotate()
        .extract({
          left: Math.round(refZone.x * refW),
          top: Math.round(refZone.y * refH),
          width: Math.max(8, Math.round(refZone.width * refW)),
          height: Math.max(8, Math.round(refZone.height * refH)),
        })
        .png()
        .toBuffer()

      // Inflate the paste a touch so the AI's own logo rendering is fully
      // covered — but ONLY on sides away from the canvas edge. Edge-touching
      // zones are pasted exactly where detected (clamping an inflated box
      // shifts the artwork and leaves fragments of the AI logo visible).
      const inflate = touchesEdge(zone) ? 0 : 0.06
      const padX = Math.round(zone.width * outW * inflate)
      const padY = Math.round(zone.height * outH * inflate)
      const targetW = Math.min(outW, Math.round(zone.width * outW) + padX * 2)
      const targetH = Math.min(outH, Math.round(zone.height * outH) + padY * 2)
      const left = Math.max(0, Math.min(outW - targetW, Math.round(zone.x * outW) - padX))
      const top = Math.max(0, Math.min(outH - targetH, Math.round(zone.y * outH) - padY))

      // When the zone sits on a UNIFORM background (typical footer bar), a
      // slightly misdetected paste leaves fragments of the AI's logo peeking
      // out. Cover-then-paste fixes it: clean the area with the background
      // color first (generously inflated), then center the real logo on it.
      const uniform = await uniformBorderColor(poster, zone, outW, outH)
      if (uniform) {
        const coverPadX = Math.round(zone.width * outW * 0.3)
        const coverPadY = Math.round(zone.height * outH * 0.3)
        const coverW = Math.min(outW, Math.round(zone.width * outW) + coverPadX * 2)
        const coverH = Math.min(outH, Math.round(zone.height * outH) + coverPadY * 2)
        const coverLeft = Math.max(0, Math.min(outW - coverW, Math.round(zone.x * outW) - coverPadX))
        const coverTop = Math.max(0, Math.min(outH - coverH, Math.round(zone.y * outH) - coverPadY))
        const cover = await sharp({
          create: { width: coverW, height: coverH, channels: 4, background: uniform },
        }).png().toBuffer()
        composites.push({ input: cover, left: coverLeft, top: coverTop })

        const inner = await sharp(crop)
          .resize({ width: targetW, height: targetH, fit: 'inside' })
          .png()
          .toBuffer()
        const innerMeta = await sharp(inner).metadata()
        composites.push({
          input: inner,
          left: Math.max(0, Math.min(outW - (innerMeta.width ?? targetW), left + Math.round((targetW - (innerMeta.width ?? targetW)) / 2))),
          top: Math.max(0, Math.min(outH - (innerMeta.height ?? targetH), top + Math.round((targetH - (innerMeta.height ?? targetH)) / 2))),
        })
        continue
      }

      const resized = await sharp(crop)
        .resize({ width: targetW, height: targetH, fit: 'fill' })
        .png()
        .toBuffer()
      composites.push({ input: resized, left, top })
    }

    if (composites.length === 0) return poster
    return await sharp(poster).composite(composites).png().toBuffer()
  } catch (error) {
    console.warn('[Poster] Logo patch skipped:', error)
    return poster
  }
}
