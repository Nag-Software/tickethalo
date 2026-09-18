import sharp from 'sharp'
import { toFile } from 'openai'
import type OpenAI from 'openai'
import { layoutClearZones, type NormBox, type PosterLayout } from '@/lib/poster/layout'

/**
 * Platen: klubbmalen med bilderuter og utskiftbar tekst tømt.
 *
 * Bildemodellen får viske ut de gamle ansiktene og den gamle teksten, men
 * resultatet brukes bare *i og like rundt feltene* der noe faktisk ble fjernet.
 * Alt annet limes tilbake fra originalfila, piksel for piksel. Logo, farger og dekor er dermed
 * identiske med originalen — ikke «nesten like», som når modellen får tegne
 * hele bildet på nytt.
 *
 * Platen lages én gang per mal og brukes av alle show som velger den.
 */

type PixelBox = { left: number; top: number; width: number; height: number }

/** Lerretet følger malens eget format; bare størrelsen begrenses. */
export async function templateCanvas(original: Buffer): Promise<{ width: number; height: number }> {
  const meta = await sharp(original, { animated: false }).rotate().metadata()
  const width = meta.width ?? 1024
  const height = meta.height ?? 1536
  const scale = Math.min(1, 2048 / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

async function normalizeOriginal(original: Buffer, canvas: { width: number; height: number }): Promise<Buffer> {
  return sharp(original, { animated: false })
    .rotate()
    .toColorspace('srgb')
    .resize({ width: canvas.width, height: canvas.height, fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer()
}

/** Feltet i piksler, med litt slakk så kanten av gammel tekst også blir med. */
function zoneToPixels(zone: NormBox, canvas: { width: number; height: number }, bleed: number): PixelBox {
  const left = Math.max(0, Math.round(zone.x * canvas.width) - bleed)
  const top = Math.max(0, Math.round(zone.y * canvas.height) - bleed)
  const right = Math.min(canvas.width, Math.round((zone.x + zone.width) * canvas.width) + bleed)
  const bottom = Math.min(canvas.height, Math.round((zone.y + zone.height) * canvas.height) + bleed)
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

/**
 * Tømmer feltene uten AI: hvert felt fylles med fargen som ligger rundt det.
 * På flate design er det ikke til å skille fra originalen. Brukes også til
 * forhåndsvisning, der det ikke er verdt å vente på bildemodellen.
 */
export async function fillZones(normalized: Buffer, zones: PixelBox[], canvas: { width: number; height: number }): Promise<Buffer> {
  const fills: sharp.OverlayOptions[] = []
  for (const zone of zones) {
    const ring = 6
    const outer = {
      left: Math.max(0, zone.left - ring),
      top: Math.max(0, zone.top - ring),
      width: Math.min(canvas.width - Math.max(0, zone.left - ring), zone.width + ring * 2),
      height: Math.min(canvas.height - Math.max(0, zone.top - ring), zone.height + ring * 2),
    }
    // Ringen rundt feltet, med selve feltet maskert bort, krympes til én piksel
    // — gjennomsnittsfargen av det som omgir feltet.
    const hole = Buffer.from(
      `<svg width="${outer.width}" height="${outer.height}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${zone.left - outer.left}" y="${zone.top - outer.top}" width="${zone.width}" height="${zone.height}" fill="#000"/>
      </svg>`,
    )
    const ringOnly = await sharp(normalized)
      .extract(outer)
      .ensureAlpha()
      .composite([{ input: hole, blend: 'dest-out' }])
      .png()
      .toBuffer()
    const { data, info } = await sharp(ringOnly).raw().toBuffer({ resolveWithObject: true })
    let r = 0, g = 0, b = 0, weight = 0
    for (let i = 0; i < data.length; i += info.channels) {
      const alpha = data[i + 3] / 255
      r += data[i] * alpha
      g += data[i + 1] * alpha
      b += data[i + 2] * alpha
      weight += alpha
    }
    const color = weight > 0
      ? { r: Math.round(r / weight), g: Math.round(g / weight), b: Math.round(b / weight) }
      : { r: 255, g: 255, b: 255 }

    fills.push({
      input: await sharp({ create: { width: zone.width, height: zone.height, channels: 3, background: color } }).png().toBuffer(),
      left: zone.left,
      top: zone.top,
    })
  }
  return sharp(normalized).composite(fills).png().toBuffer()
}

/** Sender malen til bildemodellen i et format den tar, og får samme utsnitt tilbake. */
async function inpaint(openai: OpenAI, normalized: Buffer, canvas: { width: number; height: number }): Promise<Buffer> {
  const portrait = canvas.height >= canvas.width
  const target = portrait ? { width: 1024, height: 1536 } : { width: 1536, height: 1024 }
  const scale = Math.min(target.width / canvas.width, target.height / canvas.height)
  const inner = { width: Math.round(canvas.width * scale), height: Math.round(canvas.height * scale) }
  const offset = { left: Math.floor((target.width - inner.width) / 2), top: Math.floor((target.height - inner.height) / 2) }

  const padded = await sharp(normalized)
    .resize({ width: inner.width, height: inner.height, fit: 'fill' })
    .extend({
      top: offset.top,
      bottom: target.height - inner.height - offset.top,
      left: offset.left,
      right: target.width - inner.width - offset.left,
      extendWith: 'mirror',
    })
    .png()
    .toBuffer()

  // Ingen maske: modellen får se hele designet og forstå det. Et bånd som går
  // på skrå bak et bilde skal fortsette der bildet sto, og det klarer den bare
  // når den ser båndet. Hva den ellers måtte finne på å endre spiller ingen
  // rolle — bare feltene limes inn i platen, resten kommer fra originalen.
  const response = await openai.images.edit({
    model: 'gpt-image-1.5',
    image: await toFile(padded, 'template.png', { type: 'image/png' }),
    prompt: [
      'Turn this poster into a clean, reusable template.',
      'Remove every person and portrait photo, every performer name, and the event details (date, time, venue, role captions).',
      'Where a photo sat inside a frame or coloured panel, keep that frame or panel and leave it empty and flat.',
      'Where content overlapped a band, shape, texture or pattern, continue that band, shape, texture or pattern seamlessly underneath, as if the content had never been there.',
      'Keep the layout, colours, textures, decorative graphics, logos and brand lettering exactly as they are.',
      'Do not add any new people, text, letters, logos, frames or objects.',
    ].join(' '),
    n: 1,
    size: portrait ? '1024x1536' : '1536x1024',
    quality: 'high',
    input_fidelity: 'high',
    output_format: 'png',
  })

  const base64 = response.data?.[0]?.b64_json
  if (!base64) throw new Error('OpenAI returned no image.')

  // Tre steg, tre kall: sharp tar bare én `resize` per kjede, og den siste
  // ville ellers ha overstyrt den første før utsnittet ble tatt.
  const sized = await sharp(Buffer.from(base64, 'base64'))
    .resize({ width: target.width, height: target.height, fit: 'fill' })
    .toBuffer()
  const cropped = await sharp(sized)
    .extract({ left: offset.left, top: offset.top, width: inner.width, height: inner.height })
    .toBuffer()
  return sharp(cropped)
    .resize({ width: canvas.width, height: canvas.height, fit: 'fill' })
    .png()
    .toBuffer()
}

/**
 * Hvor den tømte versjonen får erstatte originalen.
 *
 * Feltene kommer fra en synsmodell og treffer ikke på pikselen: et hode stikker
 * opp over ruta, et navn står rett under. Derfor brukes ikke feltene alene.
 * Innenfor en marg rundt hvert felt erstattes også alt som faktisk *ble
 * endret* — forskjellen mellom originalen og den tømte versjonen. Utenfor
 * margen røres ingenting, uansett hva modellen har gjort der.
 */
async function changeMask(normalized: Buffer, edited: Buffer, zones: PixelBox[], canvas: { width: number; height: number }): Promise<Buffer> {
  const margin = Math.round(Math.min(canvas.width, canvas.height) * 0.09)
  const rects = (grow: number) => Buffer.from(
    `<svg width="${canvas.width}" height="${canvas.height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#000"/>${
      zones.map((z) => `<rect x="${z.left - grow}" y="${z.top - grow}" width="${z.width + grow * 2}" height="${z.height + grow * 2}" fill="#fff"/>`).join('')
    }</svg>`,
  )

  // Forskjellen, glattet og terskelsatt to ganger: først for å fjerne støy —
  // en kant som er flyttet én piksel skal ikke telle, et hode som er borte skal
  // — så for å la flekkene vokse sammen til hele hoder og hele tekstlinjer.
  // Hvert steg er sitt eget kall. sharp kjører operasjonene i sin egen faste
  // rekkefølge innenfor én kjede — `composite` kommer *etter* `blur` og
  // `threshold` — så en sammenslått kjede ville ha terskelsatt originalen og
  // ikke forskjellen.
  const difference = await sharp(normalized).composite([{ input: edited, blend: 'difference' }]).png().toBuffer()
  const changed = await sharp(difference).greyscale().blur(6).threshold(40).png().toBuffer()
  const grown = await sharp(changed).blur(9).threshold(14).png().toBuffer()
  const nearZones = await sharp(grown).composite([{ input: rects(margin), blend: 'multiply' }]).png().toBuffer()
  const combined = await sharp(nearZones).composite([{ input: rects(0), blend: 'lighten' }]).png().toBuffer()
  return sharp(combined).greyscale().blur(2).extractChannel(0).toBuffer()
}

/** Står det igjen folk, artistnavn eller gamle datoer på platen? */
async function plateIsClean(openai: OpenAI, plate: Buffer): Promise<boolean> {
  const preview = await sharp(plate).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
  const response = await openai.responses.create({
    model: 'gpt-5-mini',
    reasoning: { effort: 'low' },
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: 'This should be an EMPTY poster template. Does it still show any person, face or part of a person (hair, a hand, a shoulder)? Does it still show performer names, dates, times or an address? The show title, logos and brand lettering are expected and fine.',
        },
        { type: 'input_image', image_url: `data:image/jpeg;base64,${preview.toString('base64')}`, detail: 'high' },
      ],
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'plate_check',
        strict: true,
        schema: {
          type: 'object',
          properties: { has_people: { type: 'boolean' }, has_event_text: { type: 'boolean' } },
          required: ['has_people', 'has_event_text'],
          additionalProperties: false,
        },
      },
    },
  })
  const parsed = JSON.parse(response.output_text) as { has_people: boolean; has_event_text: boolean }
  return !parsed.has_people && !parsed.has_event_text
}

export type BuiltPlate = { buffer: Buffer; method: 'original' | 'ai' | 'fill' }

const MAX_PLATE_ATTEMPTS = 2

export async function buildPlate(openai: OpenAI, original: Buffer, layout: PosterLayout): Promise<BuiltPlate> {
  const normalized = await normalizeOriginal(original, layout.canvas)
  const zones = layoutClearZones(layout).map((zone) => zoneToPixels(zone, layout.canvas, 6))

  if (layout.blankTemplate || zones.length === 0) return { buffer: normalized, method: 'original' }

  for (let attempt = 1; attempt <= MAX_PLATE_ATTEMPTS; attempt++) {
    try {
      const edited = await inpaint(openai, normalized, layout.canvas)
      const mask = await changeMask(normalized, edited, zones, layout.canvas)
      // To steg: i én kjede ville sharp ha fjernet alfakanalen *etter* at
      // masken ble lagt på, og hele bildet ville blitt byttet ut.
      const rgb = await sharp(edited).removeAlpha().png().toBuffer()
      const patch = await sharp(rgb).joinChannel(mask).png().toBuffer()
      const plate = await sharp(normalized).composite([{ input: patch }]).png().toBuffer()
      if (await plateIsClean(openai, plate)) return { buffer: plate, method: 'ai' }
      console.warn(`[Poster] Plate attempt ${attempt}/${MAX_PLATE_ATTEMPTS} still had people or event text.`)
    } catch (error) {
      console.warn(`[Poster] Plate attempt ${attempt}/${MAX_PLATE_ATTEMPTS} failed:`, error)
    }
  }

  return { buffer: await fillZones(normalized, zones, layout.canvas), method: 'fill' }
}

/** Platen uten AI — til forhåndsvisning mens klubben flytter på feltene. */
export async function quickPlate(original: Buffer, layout: PosterLayout): Promise<Buffer> {
  const normalized = await normalizeOriginal(original, layout.canvas)
  if (layout.blankTemplate) return normalized
  const zones = layoutClearZones(layout).map((zone) => zoneToPixels(zone, layout.canvas, 6))
  return zones.length > 0 ? fillZones(normalized, zones, layout.canvas) : normalized
}
