'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClubAccess, getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { buildDraftTemplate } from '@/lib/poster-extract'
import { renderPosterFromTemplate } from '@/lib/poster-render'
import {
  normalizeSchema,
  templateRowToSchema,
  type PosterLogo,
  type PosterTemplateSchema,
} from '@/lib/poster-template'

const TEMPLATE_BUCKET = 'poster-templates'
const MAX_TEMPLATE_BYTES = 25 * 1024 * 1024

function fileExtension(file: File) {
  const fromName = file.name.split('.').pop()?.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  if (fromName) return fromName
  const fromMime = file.type.split('/').pop()?.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  return fromMime || 'png'
}

async function uploadTemplateAsset(path: string, body: Buffer | File, contentType: string) {
  const admin = createAdminClient()
  const { error } = await admin.storage.from(TEMPLATE_BUCKET).upload(path, body, { contentType, upsert: true })
  if (error) throw new Error(`Kunne ikke laste opp mal-fil: ${error.message}`)
  const { data } = admin.storage.from(TEMPLATE_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, path }
}

/** Verify the template belongs to a club the current admin can manage. */
async function assertTemplateAccess(templateId: string) {
  const access = await getClubAccess()
  if (access.clubIds.length === 0) throw new Error('Du har ikke tilgang til noen klubb.')
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('poster_templates')
    .select('*')
    .eq('id', templateId)
    .in('club_id', access.clubIds)
    .maybeSingle()
  if (error || !data) throw new Error('Du har ikke tilgang til denne malen.')
  return data
}

/**
 * Upload a previous poster and derive a draft template from it (clean plate +
 * text slots + photo frames + cropped logos). Returns the new template id so
 * the UI can open the editor.
 */
export async function createPosterTemplateFromUploadAction(formData: FormData): Promise<{ templateId: string }> {
  const clubId = await getDefaultClubIdForAdmin()
  const file = formData.get('template_file')
  if (!(file instanceof File) || file.size === 0) throw new Error('Velg en plakatfil.')
  if (!file.type.startsWith('image/')) throw new Error('Malen må være et bilde.')
  if (file.size > MAX_TEMPLATE_BYTES) throw new Error('Filen kan maks være 25 MB.')

  const admin = createAdminClient()
  const templateId = crypto.randomUUID()
  const originalBuffer = Buffer.from(await file.arrayBuffer())

  const source = await uploadTemplateAsset(
    `${clubId}/${templateId}/source.${fileExtension(file)}`,
    file,
    file.type,
  )

  const draft = await buildDraftTemplate(originalBuffer)

  const plate = draft.plateBuffer
    ? await uploadTemplateAsset(`${clubId}/${templateId}/plate.png`, draft.plateBuffer, 'image/png')
    : null

  const logos: PosterLogo[] = []
  for (let i = 0; i < draft.logoCrops.length; i += 1) {
    const crop = draft.logoCrops[i]
    const asset = await uploadTemplateAsset(`${clubId}/${templateId}/logo-${i}.png`, crop.buffer, 'image/png')
    logos.push({ box: crop.box, assetPath: asset.path, assetUrl: asset.url, fit: 'contain', align: 'center' })
  }

  const name = (formData.get('name') as string)?.trim() || file.name.replace(/\.[^.]+$/, '') || 'Plakatmal'

  const { error } = await admin.from('poster_templates').insert({
    id: templateId,
    club_id: clubId,
    name,
    status: 'draft',
    source_poster_path: source.path,
    source_poster_url: source.url,
    plate_path: plate?.path ?? null,
    plate_url: plate?.url ?? null,
    canvas_width: draft.canvasWidth,
    canvas_height: draft.canvasHeight,
    palette: draft.palette,
    text_slots: draft.textSlots,
    photo_frames: draft.photoFrames,
    logos,
  })
  if (error) throw new Error(`Kunne ikke lagre malen: ${error.message}`)

  revalidatePath('/admin-app/min-klubb')
  revalidatePath(`/admin-app/min-klubb/maler/${templateId}`)
  return { templateId }
}

/**
 * Migration helper: turn a club's existing "AI-referanseplakat" into a draft
 * template, so clubs already on the old AI flow get a deterministic mal derived
 * from the poster they already chose.
 */
export async function convertReferenceToTemplateAction(): Promise<{ templateId: string }> {
  const clubId = await getDefaultClubIdForAdmin()
  const admin = createAdminClient()

  const { data: club } = await admin
    .from('clubs')
    .select('default_ai_poster_reference_url')
    .eq('id', clubId)
    .maybeSingle()
  const referenceUrl = club?.default_ai_poster_reference_url
  if (!referenceUrl) throw new Error('Klubben har ingen referanseplakat å konvertere.')

  const response = await fetch(referenceUrl, { cache: 'no-store' })
  if (!response.ok) throw new Error('Kunne ikke hente referanseplakaten.')
  const originalBuffer = Buffer.from(await response.arrayBuffer())

  const templateId = crypto.randomUUID()
  const draft = await buildDraftTemplate(originalBuffer)

  const plate = draft.plateBuffer
    ? await uploadTemplateAsset(`${clubId}/${templateId}/plate.png`, draft.plateBuffer, 'image/png')
    : null

  const logos: PosterLogo[] = []
  for (let i = 0; i < draft.logoCrops.length; i += 1) {
    const crop = draft.logoCrops[i]
    const asset = await uploadTemplateAsset(`${clubId}/${templateId}/logo-${i}.png`, crop.buffer, 'image/png')
    logos.push({ box: crop.box, assetPath: asset.path, assetUrl: asset.url, fit: 'contain', align: 'center' })
  }

  const { error } = await admin.from('poster_templates').insert({
    id: templateId,
    club_id: clubId,
    name: 'Mal fra referanseplakat',
    status: 'draft',
    source_poster_url: referenceUrl,
    plate_path: plate?.path ?? null,
    plate_url: plate?.url ?? null,
    canvas_width: draft.canvasWidth,
    canvas_height: draft.canvasHeight,
    palette: draft.palette,
    text_slots: draft.textSlots,
    photo_frames: draft.photoFrames,
    logos,
  })
  if (error) throw new Error(`Kunne ikke lage mal: ${error.message}`)

  revalidatePath('/admin-app/min-klubb')
  return { templateId }
}

