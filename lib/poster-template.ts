// Poster template schema — the deterministic "mal" a booker derives from a
// previous poster. All geometry is normalized (0..1) relative to the canvas so
// a template renders identically at any output size. Text and logos are
// composited from this data; an image model never re-renders them.

export type NormBox = {
  x: number
  y: number
  width: number
  height: number
}

export type PosterTextRole =
  | 'title'
  | 'headliner'
  | 'lineup'
  | 'date'
  | 'venue'
  | 'footer'
  | 'custom'

export type PosterTextAlign = 'left' | 'center' | 'right'
export type PosterVAlign = 'top' | 'middle' | 'bottom'

export type PosterTextSlot = {
  role: PosterTextRole
  box: NormBox
  align: PosterTextAlign
  vAlign: PosterVAlign
  color: string // hex, e.g. "#ffffff"
  fontWeight: 400 | 500 | 600 | 700
  uppercase: boolean
  maxLines: number
  letterSpacing: number // em, e.g. 0.02
  // For 'custom' slots (and an optional footer override) the literal text.
  // Data-bound roles (title/headliner/lineup/date/venue) ignore this and pull
  // from the show at render time.
  text?: string | null
}

export type PosterPhotoFrame = {
  box: NormBox
  shape: 'rect' | 'rounded' | 'circle'
  labelRatio: number // name-label height as a ratio of frame height; 0 = no label
  fontScale: number // name-label font size as a ratio of frame height
}

export type PosterLogo = {
  box: NormBox
  assetPath: string
  assetUrl: string
  fit: 'contain' | 'cover'
  align: PosterTextAlign
}

export type PosterTemplateSchema = {
  canvasWidth: number
  canvasHeight: number
  plateUrl: string | null
  palette: string[]
  textSlots: PosterTextSlot[]
  photoFrames: PosterPhotoFrame[]
  logos: PosterLogo[]
}

export type PosterTemplateRow = {
  id: string
  club_id: string
  name: string
  status: 'draft' | 'confirmed'
  source_poster_path: string | null
  source_poster_url: string | null
  plate_path: string | null
  plate_url: string | null
  canvas_width: number
  canvas_height: number
  palette: unknown
  text_slots: unknown
  photo_frames: unknown
  logos: unknown
  created_by: string | null
  created_at: string
  updated_at: string
  confirmed_at: string | null
}

export const DEFAULT_CANVAS_WIDTH = 1024
export const DEFAULT_CANVAS_HEIGHT = 1536

export function clamp01(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const v = value.trim()
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback
}

function normalizeBox(raw: unknown): NormBox {
  const box = (raw ?? {}) as Record<string, unknown>
  const x = clamp01(box.x, 0)
  const y = clamp01(box.y, 0)
  const width = clampNumber(box.width, 0.02, 1, 0.2)
  const height = clampNumber(box.height, 0.02, 1, 0.2)
  return {
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
  }
}

const TEXT_ROLES: PosterTextRole[] = ['title', 'headliner', 'lineup', 'date', 'venue', 'footer', 'custom']

function normalizeWeight(value: unknown): 400 | 500 | 600 | 700 {
  const n = Number(value)
  if (n >= 700) return 700
  if (n >= 600) return 600
  if (n >= 500) return 500
  return 400
}

export function normalizeTextSlot(raw: unknown): PosterTextSlot {
  const slot = (raw ?? {}) as Record<string, unknown>
  const role = TEXT_ROLES.includes(slot.role as PosterTextRole) ? (slot.role as PosterTextRole) : 'custom'
  const align = (['left', 'center', 'right'] as const).includes(slot.align as PosterTextAlign)
    ? (slot.align as PosterTextAlign)
    : 'center'
  const vAlign = (['top', 'middle', 'bottom'] as const).includes(slot.vAlign as PosterVAlign)
    ? (slot.vAlign as PosterVAlign)
    : 'middle'
  return {
    role,
    box: normalizeBox(slot.box),
    align,
    vAlign,
    color: normalizeHexColor(slot.color, '#ffffff'),
    fontWeight: normalizeWeight(slot.fontWeight),
    uppercase: Boolean(slot.uppercase),
    maxLines: clampNumber(slot.maxLines, 1, 6, role === 'title' ? 2 : role === 'lineup' ? 6 : 1),
    letterSpacing: clampNumber(slot.letterSpacing, -0.05, 0.4, 0),
    text: typeof slot.text === 'string' ? slot.text : null,
  }
}

export function normalizePhotoFrame(raw: unknown): PosterPhotoFrame {
  const frame = (raw ?? {}) as Record<string, unknown>
  const shape = (['rect', 'rounded', 'circle'] as const).includes(frame.shape as 'rect' | 'rounded' | 'circle')
    ? (frame.shape as 'rect' | 'rounded' | 'circle')
    : 'rounded'
  return {
    box: normalizeBox(frame.box),
    shape,
    labelRatio: clampNumber(frame.labelRatio, 0, 0.4, 0.22),
    fontScale: clampNumber(frame.fontScale, 0.05, 0.2, 0.1),
  }
}

export function normalizeLogo(raw: unknown): PosterLogo | null {
  const logo = (raw ?? {}) as Record<string, unknown>
  const assetUrl = typeof logo.assetUrl === 'string' ? logo.assetUrl : ''
  const assetPath = typeof logo.assetPath === 'string' ? logo.assetPath : ''
  if (!assetUrl) return null
  const align = (['left', 'center', 'right'] as const).includes(logo.align as PosterTextAlign)
    ? (logo.align as PosterTextAlign)
    : 'center'
  return {
    box: normalizeBox(logo.box),
    assetPath,
    assetUrl,
    fit: logo.fit === 'cover' ? 'cover' : 'contain',
    align,
  }
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

/** Build a render-ready, fully-validated schema from a DB row. */
export function templateRowToSchema(row: PosterTemplateRow): PosterTemplateSchema {
  return {
    canvasWidth: clampNumber(row.canvas_width, 256, 4096, DEFAULT_CANVAS_WIDTH),
    canvasHeight: clampNumber(row.canvas_height, 256, 4096, DEFAULT_CANVAS_HEIGHT),
    plateUrl: row.plate_url ?? row.source_poster_url ?? null,
    palette: asArray(row.palette).map((c) => normalizeHexColor(c, '#111111')),
    textSlots: asArray(row.text_slots).map(normalizeTextSlot),
    photoFrames: asArray(row.photo_frames).map(normalizePhotoFrame),
    logos: asArray(row.logos).map(normalizeLogo).filter((l): l is PosterLogo => l !== null),
  }
}

/** Validate a loosely-typed schema (e.g. from the vision extractor or editor). */
export function normalizeSchema(raw: Partial<PosterTemplateSchema> & Record<string, unknown>): PosterTemplateSchema {
  return {
    canvasWidth: clampNumber(raw.canvasWidth, 256, 4096, DEFAULT_CANVAS_WIDTH),
    canvasHeight: clampNumber(raw.canvasHeight, 256, 4096, DEFAULT_CANVAS_HEIGHT),
    plateUrl: typeof raw.plateUrl === 'string' ? raw.plateUrl : null,
    palette: asArray(raw.palette).map((c) => normalizeHexColor(c, '#111111')),
    textSlots: asArray(raw.textSlots).map(normalizeTextSlot),
    photoFrames: asArray(raw.photoFrames).map(normalizePhotoFrame),
    logos: asArray(raw.logos).map(normalizeLogo).filter((l): l is PosterLogo => l !== null),
  }
}
