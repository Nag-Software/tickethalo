'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertShowAccess } from '@/lib/club-auth'
import { generateShowPoster } from '@/lib/actions/ai'
import { buildMarketingSlots } from '@/lib/marketing/slots'
import { normalizeHex, paletteFromSeed, resolvePalette } from '@/lib/marketing/palette'
import { suggestPalette } from '@/lib/marketing/palette-extract'
import { exportSpec, isMarketingExportFormat, MARKETING_EXPORT_SPECS } from '@/lib/marketing/export-formats'
import { renderMarketingExport } from '@/lib/marketing/exports'
import {
  assertUploadableImage,
  MARKETING_DESIGN_BUCKET,
  MARKETING_EXPORT_BUCKET,
  marketingDesignFileType,
  marketingDesignMimeType,
  sanitizeStorageFileName,
} from '@/lib/marketing/storage'
import { readImageSize } from '@/lib/marketing/image-meta'
import type {
  MarketingDesignKind,
  MarketingExportFormat,
  MarketingPalette,
  ShowMarketingDesign,
} from '@/types/database'

/**
 * Server actions for markedsføringsfanen.
 *
 * Fanen gjør fire ting: velger farger, velger mal, kobler bilder til ruter og
 * lager ferdige filer. Alle fire skriver til showet, og alle fire skal kunne
 * kjøres uavhengig av hverandre — AI-plakaten er bare én av kildene, ikke
 * forutsetningen for resten.
 */

function requireText(value: FormDataEntryValue | null, message: string) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error(message)
  return text
}

function optionalText(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function revalidateShow(showId: string) {
  revalidatePath(`/admin-app/shows/${showId}`)
}

async function loadShowForMarketing(showId: string) {
  const db = createAdminClient()
  const { data: show, error } = await db
    .from('shows')
    .select('id, club_id, title, slug, date, start_time, venue_name, venue_address, description, ticket_price, currency, ticket_url, poster_url, poster_source, marketing_palette, selected_marketing_design_id')
    .eq('id', showId)
    .single()

  if (error || !show) throw new Error('Show not found.')
  return show
}

// ═══════════════════════════════════════════════════════════════
// Merkevarefarger
// ═══════════════════════════════════════════════════════════════

export async function saveMarketingPaletteAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const fallback = paletteFromSeed(null)
  const palette: MarketingPalette = {
    primary: normalizeHex(String(formData.get('primary') ?? ''), fallback.primary),
    secondary: normalizeHex(String(formData.get('secondary') ?? ''), fallback.secondary),
    accent: normalizeHex(String(formData.get('accent') ?? ''), fallback.accent),
  }

  const db = createAdminClient()
  const { error } = await db.from('shows').update({ marketing_palette: palette }).eq('id', showId)
  if (error) throw new Error(error.message)

  revalidateShow(showId)
  return { palette }
}

/**
 * Foreslår farger uten å lagre dem.
 *
 * Forslaget hentes fra designet klubben allerede har — malen, plakaten eller
 * logoen. Klubben ser fargene i velgerne og bestemmer selv om de skal lagres,
 * så knappen aldri overskriver et valg noen har tatt bevisst.
 */