/** Persist edits made in the template editor (name + layout). */
export async function savePosterTemplateAction(formData: FormData) {
  const templateId = formData.get('template_id') as string
  if (!templateId) throw new Error('Mangler mal-id.')
  await assertTemplateAccess(templateId)

  const name = (formData.get('name') as string)?.trim() || 'Plakatmal'
  const schema = parseSchemaField(formData.get('schema'))

  const admin = createAdminClient()
  const { error } = await admin
    .from('poster_templates')
    .update({
      name,
      canvas_width: schema.canvasWidth,
      canvas_height: schema.canvasHeight,
      palette: schema.palette,
      text_slots: schema.textSlots,
      photo_frames: schema.photoFrames,
      logos: schema.logos,
      updated_at: new Date().toISOString(),
    })
    .eq('id', templateId)
  if (error) throw new Error(`Kunne ikke lagre endringene: ${error.message}`)

  revalidatePath(`/admin-app/min-klubb/maler/${templateId}`)
  revalidatePath('/admin-app/min-klubb')
}

/** Mark a template confirmed and (optionally) make it the club default. */
export async function confirmPosterTemplateAction(formData: FormData) {
  const templateId = formData.get('template_id') as string
  if (!templateId) throw new Error('Mangler mal-id.')
  const row = await assertTemplateAccess(templateId)
  const setDefault = formData.get('set_default') === 'true'

  const admin = createAdminClient()
  const { error } = await admin
    .from('poster_templates')
    .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', templateId)
  if (error) throw new Error(`Kunne ikke bekrefte malen: ${error.message}`)

  if (setDefault) {
    await admin.from('clubs').update({ default_poster_template_id: templateId }).eq('id', row.club_id)
  }

  revalidatePath('/admin-app/min-klubb')
  revalidatePath(`/admin-app/min-klubb/maler/${templateId}`)
}

export async function setClubDefaultTemplateAction(formData: FormData) {
  const templateId = formData.get('template_id') as string
  if (!templateId) throw new Error('Mangler mal-id.')
  const row = await assertTemplateAccess(templateId)
  const admin = createAdminClient()
  await admin.from('clubs').update({ default_poster_template_id: templateId }).eq('id', row.club_id)
  revalidatePath('/admin-app/min-klubb')
}

export async function deletePosterTemplateAction(formData: FormData) {
  const templateId = formData.get('template_id') as string
  if (!templateId) throw new Error('Mangler mal-id.')
  const row = await assertTemplateAccess(templateId)
  const admin = createAdminClient()

  // Detach references so the FK on-delete set null is explicit and revalidated.
  await admin.from('clubs').update({ default_poster_template_id: null }).eq('default_poster_template_id', templateId)
  await admin.from('shows').update({ selected_poster_template_id: null }).eq('selected_poster_template_id', templateId)

  const { error } = await admin.from('poster_templates').delete().eq('id', templateId).eq('club_id', row.club_id)
  if (error) throw new Error(`Kunne ikke slette malen: ${error.message}`)

  await admin.storage.from(TEMPLATE_BUCKET).remove([`${row.club_id}/${templateId}`]).catch(() => {})
  revalidatePath('/admin-app/min-klubb')
}

/**
 * Render a live deterministic preview of a (possibly edited) schema with
 * placeholder show data. Returns a data URL the editor can show inline.
 */
export async function renderTemplatePreviewAction(formData: FormData): Promise<{ dataUrl: string }> {
  const templateId = formData.get('template_id') as string
  if (templateId) await assertTemplateAccess(templateId)
  const schema = parseSchemaField(formData.get('schema'))

  const buffer = await renderPosterFromTemplate({
    schema,
    title: 'Lørdagskveld på Latter',
    dateText: 'lørdag 27. juni',
    timeText: 'kl. 20:00',
    venue: 'Latter, Aker Brygge — Oslo',
    headliners: [{ name: 'Åsleik Engmark', profileImageUrl: null, roleName: 'Headliner' }],
    supporting: [
      { name: 'Øystein Bråthen', profileImageUrl: null, roleName: null },
      { name: 'Mette Sørås', profileImageUrl: null, roleName: null },
    ],
  })

  return { dataUrl: `data:image/png;base64,${buffer.toString('base64')}` }
}

function parseSchemaField(raw: FormDataEntryValue | null): PosterTemplateSchema {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Mangler layout-data.')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Ugyldig layout-data.')
  }
  return normalizeSchema(parsed as Record<string, unknown>)
}

/** Re-export for callers that load a row and need a render-ready schema. */
export async function schemaFromTemplateId(templateId: string): Promise<PosterTemplateSchema> {
  const row = await assertTemplateAccess(templateId)
  return templateRowToSchema(row)
}
