import sharp from 'sharp'
import type OpenAI from 'openai'
import {
  DEFAULT_FRAME_STYLE,
  POSTER_FONT_IDS,
  normalizePosterLayout,
  type NormBox,
  type PosterLayout,
} from '@/lib/poster/layout'

/**
 * Foreslår en layout ut fra klubbens mal.
 *
 * En synsmodell peker ut bilderutene, tekstfeltene og fargene. Svaret er et
 * *forslag*: modeller treffer ikke rutekanter på pikselen, og derfor går
 * forslaget alltid via editoren, der klubben retter og bekrefter. Ingenting
 * herfra brukes på en plakat før det er gjort.
 *
 * Modellen leser bare malen. Den ser aldri artistbilder og skriver aldri noe
 * som havner på plakaten.
 */

const BOX = {
  type: 'object',
  properties: {
    x: { type: 'number', description: 'Left edge, 0-1 of image width.' },
    y: { type: 'number', description: 'Top edge, 0-1 of image height.' },
    width: { type: 'number', description: '0-1 of image width.' },
    height: { type: 'number', description: '0-1 of image height.' },
  },
  required: ['x', 'y', 'width', 'height'],
  additionalProperties: false,
} as const

const HEX = { type: 'string', description: 'Hex colour like #1a2b3c.' } as const

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    photo_frames: {
      type: 'array',
      description: 'Every area meant to hold ONE performer photo, most prominent first. Cover the photo only, not the name under it.',
      items: {
        type: 'object',
        properties: {
          box: BOX,
          shape: { type: 'string', enum: ['rect', 'rounded', 'circle'] },
          name_box: {
            anyOf: [BOX, { type: 'null' }],
            description: 'Where this performer\'s name is printed, or null if there is none.',
          },
          name_color: HEX,
          name_background: { anyOf: [HEX, { type: 'null' }], description: 'Colour of a bar behind the name, or null.' },
        },
        required: ['box', 'shape', 'name_box', 'name_color', 'name_background'],
        additionalProperties: false,
      },
    },
    supporting_frames_are_uniform_row: {
      type: 'boolean',
      description: 'True when the non-headliner frames are equally sized and arranged in a regular row or grid.',
    },
    frame_fill_colors: { type: 'array', items: HEX, description: 'Flat colours visible behind the photos inside the frames, if any.' },
    text_fields: {
      type: 'array',
      description: 'Show-specific text that changes per event. Do NOT include logos, the club name, slogans or other fixed brand text.',
      items: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            enum: ['title', 'date', 'time', 'datetime', 'venue', 'lineup', 'other'],
            description: '"lineup" = a list of names without photos. "other" = leftover event text (roles, prices, old captions) that should simply be removed.',
          },
          box: BOX,
          color: HEX,
          background: { anyOf: [HEX, { type: 'null' }], description: 'Colour of a bar or panel directly behind this text, or null.' },
          align: { type: 'string', enum: ['left', 'center', 'right'] },
          uppercase: { type: 'boolean' },
          lines: { type: 'integer', description: 'How many lines the text occupies.' },
        },
        required: ['role', 'box', 'color', 'background', 'align', 'uppercase', 'lines'],
        additionalProperties: false,
      },
    },
    title_text: { type: 'string', description: 'The show title exactly as printed on the design, or an empty string if there is none.' },
    title_is_wordmark: {
      type: 'boolean',
      description: 'True when the title is a designed wordmark rather than plain typeset text: rotated or skewed, multi-coloured, hand-lettered, outlined, or interlocked with graphics.',
    },
    closest_font: {
      type: 'string',
      enum: [...POSTER_FONT_IDS],
      description: 'Closest match for the main typography: geist (clean sans), anton (tall condensed), archivo-black (heavy grotesque), bebas-neue (condensed caps), dm-serif-display (serif), fredoka (rounded), oswald (narrow gothic).',
    },
    has_print_grain: { type: 'boolean', description: 'True when the design has visible paper grain or print texture.' },
  },
  required: ['photo_frames', 'supporting_frames_are_uniform_row', 'frame_fill_colors', 'text_fields', 'title_text', 'title_is_wordmark', 'closest_font', 'has_print_grain'],
  additionalProperties: false,
} as const

type Analysis = {
  photo_frames: Array<{
    box: NormBox
    shape: 'rect' | 'rounded' | 'circle'
    name_box: NormBox | null
    name_color: string
    name_background: string | null
  }>
  supporting_frames_are_uniform_row: boolean
  frame_fill_colors: string[]
  text_fields: Array<{
    role: 'title' | 'date' | 'time' | 'datetime' | 'venue' | 'lineup' | 'other'
    box: NormBox
    color: string
    background: string | null
    align: 'left' | 'center' | 'right'
    uppercase: boolean
    lines: number
  }>
  title_text: string
  title_is_wordmark: boolean
  closest_font: (typeof POSTER_FONT_IDS)[number]
  has_print_grain: boolean
}

function union(boxes: NormBox[]): NormBox {
  const x = Math.min(...boxes.map((box) => box.x))
  const y = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))
  return { x, y, width: right - x, height: bottom - y }
}

/**
 * Gjør modellens funn om til en layout.
 *
 * Står støtterutene i en jevn rad, blir de til ett fleksibelt lineupfelt i
 * stedet for N faste ruter: da følger antallet lineupen, og klubben slipper én
 * mal per lineupstørrelse. Den største ruten beholdes som fast hovedrute.
 */