export async function suggestMarketingPaletteAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const db = createAdminClient()
  const show = await loadShowForMarketing(showId)

  const [{ data: design }, { data: club }] = await Promise.all([
    show.selected_marketing_design_id
      ? db.from('show_marketing_designs').select('file_url').eq('id', show.selected_marketing_design_id).maybeSingle()
      : Promise.resolve({ data: null }),
    show.club_id
      ? db.from('clubs').select('logo_url, brand_color').eq('id', show.club_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const { palette, source } = await suggestPalette({
    templateUrl: design?.file_url ?? null,
    posterUrl: show.poster_url,
    clubLogoUrl: club?.logo_url ?? null,
    clubBrandColor: club?.brand_color ?? null,
  })

  return { palette, source }
}

// ═══════════════════════════════════════════════════════════════
// Maler og opplastede plakater
// ═══════════════════════════════════════════════════════════════

type UploadedDesign = Pick<ShowMarketingDesign, 'id' | 'file_url' | 'file_path'>

async function storeDesignFile(input: {
  file: File
  showId: string | null
  clubId: string | null
  kind: MarketingDesignKind
  label: string | null
  slotCount: number
}): Promise<UploadedDesign> {
  assertUploadableImage(input.file)

  const db = createAdminClient()
  const folder = input.showId ?? `club-${input.clubId}`
  const safeName = sanitizeStorageFileName(input.file.name)
  const filePath = `${folder}/${crypto.randomUUID()}-${safeName}`
  const mimeType = marketingDesignMimeType(input.file)
  const { width, height } = await readImageSize(input.file)

  const { error: uploadError } = await db.storage
    .from(MARKETING_DESIGN_BUCKET)
    .upload(filePath, input.file, { contentType: mimeType, upsert: false })

  if (uploadError) throw new Error('The file could not be uploaded right now.')

  const { data: urlData } = db.storage.from(MARKETING_DESIGN_BUCKET).getPublicUrl(filePath)
  const { data: design, error: insertError } = await db
    .from('show_marketing_designs')
    .insert({
      show_id: input.showId,
      club_id: input.clubId,
      kind: input.kind,
      slot_count: input.slotCount,
      width,
      height,
      label: input.label,
      file_url: urlData.publicUrl,
      file_path: filePath,
      file_name: input.file.name,
      mime_type: mimeType,
      file_type: marketingDesignFileType(input.file) ?? 'image',
      file_size: input.file.size,
    })
    .select('id, file_url, file_path')
    .single()

  if (insertError) {
    await db.storage.from(MARKETING_DESIGN_BUCKET).remove([filePath])
    throw new Error(insertError.message)
  }

  return design
}

/**
 * Laster opp en mal.
 *
 * `scope: 'club'` legger malen i klubbens bibliotek, der alle show kan bruke
 * den. Det er det biblioteket «Bla i maler» viser — uten det måtte den samme
 * malen lastes opp på nytt for hvert eneste show.
 */
export async function uploadMarketingTemplateAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const show = await loadShowForMarketing(showId)
  const scope = String(formData.get('scope') ?? 'club')
  const slotCount = Math.max(0, Math.min(24, Number(formData.get('slot_count') ?? 0) || 0))

  const design = await storeDesignFile({
    file: formData.get('design_file') as File,
    showId: scope === 'club' && show.club_id ? null : showId,
    clubId: show.club_id,
    kind: 'template',
    label: optionalText(formData.get('label')),
    slotCount,
  })

  // Første mal på et show uten valg blir valgt med én gang — ellers må klubben
  // gjøre to handlinger for å komme dit den åpenbart skulle.
  if (!show.selected_marketing_design_id) {
    const db = createAdminClient()
    await db.from('shows').update({ selected_marketing_design_id: design.id }).eq('id', showId)
  }

  revalidateShow(showId)
  return { designId: design.id }
}

export async function selectMarketingDesignAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const designId = optionalText(formData.get('design_id'))
  const db = createAdminClient()
  const show = await loadShowForMarketing(showId)

  if (designId) {
    const { data: design } = await db
      .from('show_marketing_designs')
      .select('id, show_id, club_id')
      .eq('id', designId)
      .maybeSingle()

    const belongsHere = design
      && (design.show_id === showId || (design.club_id != null && design.club_id === show.club_id))

    if (!belongsHere) throw new Error('That template does not belong to this show or club.')
  }

  const { error } = await db.from('shows').update({ selected_marketing_design_id: designId }).eq('id', showId)
  if (error) throw new Error(error.message)

  revalidateShow(showId)
}

export async function deleteMarketingDesignAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  const designId = requireText(formData.get('design_id'), 'Template is missing.')
  await assertShowAccess(showId)

  const db = createAdminClient()
  const show = await loadShowForMarketing(showId)
  const { data: design } = await db
    .from('show_marketing_designs')
    .select('id, file_path, show_id, club_id')
    .eq('id', designId)
    .maybeSingle()

  const belongsHere = design
    && (design.show_id === showId || (design.club_id != null && design.club_id === show.club_id))

  if (!design || !belongsHere) throw new Error('That template does not belong to this show or club.')

  // Malen kan være valgt på flere show i klubben. Slippes den ett sted, må den
  // slippes overalt, ellers står showet igjen med en peker til ingenting.
  await db.from('shows').update({ selected_marketing_design_id: null }).eq('selected_marketing_design_id', designId)

  const { error } = await db.from('show_marketing_designs').delete().eq('id', designId)
  if (error) throw new Error(error.message)

  await db.storage.from(MARKETING_DESIGN_BUCKET).remove([design.file_path])
  revalidateShow(showId)
}

// ═══════════════════════════════════════════════════════════════
// Plakaten: egen fil eller AI
// ═══════════════════════════════════════════════════════════════

