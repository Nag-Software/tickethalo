import type { MarketingDesignKind, ShowMarketingDesign } from '@/types/database'
import { createAdminClient } from '@/lib/supabase/admin'

export type PosterMode = 'ai_generated' | 'framed'

export type PosterDesignTemplate = {
  label: string | null
  fileUrl: string
  filePath: string
  fileName: string
  mimeType: string
  source: 'show_design' | 'club_default'
}

export type PosterContextInput = {
  poster_mode?: PosterMode | null
  selected_ai_reference_id?: string | null
  selected_frame_background_id?: string | null
  selected_marketing_design_id?: string | null
  club_id?: string | null
}

export type ClubPosterDefaults = {
  default_ai_poster_reference_url?: string | null
  default_frame_background_url?: string | null
}

export type ResolvedPosterContext = {
  mode: PosterMode
  aiReference: PosterDesignTemplate | null
  frameBackground: PosterDesignTemplate | null
  aiReferenceSource: 'show' | 'club' | null
  frameBackgroundSource: 'show' | 'club' | null
}

export function designRowToTemplate(
  design: Pick<ShowMarketingDesign, 'label' | 'file_url' | 'file_path' | 'file_name' | 'mime_type'>,
): PosterDesignTemplate {
  return {
    label: design.label,
    fileUrl: design.file_url,
    filePath: design.file_path,
    fileName: design.file_name,
    mimeType: design.mime_type,
    source: 'show_design',
  }
}

function templateFromClubUrl(url: string, label: string): PosterDesignTemplate {
  const fileName = decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? 'club-default.png')

  return {
    label,
    fileUrl: url,
    filePath: url,
    fileName,
    mimeType: 'image/png',
    source: 'club_default',
  }
}

function findDesignById(designs: ShowMarketingDesign[], id: string | null | undefined) {
  if (!id) return null
  return designs.find((design) => design.id === id) ?? null
}

function findSelectedDesign(
  designs: ShowMarketingDesign[],
  selectedId: string | null | undefined,
  kind: MarketingDesignKind,
) {
  const selected = findDesignById(designs, selectedId)
  if (selected?.design_kind === kind) return selected

  return designs.find((design) => design.design_kind === kind) ?? null
}

export function resolvePosterContext(input: {
  show: PosterContextInput
  club?: ClubPosterDefaults | null
  designs?: ShowMarketingDesign[]
}): ResolvedPosterContext {
  const mode: PosterMode = input.show.poster_mode ?? 'ai_generated'
  const designs = input.designs ?? []
  const club = input.club ?? null

  const showAiDesign =
    findDesignById(designs, input.show.selected_ai_reference_id)
    ?? findDesignById(designs, input.show.selected_marketing_design_id && mode === 'ai_generated' ? input.show.selected_marketing_design_id : null)
    ?? findSelectedDesign(designs, input.show.selected_ai_reference_id, 'ai_reference')

  const showFrameDesign =
    findDesignById(designs, input.show.selected_frame_background_id)
    ?? findDesignById(designs, input.show.selected_marketing_design_id && mode === 'framed' ? input.show.selected_marketing_design_id : null)
    ?? findSelectedDesign(designs, input.show.selected_frame_background_id, 'frame_background')

  const aiReference = showAiDesign
    ? designRowToTemplate(showAiDesign)
    : club?.default_ai_poster_reference_url
      ? templateFromClubUrl(club.default_ai_poster_reference_url, 'Klubb-referanseplakat')
      : null

  const frameBackground = showFrameDesign
    ? designRowToTemplate(showFrameDesign)
    : club?.default_frame_background_url
      ? templateFromClubUrl(club.default_frame_background_url, 'Klubb-bakgrunn')
      : null

  return {
    mode,
    aiReference,
    frameBackground,
    aiReferenceSource: showAiDesign ? 'show' : aiReference ? 'club' : null,
    frameBackgroundSource: showFrameDesign ? 'show' : frameBackground ? 'club' : null,
  }
}

export async function loadResolvedPosterContext(showId: string) {
  const db = createAdminClient()

  const { data: show, error: showError } = await db
    .from('shows')
    .select('poster_mode, club_id, selected_ai_reference_id, selected_frame_background_id, selected_marketing_design_id')
    .eq('id', showId)
    .single()

  if (showError || !show) {
    throw new Error('Show not found')
  }

  const [{ data: designs }, { data: club }] = await Promise.all([
    db.from('show_marketing_designs').select('*').eq('show_id', showId).order('created_at', { ascending: false }),
    show.club_id
      ? db
        .from('clubs')
        .select('default_ai_poster_reference_url, default_frame_background_url')
        .eq('id', show.club_id)
        .single()
      : Promise.resolve({ data: null }),
  ])

  return resolvePosterContext({
    show,
    club,
    designs: designs ?? [],
  })
}
