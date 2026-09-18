import { createAdminClient } from '@/lib/supabase/admin'
import { buildMarketingSlots, artistDisplayName } from '@/lib/marketing/slots'
import { resolvePalette } from '@/lib/marketing/palette'
import { AutoPosterToggle } from './automation-bar'
import { BrandColorsCard } from './brand-colors-card'
import { ChecklistCard } from './checklist-card'
import { ExportPanel, type ExportState } from './export-panel'
import { PosterArchive, type ArchivedPoster } from './poster-archive'
import { PosterStage } from './poster-stage'
import { SlotMatcher, type SlotArtistOption } from './slot-matcher'
import { TemplatePicker, type TemplateOption } from './template-picker'
import {
  clearMarketingSlotImageAction,
  clearShowPosterAction,
  deleteMarketingDesignAction,
  generateAllMarketingExportsAction,
  generateMarketingExportAction,
  generatePosterAction,
  resetMarketingSlotsAction,
  saveMarketingPaletteAction,
  selectMarketingDesignAction,
  setAutoPosterAction,
  setMarketingSlotArtistAction,
  suggestMarketingPaletteAction,
  toggleMarketingTaskAction,
  uploadMarketingSlotImageAction,
  uploadMarketingTemplateAction,
  uploadShowPosterAction,
  useDesignAsPosterAction,
} from './actions'
import type { MarketingExportFormat, ShowStatus } from '@/types/database'

/**
 * Markedsføringsfanen på et show.
 *
 * Venstre spalte er resultatet — plakaten og filene som skal ut i kanalene.
 * Høyre spalte er verktøyene som lager det: farger, mal og hvem som står i
 * hvilken rute. Rekkefølgen er den samme som arbeidsflyten: velg uttrykk, velg
 * design, koble bilder, eksporter.
 *
 * AI-plakaten er ett av alternativene her, ikke selve fanen. Klubben kan gjøre
 * hele jobben med sin egen plakat uten å ta den i bruk.
 */

const GENERATE_BLOCKED_HINT: Partial<Record<ShowStatus, string>> = {
  draft: 'Book the lineup first — the AI poster needs the confirmed artists.',
}

