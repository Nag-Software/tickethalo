/**
 * Plakatlayouten: hvor bildene og teksten står.
 *
 * En layout er ren data — bilderuter og tekstfelt i normaliserte koordinater
 * (0–1), slik at den samme layouten rendres likt i alle oppløsninger. Den
 * beskriver enten en av de innebygde layoutene eller en klubbmal som klubben
 * har bekreftet.
 *
 * Det som gjør bytte av navn og ansikt umulig ligger i denne strukturen: en
 * bilderute eier sitt eget navnefelt. Navn settes aldri fra en frittstående
 * «headliner»-tekst — bare fra ruten artisten står i, eller fra lineup-lista
 * for dem som ikke har noen rute.
 *
 * Ingen Node-avhengigheter: editoren på klienten bruker den samme fila.
 */

export type NormBox = { x: number; y: number; width: number; height: number }

export const POSTER_FONT_IDS = [
  'geist',
  'anton',
  'archivo-black',
  'bebas-neue',
  'dm-serif-display',
  'fredoka',
  'oswald',
] as const
export type PosterFontId = (typeof POSTER_FONT_IDS)[number]

export const POSTER_FONT_LABELS: Record<PosterFontId, string> = {
  geist: 'Geist — clean sans',
  anton: 'Anton — tall condensed',
  'archivo-black': 'Archivo Black — heavy grotesque',
  'bebas-neue': 'Bebas Neue — condensed caps',
  'dm-serif-display': 'DM Serif Display — editorial serif',
  fredoka: 'Fredoka — rounded and friendly',
  oswald: 'Oswald — narrow gothic',
}

/** `custom` peker på klubbens egen fontfil i `PosterLayout.customFont`. */
export type PosterFontRef = PosterFontId | 'custom'

export const POSTER_TEXT_ROLES = ['title', 'date', 'time', 'datetime', 'venue', 'lineup', 'footer', 'custom'] as const
export type PosterTextRole = (typeof POSTER_TEXT_ROLES)[number]

export const POSTER_TEXT_ROLE_LABELS: Record<PosterTextRole, string> = {
  title: 'Show title',
  date: 'Date',
  time: 'Time',
  datetime: 'Date and time',
  venue: 'Venue',
  lineup: 'Names without a photo',
  footer: 'Footer',
  custom: 'Own text',
}

export type PosterTextStyle = {
  font: PosterFontRef
  color: string
  align: 'left' | 'center' | 'right'
  vAlign: 'top' | 'middle' | 'bottom'
  uppercase: boolean
  maxLines: number
  /** I em, f.eks. 0.04. */
  letterSpacing: number
  /** Flatefarge bak teksten. Null = teksten står rett på bakgrunnen. */
  background: string | null
}

export type PosterTextField = PosterTextStyle & {
  id: string
  role: PosterTextRole
  box: NormBox
  /** Teksten for `custom`, og valgfri overstyring for `footer`. */
  text: string | null
}

export type PosterFrameShape = 'rect' | 'rounded' | 'circle'

export type PosterFrameStyle = {
  shape: PosterFrameShape
  /** Flatefargene bak bildene, brukt på rundgang rute for rute. */
  fills: string[]
  /** Navnestripa under bildet. Null = ruten har ikke navn under seg. */
  label: (Omit<PosterTextStyle, 'align' | 'vAlign' | 'maxLines'> & {
    /** Stripas høyde som andel av rutas høyde. */
    heightRatio: number
  }) | null
}

/** En rute som er tegnet inn i malen på et fast sted. */
export type PosterPhotoFrame = {
  id: string
  box: NormBox
  shape: PosterFrameShape
  /**
   * Navnefeltet som hører til ruten, når det står et annet sted enn rett under
   * bildet. Null = bruk `frameStyle.label`, eller ingen navn hvis den er null.
   */
  nameField: (PosterTextStyle & { box: NormBox }) | null
}

/**
 * Et område der koden selv tegner rutene.
 *
 * Malen sier bare hvor lineupen skal stå og hvordan en rute ser ut. Antallet
 * følger lineupen, så fem komikere gir fem ruter uten at klubben trenger en
 * egen mal for det.
 */
export type PosterLineupArea = {
  box: NormBox
  maxFrames: number
  /** Avstand mellom rutene som andel av områdets bredde. */
  gap: number
}

export type PosterCustomFont = { name: string; url: string; path: string }

