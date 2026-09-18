import sharp from 'sharp'
import type OpenAI from 'openai'
import { hslToRgb, parseHexColor, rgbToHsl, toHexColor } from '@/lib/club-brand'
import { POSTER_CANVAS } from '@/lib/poster/layout'
import type { MarketingPalette } from '@/types/database'

/**
 * Bakgrunnen — den eneste delen av plakaten en bildemodell får lage.
 *
 * Modellen får verken navn, bilder eller tekst å forholde seg til. Den blir
 * bedt om en flate uten mennesker og uten bokstaver, og resultatet kontrolleres
 * for nettopp det. Alt som kan være *feil* på en plakat ligger utenfor dens
 * rekkevidde.
 *
 * Svikter modellen, tegner koden en bakgrunn selv. En plakat uten AI-bakgrunn
 * er fortsatt en riktig plakat; en plakat som aldri blir laget er ingenting.
 */

const MOODS = [
  'warm vintage paper with large soft overlapping rings and circles, 1970s print feel',
  'dark theatre stage haze with a soft spotlight cone from above and a velvet curtain texture at the edges',
  'bold screenprint shapes: big diagonal bands and half-circles, slightly misregistered ink',
  'soft studio gradient with subtle halftone dot patterns fading from the corners',
  'abstract brick-wall comedy cellar texture, heavily stylised and flat, with a soft vignette',
  'playful confetti-like geometric shapes scattered towards the edges, calm in the centre',
]

export function backgroundPrompt(palette: MarketingPalette, seed: number): string {
  return [
    'Abstract background artwork for a comedy show poster, portrait format 2:3.',
    `Style: ${MOODS[Math.abs(seed) % MOODS.length]}.`,
    `Colour palette: dominant ${palette.primary}, deep ${palette.secondary} for shadows, small touches of ${palette.accent}. Stay strictly within this palette.`,
    'This is ONLY a backdrop: photos and typography are added later by a designer.',
    'Absolutely no people, no faces, no silhouettes, no hands, no microphones held by anyone.',
    'Absolutely no text, letters, numbers, logos, signs, watermarks or symbols that resemble writing.',
    'Keep it low-contrast and even in tone across the whole canvas, with fine print grain. No frames, boxes or placeholders.',
  ].join(' ')
}

function shade(hexColor: string, lightness: number, saturation = 1): string {
  const parsed = parseHexColor(hexColor)
  if (!parsed) return hexColor
  const { h, s, l } = rgbToHsl(parsed)
  return toHexColor(hslToRgb({ h, s: Math.min(1, s * saturation), l: Math.min(0.96, Math.max(0.04, l + lightness)) }))
}

/** Bakgrunnen koden tegner selv: klubbens farge med store, myke ringer. */
export async function fallbackBackground(palette: MarketingPalette, seed: number): Promise<Buffer> {
  const { width, height } = POSTER_CANVAS
  const light = shade(palette.primary, 0.1)
  const dark = shade(palette.primary, -0.09)

  // Frøet flytter ringene, så to show i samme klubb ikke blir prikk like.
  const rand = (n: number) => {
    const x = Math.sin((seed % 9973) * 12.9898 + n * 78.233) * 43758.5453
    return x - Math.floor(x)
  }
  const rings = Array.from({ length: 5 }, (_, index) => {
    const cx = Math.round(rand(index) * width)
    const cy = Math.round(rand(index + 10) * height)
    const r = Math.round(180 + rand(index + 20) * 320)
    const stroke = index % 2 === 0 ? light : dark
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${26 + Math.round(rand(index + 30) * 30)}" opacity="0.55"/>`
  }).join('')

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="g" cx="50%" cy="38%" r="75%">
        <stop offset="0%" stop-color="${light}"/>
        <stop offset="100%" stop-color="${dark}"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    ${rings}
  </svg>`

  return sharp(Buffer.from(svg)).png().toBuffer()
}

/** True når bildet er rent: ingen mennesker, ingen tekst. */
async function isCleanBackdrop(openai: OpenAI, image: Buffer): Promise<{ clean: boolean; reason: string }> {
  const preview = await sharp(image).resize({ width: 768, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
  const response = await openai.responses.create({
    model: 'gpt-5-mini',
    reasoning: { effort: 'low' },
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'This image must be an empty poster background. Does it contain any people, faces or human silhouettes? Does it contain any text, letters, numbers or logos? Texture, shapes and patterns are fine.',
        },
        { type: 'input_image', image_url: `data:image/jpeg;base64,${preview.toString('base64')}`, detail: 'low' },
      ],
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'backdrop_check',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            has_people: { type: 'boolean' },
            has_text: { type: 'boolean' },
          },
          required: ['has_people', 'has_text'],
          additionalProperties: false,
        },
      },
    },
  })

  const parsed = JSON.parse(response.output_text) as { has_people: boolean; has_text: boolean }
  if (parsed.has_people) return { clean: false, reason: 'people in the background' }
  if (parsed.has_text) return { clean: false, reason: 'text in the background' }
  return { clean: true, reason: '' }
}

const MAX_BACKGROUND_ATTEMPTS = 2

export type GeneratedBackground = { buffer: Buffer; source: 'ai' | 'fallback' }

export async function generateBackground(
  openai: OpenAI,
  palette: MarketingPalette,
  seed: number,
): Promise<GeneratedBackground> {
  for (let attempt = 1; attempt <= MAX_BACKGROUND_ATTEMPTS; attempt++) {
    try {
      const response = await openai.images.generate({
        model: 'gpt-image-1.5',
        prompt: backgroundPrompt(palette, seed + attempt - 1),
        n: 1,
        size: '1024x1536',
        // Bakgrunnen ligger bak bilder og tekstflater. «medium» er mer enn nok,
        // og den er ferdig på en brøkdel av tiden.
        quality: 'medium',
        output_format: 'png',
      })
      const base64 = response.data?.[0]?.b64_json
      if (!base64) throw new Error('OpenAI returned no image.')
      const buffer = Buffer.from(base64, 'base64')

      // Et vern mot at modellen likevel tegner folk eller bokstaver. Svikter
      // selve kontrollen, forkastes bildet — da er det ukjent hva som står der.
      const verdict = await isCleanBackdrop(openai, buffer)
      if (verdict.clean) return { buffer, source: 'ai' }
      console.warn(`[Poster] Background attempt ${attempt}/${MAX_BACKGROUND_ATTEMPTS} rejected: ${verdict.reason}`)
    } catch (error) {
      console.warn(`[Poster] Background attempt ${attempt}/${MAX_BACKGROUND_ATTEMPTS} failed:`, error)
    }
  }

  return { buffer: await fallbackBackground(palette, seed), source: 'fallback' }
}