export async function MarketingTab({ showId }: { showId: string }) {
  const db = createAdminClient()

  const { data: show } = await db
    .from('shows')
    .select('id, club_id, title, slug, date, start_time, venue_name, venue_address, description, ticket_price, currency, ticket_url, poster_url, poster_source, auto_poster_enabled, marketing_palette, selected_marketing_design_id, status')
    .eq('id', showId)
    .single()

  if (!show) return null

  const [
    { data: club },
    { data: requirements },
    { data: spots },
    { data: storedSlots },
    { data: exportRows },
    { data: tasks },
  ] = await Promise.all([
    show.club_id
      ? db.from('clubs').select('brand_color').eq('id', show.club_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('show_requirements').select('id, role_name, quantity, lineup_position').eq('show_id', showId),
    db.from('confirmed_spots').select('artist_id, show_requirement_id, status').eq('show_id', showId),
    db.from('show_marketing_slots').select('slot_index, artist_id, image_url').eq('show_id', showId).order('slot_index'),
    db.from('show_marketing_exports').select('format, file_url, source_poster_url').eq('show_id', showId),
    db.from('marketing_tasks').select('id, task_key, label, is_completed').eq('show_id', showId).order('created_at'),
  ])

  // Malene ligger i klubbens bibliotek. Filer lastet opp på dette showet
  // hentes i samme spørring, så begge deler vises i én liste.
  const designsQuery = db
    .from('show_marketing_designs')
    .select('id, show_id, club_id, kind, label, file_name, file_url, slot_count, source, lineup_snapshot, layout_status, poster_layout, created_at')
    .order('created_at', { ascending: false })

  // `.or()` tar en rå filterstreng, så begge id-ene sjekkes mot UUID-formen
  // først — de kommer fra ruten og fra basen, men strengen skal ikke kunne
  // bære med seg noe annet enn en id.
  const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  const { data: designs } = show.club_id && isUuid(showId) && isUuid(show.club_id)
    ? await designsQuery.or(`show_id.eq.${showId},club_id.eq.${show.club_id}`)
    : await designsQuery.eq('show_id', showId)

  const artistIds = [...new Set((spots ?? []).map((spot) => spot.artist_id))]
  const { data: artists } = artistIds.length
    ? await db.from('artists').select('id, full_name, stage_name, profile_image_url').in('id', artistIds)
    : { data: [] }

  const templates: TemplateOption[] = (designs ?? [])
    .filter((design) => design.kind === 'template')
    .map((design) => ({
      id: design.id,
      label: design.label || design.file_name,
      fileUrl: design.file_url,
      fileName: design.file_name,
      slotCount: design.slot_count,
      isShowScoped: design.show_id === showId,
      layoutStatus: design.layout_status,
      isFlexible: Boolean((design.poster_layout as { lineupArea?: unknown } | null)?.lineupArea),
    }))

  const selectedTemplate = templates.find((template) => template.id === show.selected_marketing_design_id) ?? null

  const slots = buildMarketingSlots({
    requirements: requirements ?? [],
    spots: spots ?? [],
    artists: artists ?? [],
    stored: storedSlots ?? [],
    templateSlotCount: selectedTemplate?.slotCount ?? null,
  })

  const palette = resolvePalette(show.marketing_palette, club?.brand_color ?? null)

  const requirementRole = new Map((requirements ?? []).map((requirement) => [requirement.id, requirement.role_name]))
  const artistOptions: SlotArtistOption[] = (artists ?? []).map((artist) => ({
    id: artist.id,
    name: artistDisplayName(artist),
    roleLabel: (spots ?? []).find((spot) => spot.artist_id === artist.id)
      ? requirementRole.get((spots ?? []).find((spot) => spot.artist_id === artist.id)!.show_requirement_id) ?? null
      : null,
    profileImageUrl: artist.profile_image_url,
  }))

  const exports: ExportState[] = (exportRows ?? []).map((row) => ({
    format: row.format as MarketingExportFormat,
    fileUrl: row.file_url,
    isStale: row.source_poster_url !== show.poster_url,
  }))

  // En plakat er utdatert når lineupen den ble laget for ikke lenger er
  // lineupen showet har. Opplastede plakater har ingen kjent lineup.
  const currentLineup = new Set(slots.map((slot) => slot.artistId).filter(Boolean))
  const archive: ArchivedPoster[] = (designs ?? [])
    .filter((design) => design.kind === 'poster' && design.show_id === showId)
    .map((design) => {
      const snapshot = (design.lineup_snapshot ?? []).map((entry) => entry.artist_id).filter(Boolean)
      const isOutdated = design.lineup_snapshot != null
        && (snapshot.length !== currentLineup.size || snapshot.some((id) => !currentLineup.has(id)))
      return {
        id: design.id,
        fileUrl: design.file_url,
        source: design.source,
        createdAt: design.created_at,
        isActive: design.file_url === show.poster_url,
        isOutdated,
      }
    })

  const bookedCount = slots.filter((slot) => slot.artistId).length
  const canGenerate = bookedCount > 0
  const generateHint = canGenerate ? null : GENERATE_BLOCKED_HINT[show.status] ?? 'No confirmed artists yet.'

  return (
    <div className="space-y-6">
      <AutoPosterToggle
        showId={show.id}
        enabled={show.auto_poster_enabled}
        hasPoster={Boolean(show.poster_url)}
        action={setAutoPosterAction}
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <PosterStage
            showId={show.id}
            showTitle={show.title}
            posterUrl={show.poster_url}
            posterSource={show.poster_source}
            palette={palette}
            canGenerate={canGenerate}
            generateHint={generateHint}
            uploadAction={uploadShowPosterAction}
            generateAction={generatePosterAction}
            clearAction={clearShowPosterAction}
            hasTemplate={Boolean(selectedTemplate)}
          />

          <PosterArchive
            showId={show.id}
            posters={archive}
            restoreAction={useDesignAsPosterAction}
            deleteAction={deleteMarketingDesignAction}
          />

          <ExportPanel
            showId={show.id}
            exports={exports}
            hasPoster={Boolean(show.poster_url)}
            generateAction={generateMarketingExportAction}
            generateAllAction={generateAllMarketingExportsAction}
          />
        </div>

        <div className="space-y-6">
          <BrandColorsCard
            showId={show.id}
            saved={palette}
            saveAction={saveMarketingPaletteAction}
            suggestAction={suggestMarketingPaletteAction}
          />

          <TemplatePicker
            showId={show.id}
            templates={templates}
            selectedId={show.selected_marketing_design_id}
            lineupSize={bookedCount}
            selectAction={selectMarketingDesignAction}
            uploadAction={uploadMarketingTemplateAction}
            deleteAction={deleteMarketingDesignAction}
          />

          <SlotMatcher
            showId={show.id}
            slots={slots}
            artistOptions={artistOptions}
            templateSlotCount={selectedTemplate?.slotCount || null}
            setArtistAction={setMarketingSlotArtistAction}
            uploadImageAction={uploadMarketingSlotImageAction}
            clearImageAction={clearMarketingSlotImageAction}
            resetAction={resetMarketingSlotsAction}
          />

          <ChecklistCard
            showId={show.id}
            tasks={(tasks ?? []).map((task) => ({
              id: task.id,
              label: task.label ?? task.task_key ?? 'Marketing task',
              isCompleted: task.is_completed,
            }))}
            action={toggleMarketingTaskAction}
          />
        </div>
      </div>
    </div>
  )
}