export type PosterLayout = {
  version: 1
  canvas: { width: number; height: number }
  /** Faste ruter i rangert rekkefølge — headlineren først. */
  frames: PosterPhotoFrame[]
  lineupArea: PosterLineupArea | null
  frameStyle: PosterFrameStyle
  textFields: PosterTextField[]
  /** Gammel tekst i malen som skal bort uten å erstattes. */
  clearZones: NormBox[]
  customFont: PosterCustomFont | null
  /** Korn over hele plakaten, 0–1. Binder bilder og bakgrunn sammen. */
  grain: number
  /** Malen er levert tom: ingen gamle bilder eller tekst å fjerne, og ingen AI. */
  blankTemplate: boolean
  /**
   * Tittelen som er tegnet inn i selve designet, når den er et ordmerke og
   * ikke et tekstfelt. Den blir stående som piksler — og et show med en annen
   * tittel kan derfor ikke bruke malen uten at den får et tittelfelt.
   */
  fixedTitle: string | null
}

export const POSTER_CANVAS = { width: 1024, height: 1536 } as const

export const DEFAULT_TEXT_STYLE: PosterTextStyle = {
  font: 'geist',
  color: '#ffffff',
  align: 'center',
  vAlign: 'middle',
  uppercase: true,
  maxLines: 1,
  letterSpacing: 0.02,
  background: null,
}

export const DEFAULT_FRAME_STYLE: PosterFrameStyle = {
  shape: 'rect',
  fills: ['#e9e4dc'],
  label: {
    font: 'geist',
    color: '#ffffff',
    uppercase: true,
    letterSpacing: 0.02,
    background: '#1c1917',
    heightRatio: 0.13,
  },
}

/** Hvor mange artister med bilde layouten har plass til. */
export function layoutCapacity(layout: PosterLayout): number {
  return layout.frames.length + (layout.lineupArea?.maxFrames ?? 0)
}

/** Sammenligner titler slik et menneske ville: uten hensyn til store bokstaver og tegnsetting. */
export function sameTitle(a: string, b: string): boolean {
  const flat = (value: string) => value.toLocaleLowerCase('nb-NO').replace(/[^\p{L}\p{N}]+/gu, '')
  return flat(a) === flat(b)
}

/**
 * Malens innebygde tittel, når den faktisk gjelder: et tittelfelt i layouten
 * betyr at koden skriver tittelen selv, og da er ordmerket tømt bort.
 */
export function builtInTitle(layout: PosterLayout): string | null {
  return layout.textFields.some((field) => field.role === 'title') ? null : layout.fixedTitle
}

export function hasLineupField(layout: PosterLayout): boolean {
  return layout.textFields.some((field) => field.role === 'lineup')
}

// ───────────────────────────────────────────────────────────────
// Validering — layouten kommer fra en synsmodell og fra en editor på klienten,
// så alt klemmes inn i gyldige verdier før det lagres eller rendres.
// ───────────────────────────────────────────────────────────────

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function hex(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const v = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase()
  return fallback
}

function hexOrNull(value: unknown): string | null {
  return value == null || value === '' ? null : hex(value, '#000000')
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback
}

export function normalizeBox(raw: unknown): NormBox {
  const box = (raw ?? {}) as Record<string, unknown>
  const x = num(box.x, 0, 0, 0.98)
  const y = num(box.y, 0, 0, 0.98)
  return {
    x,
    y,
    width: Math.min(num(box.width, 0.2, 0.02, 1), 1 - x),
    height: Math.min(num(box.height, 0.1, 0.01, 1), 1 - y),
  }
}

function normalizeFont(value: unknown, hasCustomFont: boolean): PosterFontRef {
  if (value === 'custom') return hasCustomFont ? 'custom' : 'geist'
  return oneOf(value, POSTER_FONT_IDS, 'geist')
}

function normalizeTextStyle(raw: Record<string, unknown>, hasCustomFont: boolean): PosterTextStyle {
  return {
    font: normalizeFont(raw.font, hasCustomFont),
    color: hex(raw.color, DEFAULT_TEXT_STYLE.color),
    align: oneOf(raw.align, ['left', 'center', 'right'] as const, 'center'),
    vAlign: oneOf(raw.vAlign, ['top', 'middle', 'bottom'] as const, 'middle'),
    uppercase: raw.uppercase !== false,
    maxLines: Math.round(num(raw.maxLines, 1, 1, 4)),
    letterSpacing: num(raw.letterSpacing, 0.02, -0.05, 0.4),
    background: hexOrNull(raw.background),
  }
}

