import { AdminHeader } from '@/components/admin/admin-header'
import { ClubProfileForm } from '@/components/admin/club-profile-form'
import { ClubPosterDefaultsForm } from '@/components/admin/club-poster-defaults-form'
import { PosterTemplatesManager, type PosterTemplateListItem } from '@/components/admin/poster-templates-manager'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  convertReferenceToTemplateAction,
  createPosterTemplateFromUploadAction,
  deletePosterTemplateAction,
  setClubDefaultTemplateAction,
} from './poster-template-actions'

export default async function MinKlubbPage() {
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()

  const { data: club, error: clubError } = await db
    .from('clubs')
    .select('id, name, slug, description, logo_url, header_image_url, gallery_image_urls, location_name, address_line, city, default_ai_poster_reference_url, default_frame_background_url, default_poster_template_id')
    .eq('id', clubId)
    .single()

  if (clubError || !club) {
    throw new Error('Fant ikke klubbprofilen.')
  }

  const { data: templateRows } = await db
    .from('poster_templates')
    .select('id, name, status, plate_url, source_poster_url')
    .eq('club_id', clubId)
    .order('created_at', { ascending: false })

  const templates: PosterTemplateListItem[] = (templateRows ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    thumbnailUrl: t.plate_url ?? t.source_poster_url,
    isDefault: club.default_poster_template_id === t.id,
  }))

  return (
    <div>
      <AdminHeader title="Branding" description={`Profil og visuelt uttrykk for ${club.name}.`} />
      <div className="max-w-3xl space-y-6 p-6">
        <ClubProfileForm club={club} />
        <PosterTemplatesManager
          templates={templates}
          hasLegacyReference={Boolean(club.default_ai_poster_reference_url)}
          createAction={createPosterTemplateFromUploadAction}
          setDefaultAction={setClubDefaultTemplateAction}
          deleteAction={deletePosterTemplateAction}
          convertReferenceAction={convertReferenceToTemplateAction}
        />
        <ClubPosterDefaultsForm
          clubId={club.id}
          defaultAiPosterReferenceUrl={club.default_ai_poster_reference_url}
          defaultFrameBackgroundUrl={club.default_frame_background_url}
        />
      </div>
    </div>
  )
}