export function layoutFromAnalysis(analysis: Analysis, canvas: { width: number; height: number }): PosterLayout {
  const frames = analysis.photo_frames
  const area = (box: NormBox) => box.width * box.height
  const hero = frames.length > 1 && area(frames[0].box) > area(frames[1].box) * 1.6 ? frames[0] : null
  const supporting = hero ? frames.slice(1) : frames
  const flexible = analysis.supporting_frames_are_uniform_row && supporting.length >= 2

  const labelSource = supporting.find((frame) => frame.name_box) ?? frames.find((frame) => frame.name_box)
  const labelUnderPhoto = labelSource?.name_box
    && Math.abs(labelSource.name_box.y - (labelSource.box.y + labelSource.box.height)) < 0.02

  const nameField = (frame: Analysis['photo_frames'][number]) => (frame.name_box
    ? {
      box: frame.name_box,
      font: analysis.closest_font,
      color: frame.name_color,
      background: frame.name_background,
      align: 'center' as const,
      vAlign: 'middle' as const,
      uppercase: true,
      maxLines: 2,
      letterSpacing: 0.02,
    }
    : null)

  const fixed = flexible ? (hero ? [hero] : []) : frames

  // Et ordmerke er en del av merkevaren, og koden kan ikke sette det like
  // godt som designeren gjorde. Det blir stående som piksler. Layouten husker
  // hva det står, så et show med en annen tittel blir stoppet i stedet for å få
  // feil tittel på plakaten.
  const keepTitle = analysis.title_is_wordmark && analysis.title_text.trim() !== ''

  // Navn står under bildene sine. Løse navnelister i en mal med ruter er
  // gammel tekst som skal bort — bare en mal helt uten ruter får et lineupfelt.
  const isStray = (field: Analysis['text_fields'][number]) => (
    field.role === 'other'
    || (field.role === 'lineup' && frames.length > 0)
    || (field.role === 'title' && keepTitle)
  )

  return normalizePosterLayout({
    canvas,
    frames: fixed.map((frame, index) => ({
      id: `frame-${index + 1}`,
      box: frame.box,
      shape: frame.shape,
      // En navnestripe rett under bildet tegnes av rutestilen; alt annet er et
      // eget felt som hører til akkurat denne ruten.
      nameField: frame === hero || !labelUnderPhoto ? nameField(frame) : null,
    })),
    lineupArea: flexible
      ? {
        box: union(supporting.flatMap((frame) => (frame.name_box ? [frame.box, frame.name_box] : [frame.box]))),
        maxFrames: 8,
        gap: 0.02,
      }
      : null,
    frameStyle: {
      shape: supporting[0]?.shape ?? 'rect',
      fills: analysis.frame_fill_colors.length > 0 ? analysis.frame_fill_colors : DEFAULT_FRAME_STYLE.fills,
      label: labelSource?.name_box
        ? {
          font: analysis.closest_font,
          color: labelSource.name_color,
          background: labelSource.name_background,
          uppercase: true,
          letterSpacing: 0.02,
          heightRatio: Math.min(0.3, Math.max(0.06, labelSource.name_box.height / labelSource.box.height)),
        }
        : null,
    },
    textFields: analysis.text_fields
      .filter((field) => !isStray(field))
      .map((field, index) => ({
        id: `${field.role}-${index + 1}`,
        role: field.role,
        box: field.box,
        font: analysis.closest_font,
        color: field.color,
        background: field.background,
        align: field.align,
        vAlign: 'middle',
        uppercase: field.uppercase,
        maxLines: Math.max(1, Math.min(4, field.lines)),
        letterSpacing: 0.02,
      })),
    clearZones: analysis.text_fields
      .filter((field) => isStray(field) && field.role !== 'title')
      .map((field) => field.box),
    grain: analysis.has_print_grain ? 0.3 : 0,
    blankTemplate: false,
    fixedTitle: keepTitle ? analysis.title_text : null,
  })
}

export async function analyzeTemplate(
  openai: OpenAI,
  original: Buffer,
  canvas: { width: number; height: number },
): Promise<PosterLayout> {
  const preview = await sharp(original, { animated: false })
    .rotate()
    .resize({ width: 1024, height: 1536, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer()

  const response = await openai.responses.create({
    model: 'gpt-5-mini',
    reasoning: { effort: 'medium' },
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            'This is a comedy club\'s poster template (or a previous poster they want to reuse as a template).',
            'Map out what changes from show to show: the performer photo areas and the show-specific text.',
            'All coordinates are fractions of the image size, measured from the top-left corner. Be as precise as you can: boxes should hug the photo or the text block tightly.',
            'Anything that is part of the club\'s brand — logos, the club name, slogans, decorative shapes — must NOT be listed; it stays untouched.',
          ].join(' '),
        },
        { type: 'input_image', image_url: `data:image/jpeg;base64,${preview.toString('base64')}`, detail: 'high' },
      ],
    }],
    text: { format: { type: 'json_schema', name: 'poster_template', strict: true, schema: ANALYSIS_SCHEMA } },
  })

  return layoutFromAnalysis(JSON.parse(response.output_text) as Analysis, canvas)
}
