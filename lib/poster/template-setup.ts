import sharp from 'sharp'
import type OpenAI from 'openai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MARKETING_DESIGN_BUCKET } from '@/lib/marketing/storage'
import { analyzeTemplate } from '@/lib/poster/analyze'
import { normalizePosterLayout, type PosterLayout } from '@/lib/poster/layout'
import { buildPlate, templateCanvas } from '@/lib/poster/plate'
import type { Database, MarketingLayoutStatus } from '@/types/database'

/**
 * Setter opp en klubbmal av seg selv, første gang den brukes.
 *
 * Klubben laster opp et design og velger det — ikke mer. Synsmodellen finner
 * bilderutene og tekstfeltene, platen lages, og resultatet lagres på malen så
 * neste show slipper hele runden. Blir plakaten ikke god nok, avgjør
 * kvalitetskontrollen i `generate.ts` det, ikke klubben.
 */

export type TemplateRecord = {
  id: string
  label: string | null
  fileUrl: string
  layout: unknown
  layoutStatus: MarketingLayoutStatus
  plateUrl: string | null
}

export type ReadyTemplate = { layout: PosterLayout; plate: Buffer }

async function fetchBuffer(url: string, what: string): Promise<Buffer> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`${what} could not be fetched.`)
  return Buffer.from(await response.arrayBuffer())
}

export async function ensureTemplateReady(
  db: SupabaseClient<Database>,
  openai: OpenAI,
  template: TemplateRecord,
): Promise<ReadyTemplate> {
  if (template.layoutStatus === 'confirmed' && template.plateUrl && template.layout) {
    return { layout: normalizePosterLayout(template.layout), plate: await fetchBuffer(template.plateUrl, 'The template background') }
  }

  const original = await fetchBuffer(template.fileUrl, 'The template file')
  const layout = await analyzeTemplate(openai, original, await templateCanvas(original))
  if (layout.frames.length === 0 && !layout.lineupArea) {
    throw new Error('No photo areas were found in the template.')
  }

  const plate = await buildPlate(openai, original, layout)
  const path = `plates/${template.id}/plate-${Date.now()}.png`
  const { error: uploadError } = await db.storage
    .from(MARKETING_DESIGN_BUCKET)
    .upload(path, plate.buffer, { contentType: 'image/png', upsert: false })
  if (uploadError) throw new Error(`Could not save the template background: ${uploadError.message}`)

  const { error } = await db.from('show_marketing_designs')
    .update({
      poster_layout: layout,
      layout_status: 'confirmed',
      plate_url: db.storage.from(MARKETING_DESIGN_BUCKET).getPublicUrl(path).data.publicUrl,
      plate_path: path,
    })
    .eq('id', template.id)
  if (error) throw new Error(error.message)

  return { layout, plate: plate.buffer }
}

/** Glemmer oppsettet, så malen settes opp på nytt neste gang den brukes. */
export async function resetTemplateSetup(db: SupabaseClient<Database>, templateId: string, platePath: string | null) {
  if (platePath) await db.storage.from(MARKETING_DESIGN_BUCKET).remove([platePath])
  await db.from('show_marketing_designs')
    .update({ poster_layout: null, layout_status: 'none', plate_url: null, plate_path: null })
    .eq('id', templateId)
}

/**
 * Ser på den ferdige plakaten med malens øyne: ble dette bra?
 *
 * Navn, ansikter og tekst er riktige uansett — det sørger koden for. Dette
 * handler bare om utseende: et bilde som dekker logoen, rester av den gamle
 * lineupen, tekst oppå tekst. Svikter kontrollen selv, godtas plakaten ikke.
 */
export async function templatePosterLooksGood(openai: OpenAI, poster: Buffer): Promise<{ ok: boolean; reason: string }> {
  const preview = await sharp(poster).resize({ width: 900, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()
  const response = await openai.responses.create({
    model: 'gpt-5-mini',
    reasoning: { effort: 'low' },
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            'This comedy show poster was assembled automatically by placing photos and text onto a club\'s template. Judge only the layout quality.',
            'Report a problem if: a photo or text block covers part of the title, a logo or other lettering; leftover faces, body parts or names from an older lineup are visible outside the photo slots; text overlaps other text; a photo slot or text panel is obviously misplaced or collides with a design element; or large awkward flat patches break the design.',
            'Do not judge the photos themselves, the people, or the wording.',
          ].join(' '),
        },
        { type: 'input_image', image_url: `data:image/jpeg;base64,${preview.toString('base64')}`, detail: 'high' },
      ],
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'poster_quality',
        strict: true,
        schema: {
          type: 'object',
          properties: { has_problem: { type: 'boolean' }, problem: { type: 'string', description: 'Short description, or empty.' } },
          required: ['has_problem', 'problem'],
          additionalProperties: false,
        },
      },
    },
  })
  const parsed = JSON.parse(response.output_text) as { has_problem: boolean; problem: string }
  return { ok: !parsed.has_problem, reason: parsed.problem }
}
