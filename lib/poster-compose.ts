import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { POSTER_FONT_FAMILY } from '@/lib/poster-fonts'

// Pure, deterministic poster compositing helpers shared by the framed path and
// the template renderer. No image-model calls live here — text and faces are
// rendered with sharp + real fonts, so output is exact and reproducible.

export type PosterArtist = {
  name: string
  profileImageUrl: string | null
  roleName: string | null
}

export type PosterFaceAsset = {
  artist: PosterArtist
  buffer: Buffer | null
}

type PosterLabelLayout = {
  lines: string[]
  fontSize: number
  lineHeight: number
}

let cachedPosterFrameOverlay: Buffer | null = null
let frameOverlayLoadAttempted = false

export function escapeSvgText(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export async function fetchPosterFaceAssets(artists: PosterArtist[]): Promise<PosterFaceAsset[]> {
  const assets: PosterFaceAsset[] = []

  for (const artist of artists) {
    if (!artist.profileImageUrl) {
      assets.push({ artist, buffer: null })
      continue
    }

    try {
      const response = await fetch(artist.profileImageUrl, { cache: 'no-store' })
      if (!response.ok) {
        console.warn(`[Poster] Could not fetch profile image for ${artist.name}: ${response.status}`)
        assets.push({ artist, buffer: null })
        continue
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.startsWith('image/')) {
        console.warn(`[Poster] Invalid profile image content type for ${artist.name}: ${contentType}`)
        assets.push({ artist, buffer: null })
        continue
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const normalized = await sharp(buffer, { animated: false })
        .rotate()
        .toColorspace('srgb')
        .png()
        .toBuffer()

      assets.push({ artist, buffer: normalized })
    } catch (error) {
      console.warn(`[Poster] Failed to prepare profile image for ${artist.name}:`, error)
      assets.push({ artist, buffer: null })
    }
  }

  return assets
}

export async function buildPosterFaceTile(input: {
  name: string
  photoBuffer: Buffer | null
  width: number
  height: number
  labelHeight: number
  fontSize: number
}): Promise<Buffer> {
  const { name, photoBuffer, width, height, labelHeight, fontSize } = input
  const frameAreaHeight = Math.max(88, height - labelHeight)
  const labelY = frameAreaHeight
  const photoAreaX = 0
  const photoAreaY = 0
  const photoAreaWidth = Math.max(1, width)
  const photoAreaHeight = Math.max(1, frameAreaHeight)
  const safeName = normalizeFrameLabelName(name)
  const labelLayout = buildFrameLabelLayout({
    name: safeName,
    maxWidth: Math.max(40, width - 12),
    maxHeight: Math.max(16, labelHeight - 10),
    baseFontSize: fontSize,
  })
  const textBlockHeight = labelLayout.lines.length * labelLayout.lineHeight
  const firstLineY = Math.round(labelY + (labelHeight - textBlockHeight) / 2 + labelLayout.fontSize * 0.78)
  const textLinesSvg = labelLayout.lines.map((line, index) => {
    const y = firstLineY + index * labelLayout.lineHeight
    return `<text x="${Math.round(width / 2)}" y="${y}" text-anchor="middle" font-family="${POSTER_FONT_FAMILY}, sans-serif" font-size="${labelLayout.fontSize}" font-weight="700" fill="#f7f7f7">${escapeSvgText(line)}</text>`
  }).join('')
  const textShadowSvg = labelLayout.lines.map((line, index) => {
    const y = firstLineY + index * labelLayout.lineHeight + 1
    return `<text x="${Math.round(width / 2)}" y="${y}" text-anchor="middle" font-family="${POSTER_FONT_FAMILY}, sans-serif" font-size="${labelLayout.fontSize}" font-weight="700" fill="rgba(0,0,0,0.46)">${escapeSvgText(line)}</text>`
  }).join('')

  const photo = photoBuffer
    ? await sharp(photoBuffer)
      .resize({ width: photoAreaWidth, height: photoAreaHeight, fit: 'cover', position: 'attention' })
      .png()
      .toBuffer()
    : await createPosterFacePlaceholder(photoAreaWidth, photoAreaHeight, safeName)

  const frameOverlay = await loadPosterFrameOverlay()

  const baseSvg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${textShadowSvg}
      ${textLinesSvg}
    </svg>
  `)

  const frameComposite = frameOverlay
    ? await sharp(frameOverlay)
      .resize({ width, height: frameAreaHeight, fit: 'fill' })
      .png()
      .toBuffer()
    : null

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: baseSvg, left: 0, top: 0 },
      { input: photo, left: photoAreaX, top: photoAreaY },
      ...(frameComposite ? [{ input: frameComposite, left: 0, top: 0 }] : []),
    ])
    .png()
    .toBuffer()
}

async function loadPosterFrameOverlay(): Promise<Buffer | null> {
  if (cachedPosterFrameOverlay) return cachedPosterFrameOverlay
  if (frameOverlayLoadAttempted) return null

  frameOverlayLoadAttempted = true

  try {
    const framePath = path.join(process.cwd(), 'public', 'frame.png')
    const rawBuffer = await readFile(framePath)
    const normalized = await sharp(rawBuffer, { animated: false })
      .rotate()
      .toColorspace('srgb')
      .png()
      .toBuffer()

    cachedPosterFrameOverlay = normalized
    return normalized
  } catch (error) {
    console.warn('[Poster] Could not load /public/frame.png, using fallback frame style:', error)
    return null
  }
}

async function createPosterFacePlaceholder(width: number, height: number, name: string): Promise<Buffer> {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('') || '?'

  const fontSize = Math.max(20, Math.round(Math.min(width, height) * 0.28))
  const svg = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#262626"/>
          <stop offset="100%" stop-color="#404040"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="${POSTER_FONT_FAMILY}, sans-serif" font-size="${fontSize}" font-weight="800" fill="#f5f5f5">${escapeSvgText(initials)}</text>
    </svg>
  `)

  return sharp(svg).png().toBuffer()
}

function truncatePosterName(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(1, maxLength - 3)).trimEnd()}...`
}

function normalizeFrameLabelName(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (!compact) return 'Artist'

  const parts = compact.split(' ').filter(Boolean)
  const firstLast = parts.length >= 3 ? `${parts[0]} ${parts[parts.length - 1]}` : compact
  const preferred = firstLast.length <= compact.length ? firstLast : compact
  return truncatePosterName(preferred, 30)
}

function buildFrameLabelLayout(input: {
  name: string
  maxWidth: number
  maxHeight: number
  baseFontSize: number
}): PosterLabelLayout {
  const { name, maxWidth, maxHeight, baseFontSize } = input
  const candidates = getLabelLineCandidates(name)

  let best: PosterLabelLayout | null = null

  for (const lines of candidates) {
    const lineCount = lines.length
    const largestLineLength = Math.max(...lines.map(line => line.length))

    for (let size = baseFontSize; size >= 12; size -= 1) {
      const lineHeight = Math.max(size + 2, Math.round(size * 1.16))
      const totalHeight = lineHeight * lineCount
      const estimatedWidth = largestLineLength * size * 0.56
      if (estimatedWidth <= maxWidth && totalHeight <= maxHeight) {
        if (!best || size > best.fontSize) {
          best = { lines, fontSize: size, lineHeight }
        }
        break
      }
    }
  }

  if (best) return best

  const fallbackFont = 12
  const maxChars = Math.max(6, Math.floor(maxWidth / (fallbackFont * 0.56)))
  return {
    lines: [truncatePosterName(name, maxChars)],
    fontSize: fallbackFont,
    lineHeight: 14,
  }
}

function getLabelLineCandidates(name: string): string[][] {
  const compact = name.replace(/\s+/g, ' ').trim()
  if (!compact) return [['Artist']]

  const candidates: string[][] = [[compact]]
  const words = compact.split(' ').filter(Boolean)

  if (words.length >= 2) {
    let bestSplit: string[] | null = null
    let bestScore = Number.POSITIVE_INFINITY

    for (let i = 1; i < words.length; i += 1) {
      const left = words.slice(0, i).join(' ')
      const right = words.slice(i).join(' ')
      const score = Math.abs(left.length - right.length) + Math.max(left.length, right.length) * 0.25
      if (score < bestScore) {
        bestScore = score
        bestSplit = [left, right]
      }
    }

    if (bestSplit) {
      candidates.push(bestSplit)
    }
  }

  if (compact.length > 20 && words.length === 1) {
    const midpoint = Math.floor(compact.length / 2)
    candidates.push([compact.slice(0, midpoint), compact.slice(midpoint)])
  }

  return candidates
}