let idCounter = 0
function ensureId(value: unknown, prefix: string): string {
  if (typeof value === 'string' && /^[a-z0-9_-]{1,40}$/i.test(value)) return value
  idCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`
}

export function normalizePosterLayout(raw: unknown): PosterLayout {
  const input = (raw ?? {}) as Record<string, unknown>
  const canvasRaw = (input.canvas ?? {}) as Record<string, unknown>
  const fontRaw = input.customFont as Record<string, unknown> | null | undefined
  const customFont = fontRaw && typeof fontRaw.url === 'string' && typeof fontRaw.path === 'string'
    ? { name: String(fontRaw.name ?? 'Club font').slice(0, 80), url: fontRaw.url, path: fontRaw.path }
    : null
  const hasCustomFont = customFont !== null

  const styleRaw = (input.frameStyle ?? {}) as Record<string, unknown>
  const labelRaw = styleRaw.label as Record<string, unknown> | null | undefined
  const fills = Array.isArray(styleRaw.fills)
    ? styleRaw.fills.map((fill) => hex(fill, '')).filter(Boolean).slice(0, 8)
    : []

  const frameStyle: PosterFrameStyle = {
    shape: oneOf(styleRaw.shape, ['rect', 'rounded', 'circle'] as const, 'rect'),
    fills: fills.length > 0 ? fills : DEFAULT_FRAME_STYLE.fills,
    label: labelRaw === null
      ? null
      : {
        font: normalizeFont(labelRaw?.font, hasCustomFont),
        color: hex(labelRaw?.color, DEFAULT_FRAME_STYLE.label!.color),
        uppercase: labelRaw?.uppercase !== false,
        letterSpacing: num(labelRaw?.letterSpacing, 0.02, -0.05, 0.4),
        background: labelRaw && 'background' in labelRaw
          ? hexOrNull(labelRaw.background)
          : DEFAULT_FRAME_STYLE.label!.background,
        heightRatio: num(labelRaw?.heightRatio, 0.13, 0.06, 0.3),
      },
  }

  const frames: PosterPhotoFrame[] = (Array.isArray(input.frames) ? input.frames : [])
    .slice(0, 16)
    .map((entry) => {
      const frame = (entry ?? {}) as Record<string, unknown>
      const nameRaw = frame.nameField as Record<string, unknown> | null | undefined
      return {
        id: ensureId(frame.id, 'frame'),
        box: normalizeBox(frame.box),
        shape: oneOf(frame.shape, ['rect', 'rounded', 'circle'] as const, frameStyle.shape),
        nameField: nameRaw ? { ...normalizeTextStyle(nameRaw, hasCustomFont), box: normalizeBox(nameRaw.box) } : null,
      }
    })

  const areaRaw = input.lineupArea as Record<string, unknown> | null | undefined
  const lineupArea: PosterLineupArea | null = areaRaw
    ? {
      box: normalizeBox(areaRaw.box),
      maxFrames: Math.round(num(areaRaw.maxFrames, 8, 1, 12)),
      gap: num(areaRaw.gap, 0.02, 0, 0.1),
    }
    : null

  // Bare ett lineupfelt: to ville ha skrevet de samme navnene to ganger.
  let lineupFields = 0
  const textFields: PosterTextField[] = (Array.isArray(input.textFields) ? input.textFields : [])
    .filter((entry) => (entry as { role?: unknown } | null)?.role !== 'lineup' || (lineupFields += 1) === 1)
    .slice(0, 24)
    .map((entry) => {
      const field = (entry ?? {}) as Record<string, unknown>
      return {
        ...normalizeTextStyle(field, hasCustomFont),
        id: ensureId(field.id, 'text'),
        role: oneOf(field.role, POSTER_TEXT_ROLES, 'custom'),
        box: normalizeBox(field.box),
        text: typeof field.text === 'string' && field.text.trim() ? field.text.trim().slice(0, 200) : null,
      }
    })

  return {
    version: 1,
    canvas: {
      width: Math.round(num(canvasRaw.width, POSTER_CANVAS.width, 512, 4096)),
      height: Math.round(num(canvasRaw.height, POSTER_CANVAS.height, 512, 4096)),
    },
    frames,
    lineupArea,
    frameStyle,
    textFields,
    clearZones: (Array.isArray(input.clearZones) ? input.clearZones : []).slice(0, 24).map(normalizeBox),
    customFont,
    grain: num(input.grain, 0, 0, 1),
    blankTemplate: input.blankTemplate === true,
    fixedTitle: typeof input.fixedTitle === 'string' && input.fixedTitle.trim()
      ? input.fixedTitle.trim().slice(0, 120)
      : null,
  }
}

/** Alt i malen som skal tømmes før ny lineup legges oppå. */
export function layoutClearZones(layout: PosterLayout): NormBox[] {
  const zones: NormBox[] = [...layout.clearZones]
  for (const frame of layout.frames) {
    zones.push(frame.box)
    if (frame.nameField) zones.push(frame.nameField.box)
    else if (layout.frameStyle.label) {
      // Navnestripa ligger rett under ruten i malen.
      const labelHeight = frame.box.height * layout.frameStyle.label.heightRatio
      zones.push(normalizeBox({ ...frame.box, y: frame.box.y + frame.box.height, height: labelHeight }))
    }
  }
  if (layout.lineupArea) zones.push(layout.lineupArea.box)
  // Fast merkevaretekst er ikke et felt i det hele tatt — den blir stående
  // som piksler i malen. Alt som *er* et felt, skrives på nytt av koden.
  for (const field of layout.textFields) zones.push(field.box)
  return zones
}