/** Klubbens egen ferdige plakat. Den blir showets plakat med én gang. */
export async function uploadShowPosterAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const show = await loadShowForMarketing(showId)
  const design = await storeDesignFile({
    file: formData.get('poster_file') as File,
    showId,
    clubId: show.club_id,
    kind: 'poster',
    label: optionalText(formData.get('label')),
    slotCount: 0,
  })

  const db = createAdminClient()
  const { error } = await db
    .from('shows')
    .update({ poster_url: design.file_url, poster_source: 'upload' })
    .eq('id', showId)

  if (error) throw new Error(error.message)

  await db.from('marketing_tasks').upsert({
    show_id: showId,
    task_key: 'upload_poster',
    label: 'Poster ready',
    is_completed: true,
  }, { onConflict: 'show_id,task_key', ignoreDuplicates: false })

  revalidateShow(showId)
  return { posterUrl: design.file_url }
}

/** Tar en fil som allerede ligger i biblioteket i bruk som showets plakat. */
export async function useDesignAsPosterAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  const designId = requireText(formData.get('design_id'), 'File is missing.')
  await assertShowAccess(showId)

  const db = createAdminClient()
  const show = await loadShowForMarketing(showId)
  const { data: design } = await db
    .from('show_marketing_designs')
    .select('id, file_url, show_id, club_id')
    .eq('id', designId)
    .maybeSingle()

  const belongsHere = design
    && (design.show_id === showId || (design.club_id != null && design.club_id === show.club_id))

  if (!design || !belongsHere) throw new Error('That file does not belong to this show or club.')

  const { error } = await db
    .from('shows')
    .update({ poster_url: design.file_url, poster_source: 'upload' })
    .eq('id', showId)

  if (error) throw new Error(error.message)

  revalidateShow(showId)
  return { posterUrl: design.file_url }
}

/**
 * Fjerner plakaten fra showet.
 *
 * Filen blir liggende i biblioteket. Å slette plakaten fra event-siden og å
 * kaste filen er to ulike beslutninger, og bare den første tas her.
 */
export async function clearShowPosterAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const db = createAdminClient()
  const { error } = await db
    .from('shows')
    .update({ poster_url: null, poster_source: null })
    .eq('id', showId)

  if (error) throw new Error(error.message)

  await db.from('marketing_tasks')
    .update({ is_completed: false })
    .eq('show_id', showId)
    .eq('task_key', 'upload_poster')

  revalidateShow(showId)
}

/** AI-plakaten på publisering. Av som standard — klubben skrur den på selv. */
export async function setAutoPosterAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const enabled = formData.get('enabled') === 'true'
  const db = createAdminClient()
  const { error } = await db.from('shows').update({ auto_poster_enabled: enabled }).eq('id', showId)
  if (error) throw new Error(error.message)

  revalidateShow(showId)
  return { enabled }
}

/**
 * Genererer AI-plakaten på forespørsel.
 *
 * Til forskjell fra før tar den med seg klubbens farger og ruteoppsettet, slik
 * at «headliner»-ruten faktisk får headlinerens bilde og plakaten kommer ut i
 * riktig farge første gang.
 */
