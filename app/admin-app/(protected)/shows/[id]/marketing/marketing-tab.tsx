import { createAdminClient } from '@/lib/supabase/admin'
import { buildMarketingSlots } from '@/lib/marketing/slots'
import { resolvePalette } from '@/lib/marketing/palette'
import { ChecklistCard } from './checklist-card'
import { PosterArchive, type ArchivedPoster } from './poster-archive'
import { PosterStage } from './poster-stage'
import {
  clearShowPosterAction,
  deleteMarketingDesignAction,
  toggleMarketingTaskAction,
  uploadShowPosterAction,
  useDesignAsPosterAction,
} from './actions'

/**
 * Markedsføringsfanen på et show.
 *
 * Klubben laster opp sin egen plakat, ser de forrige og krysser av
 * sjekklisten. Det er alt fanen gjør nå.
 *
 * AI-plakaten er parkert, ikke slettet: AutoPosterToggle, BrandColorsCard,
 * TemplatePicker, SlotMatcher, ExportPanel og genereringsknappene i
 * PosterStage rendres ikke lenger, men komponentene, actions og
 * `lib/poster/*` / `lib/marketing/*` ligger der til den skal tilbake.
 */

export async function MarketingTab({ showId }: { showId: string }) {
  const db = createAdminClient()

  const { data: show } = await db
    .from('shows')
    .select('id, club_id, title, slug, date, start_time, venue_name, venue_address, description, ticket_price, currency, ticket_url, poster_url, poster_source, marketing_palette, selected_marketing_design_id, status')
    .eq('id', showId)
    .single()

  if (!show) return null

  const [
    { data: club },
    { data: requirements },
    { data: spots },
    { data: storedSlots },
    { data: tasks },
  ] = await Promise.all([
    show.club_id
      ? db.from('clubs').select('brand_color').eq('id', show.club_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('show_requirements').select('id, role_name, quantity, lineup_position').eq('show_id', showId),
    db.from('confirmed_spots').select('artist_id, show_requirement_id, status').eq('show_id', showId),
    db.from('show_marketing_slots').select('slot_index, artist_id, image_url').eq('show_id', showId).order('slot_index'),
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

  const selectedTemplate = (designs ?? [])
    .find((design) => design.kind === 'template' && design.id === show.selected_marketing_design_id) ?? null

  const slots = buildMarketingSlots({
    requirements: requirements ?? [],
    spots: spots ?? [],
    artists: artists ?? [],
    stored: storedSlots ?? [],
    templateSlotCount: selectedTemplate?.slot_count ?? null,
  })

  const palette = resolvePalette(show.marketing_palette, club?.brand_color ?? null)

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

  return (
    <div className="space-y-6">
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <PosterStage
            showId={show.id}
            showTitle={show.title}
            posterUrl={show.poster_url}
            posterSource={show.poster_source}
            palette={palette}
            uploadAction={uploadShowPosterAction}
            clearAction={clearShowPosterAction}
            hasTemplate={Boolean(selectedTemplate)}
          />

          <PosterArchive
            showId={show.id}
            posters={archive}
            restoreAction={useDesignAsPosterAction}
            deleteAction={deleteMarketingDesignAction}
          />
        </div>

        <div className="space-y-6">
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
