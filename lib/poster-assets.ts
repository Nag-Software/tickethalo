import type { MarketingDesignKind, ShowMarketingDesign } from '@/types/database'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * @deprecated Poster generation is AI-only; the per-show mode picker is gone.
 * Kept temporarily so app-level code referencing the old modes still compiles.
 */
export type PosterMode = 'ai_generated' | 'framed' | 'template'

export type PosterDesignTemplate = {
  label: string | null
  fileUrl: string
  filePath: string
  fileName: string
  mimeType: string
  source: 'show_design' | 'club_default'
}

export type PosterContextInput = {
  poster_use_reference?: boolean | null
  selected_ai_reference_id?: string | null
  selected_marketing_design_id?: string | null
  club_id?: string | null
}

export type ClubPosterDefaults = {
  default_ai_poster_reference_url?: string | null
}

export type ResolvedPosterContext = {
  /** «Bruk referanseplakat» — the poster is AI-edited on top of the reference when true. */
  useReference: boolean
  aiReference: PosterDesignTemplate | null
  aiReferenceSource: 'show' | 'club' | null
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
  const rawName = url.split('/').pop()?.split('?')[0] ?? 'club-default.png'
  // A stored URL whose last segment contains a stray percent (e.g. "cover.pn%g") makes
  // decodeURIComponent throw a URIError. That must not abort poster generation — fall
  // back to the undecoded segment.
  let fileName = rawName
  try {
    fileName = decodeURIComponent(rawName)
  } catch {
    fileName = rawName
  }

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
  const designs = input.designs ?? []
  const club = input.club ?? null
  const useReference = input.show.poster_use_reference ?? true

  // Every candidate must actually BE an ai_reference — the legacy
  // selected_marketing_design_id can point at any design kind, and a
  // frame-background there must not silently become the poster reference.
  const byAiId = findDesignById(designs, input.show.selected_ai_reference_id)
  const byLegacyId = findDesignById(designs, input.show.selected_marketing_design_id)
  const showAiDesign =
    (byAiId?.design_kind === 'ai_reference' ? byAiId : null)
    ?? (byLegacyId?.design_kind === 'ai_reference' ? byLegacyId : null)
    ?? findSelectedDesign(designs, input.show.selected_ai_reference_id, 'ai_reference')

  const aiReference = showAiDesign
    ? designRowToTemplate(showAiDesign)
    : club?.default_ai_poster_reference_url
      ? templateFromClubUrl(club.default_ai_poster_reference_url, 'Klubb-referanseplakat')
      : null

  const aiReferenceSource: 'show' | 'club' | null = showAiDesign ? 'show' : aiReference ? 'club' : null

  return {
    useReference,
    aiReference,
    aiReferenceSource,
  }
}

export async function loadResolvedPosterContext(showId: string): Promise<ResolvedPosterContext> {
  const db = createAdminClient()

  const { data: show, error: showError } = await db
    .from('shows')
    .select('poster_use_reference, club_id, selected_ai_reference_id, selected_marketing_design_id')
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
        .select('default_ai_poster_reference_url')
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