export async function generatePosterAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const db = createAdminClient()
  const show = await loadShowForMarketing(showId)

  const [{ data: requirements }, { data: spots }, { data: storedSlots }, { data: club }] = await Promise.all([
    db.from('show_requirements').select('id, role_name, quantity, lineup_position').eq('show_id', showId),
    db.from('confirmed_spots').select('artist_id, show_requirement_id, status').eq('show_id', showId),
    db.from('show_marketing_slots').select('slot_index, artist_id, image_url').eq('show_id', showId),
    show.club_id
      ? db.from('clubs').select('brand_color').eq('id', show.club_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const artistIds = [...new Set((spots ?? []).map((spot) => spot.artist_id))]
  const { data: artists } = artistIds.length
    ? await db.from('artists').select('id, full_name, stage_name, profile_image_url').in('id', artistIds)
    : { data: [] }

  const design = show.selected_marketing_design_id
    ? (await db
      .from('show_marketing_designs')
      .select('label, file_url, file_path, file_name, mime_type, slot_count')
      .eq('id', show.selected_marketing_design_id)
      .maybeSingle()).data
    : null

  const slots = buildMarketingSlots({
    requirements: requirements ?? [],
    spots: spots ?? [],
    artists: artists ?? [],
    stored: storedSlots ?? [],
    templateSlotCount: design?.slot_count ?? null,
  })

  const palette = resolvePalette(show.marketing_palette, club?.brand_color ?? null)

  const posterUrl = await generateShowPoster(showId, {
    title: show.title,
    date: show.date,
    startTime: show.start_time,
    venue: show.venue_address ?? show.venue_name ?? '',
    artists: slots.flatMap((slot) => (
      slot.artistId && slot.artistName
        ? [{ name: slot.artistName, profile_image_url: slot.imageUrl, role_name: slot.roleLabel }]
        : []
    )),
    designTemplate: design
      ? {
        label: design.label,
        fileUrl: design.file_url,
        filePath: design.file_path,
        fileName: design.file_name,
        mimeType: design.mime_type,
      }
      : null,
    palette,
    throwOnError: true,
  })

  if (!posterUrl) throw new Error('Could not generate the poster right now.')

  await db.from('shows').update({ poster_source: 'ai' }).eq('id', showId)
  await db.from('marketing_tasks').upsert({
    show_id: showId,
    task_key: 'upload_poster',
    label: 'Poster ready',
    is_completed: true,
  }, { onConflict: 'show_id,task_key', ignoreDuplicates: false })

  revalidateShow(showId)
  revalidatePath('/admin-app/marketing')
  return { posterUrl }
}

// ═══════════════════════════════════════════════════════════════
// Bilderutene
// ═══════════════════════════════════════════════════════════════

export async function setMarketingSlotArtistAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const slotIndex = Number(formData.get('slot_index'))
  if (!Number.isInteger(slotIndex) || slotIndex < 1) throw new Error('Slot is missing.')

  const artistId = optionalText(formData.get('artist_id'))
  const db = createAdminClient()

  if (artistId) {
    const { data: artist } = await db.from('artists').select('id').eq('id', artistId).maybeSingle()
    if (!artist) throw new Error('That artist does not exist.')
  }

  const { error } = await db.from('show_marketing_slots').upsert({
    show_id: showId,
    slot_index: slotIndex,
    artist_id: artistId,
    role_label: optionalText(formData.get('role_label')),
  }, { onConflict: 'show_id,slot_index' })

  if (error) throw new Error(error.message)
  revalidateShow(showId)
}

/** Et eget bilde til én rute, når profilbildet ikke duger på plakaten. */
export async function uploadMarketingSlotImageAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const slotIndex = Number(formData.get('slot_index'))
  if (!Number.isInteger(slotIndex) || slotIndex < 1) throw new Error('Slot is missing.')

  const file = formData.get('slot_image')
  assertUploadableImage(file)

  const db = createAdminClient()
  const safeName = sanitizeStorageFileName(file.name)
  const filePath = `${showId}/slots/${slotIndex}-${crypto.randomUUID()}-${safeName}`

  const { error: uploadError } = await db.storage
    .from(MARKETING_DESIGN_BUCKET)
    .upload(filePath, file, { contentType: marketingDesignMimeType(file), upsert: false })

  if (uploadError) throw new Error('The image could not be uploaded right now.')

  const { data: urlData } = db.storage.from(MARKETING_DESIGN_BUCKET).getPublicUrl(filePath)
  const { data: existing } = await db
    .from('show_marketing_slots')
    .select('artist_id, image_path')
    .eq('show_id', showId)
    .eq('slot_index', slotIndex)
    .maybeSingle()

  // Uten `artist_id` i upserten ville et bilde på en automatisk matchet rute
  // ha nullet artisten: raden finnes ikke fra før, og `null` er et bevisst valg.
  const artistId = existing?.artist_id ?? optionalText(formData.get('artist_id'))

  const { error } = await db.from('show_marketing_slots').upsert({
    show_id: showId,
    slot_index: slotIndex,
    artist_id: artistId,
    image_url: urlData.publicUrl,
    image_path: filePath,
    role_label: optionalText(formData.get('role_label')),
  }, { onConflict: 'show_id,slot_index' })

  if (error) {
    await db.storage.from(MARKETING_DESIGN_BUCKET).remove([filePath])
    throw new Error(error.message)
  }

  if (existing?.image_path) {
    await db.storage.from(MARKETING_DESIGN_BUCKET).remove([existing.image_path])
  }

  revalidateShow(showId)
  return { imageUrl: urlData.publicUrl }
}

/** Tilbake til artistens profilbilde. */
export async function clearMarketingSlotImageAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const slotIndex = Number(formData.get('slot_index'))
  if (!Number.isInteger(slotIndex) || slotIndex < 1) throw new Error('Slot is missing.')

  const db = createAdminClient()
  const { data: existing } = await db
    .from('show_marketing_slots')
    .select('image_path')
    .eq('show_id', showId)
    .eq('slot_index', slotIndex)
    .maybeSingle()

  const { error } = await db
    .from('show_marketing_slots')
    .update({ image_url: null, image_path: null })
    .eq('show_id', showId)
    .eq('slot_index', slotIndex)

  if (error) throw new Error(error.message)

  if (existing?.image_path) {
    await db.storage.from(MARKETING_DESIGN_BUCKET).remove([existing.image_path])
  }

  revalidateShow(showId)
}

/** Kaster alle manuelle valg og lar matchingen mot bookingene gjelde igjen. */
export async function resetMarketingSlotsAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const db = createAdminClient()
  const { data: stored } = await db
    .from('show_marketing_slots')
    .select('image_path')
    .eq('show_id', showId)

  const paths = (stored ?? []).map((slot) => slot.image_path).filter((path): path is string => Boolean(path))

  const { error } = await db.from('show_marketing_slots').delete().eq('show_id', showId)
  if (error) throw new Error(error.message)

  if (paths.length > 0) {
    await db.storage.from(MARKETING_DESIGN_BUCKET).remove(paths)
  }

  revalidateShow(showId)
}

// ═══════════════════════════════════════════════════════════════
// Eksport
// ═══════════════════════════════════════════════════════════════

async function renderAndStoreExport(showId: string, format: MarketingExportFormat) {
  const spec = exportSpec(format)
  if (!spec) throw new Error('Unknown export format.')

  const db = createAdminClient()
  const show = await loadShowForMarketing(showId)
  if (!show.poster_url) throw new Error('There is no poster to export yet.')

  const { data: club } = show.club_id
    ? await db.from('clubs').select('brand_color').eq('id', show.club_id).maybeSingle()
    : { data: null }

  const response = await fetch(show.poster_url, { cache: 'no-store' })
  if (!response.ok) throw new Error('The poster file could not be fetched.')

  const palette = resolvePalette(show.marketing_palette, club?.brand_color ?? null)
  const { buffer, contentType, extension } = await renderMarketingExport(
    Buffer.from(await response.arrayBuffer()),
    spec,
    palette,
  )

  const slug = show.slug || showId
  const filePath = `${showId}/${format}-${slug}.${extension}`
  const { error: uploadError } = await db.storage
    .from(MARKETING_EXPORT_BUCKET)
    .upload(filePath, buffer, { contentType, upsert: true })

  if (uploadError) throw new Error(`Could not save the export: ${uploadError.message}`)

  const { data: urlData } = db.storage.from(MARKETING_EXPORT_BUCKET).getPublicUrl(filePath)
  // Bust nettleserens cache — filnavnet er stabilt, så innholdet ville ellers
  // vært det gamle når klubben eksporterer på nytt.
  const fileUrl = `${urlData.publicUrl}?v=${Date.now()}`

  const { error } = await db.from('show_marketing_exports').upsert({
    show_id: showId,
    format,
    file_url: fileUrl,
    file_path: filePath,
    width: spec.width,
    height: spec.height,
    source_poster_url: show.poster_url,
  }, { onConflict: 'show_id,format' })

  if (error) throw new Error(error.message)

  // Facebook-coveret er halve «opprett Facebook-event»-oppgaven. Er filen laget,
  // er det ingen grunn til at klubben skal huke av for det for hånd.
  if (format === 'facebook_event') {
    await db.from('marketing_tasks').upsert({
      show_id: showId,
      task_key: 'create_facebook_event',
      label: 'Create Facebook event',
      is_completed: true,
    }, { onConflict: 'show_id,task_key', ignoreDuplicates: false })
  }

  return { format, fileUrl, width: spec.width, height: spec.height }
}

export async function generateMarketingExportAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const format = formData.get('format')
  if (!isMarketingExportFormat(format)) throw new Error('Unknown export format.')

  const result = await renderAndStoreExport(showId, format)
  revalidateShow(showId)
  return result
}

/** Alle formatene i én runde — det vanlige når plakaten nettopp ble klar. */
export async function generateAllMarketingExportsAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  await assertShowAccess(showId)

  const results: Array<{ format: MarketingExportFormat; ok: boolean; message?: string }> = []
  for (const spec of MARKETING_EXPORT_SPECS) {
    try {
      await renderAndStoreExport(showId, spec.format)
      results.push({ format: spec.format, ok: true })
    } catch (error) {
      results.push({
        format: spec.format,
        ok: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  revalidateShow(showId)
  return { results, generated: results.filter((result) => result.ok).length }
}

export async function toggleMarketingTaskAction(formData: FormData) {
  const showId = requireText(formData.get('show_id'), 'Show is missing.')
  const taskId = requireText(formData.get('task_id'), 'Task is missing.')
  await assertShowAccess(showId)

  const db = createAdminClient()
  const { error } = await db
    .from('marketing_tasks')
    .update({ is_completed: formData.get('is_completed') !== 'true' })
    .eq('id', taskId)
    .eq('show_id', showId)

  if (error) throw new Error(error.message)
  revalidateShow(showId)
}
