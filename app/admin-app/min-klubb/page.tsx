import { AdminHeader } from '@/components/admin/admin-header'
import { ClubProfileForm } from '@/components/admin/club-profile-form'
import { ClubPosterDefaultsForm } from '@/components/admin/club-poster-defaults-form'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function MinKlubbPage() {
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()

  const { data: club, error: clubError } = await db
    .from('clubs')
    .select('id, name, slug, description, logo_url, header_image_url, gallery_image_urls, location_name, address_line, city, default_ai_poster_reference_url, default_frame_background_url')
    .eq('id', clubId)
    .single()

  if (clubError || !club) {
    throw new Error('Fant ikke klubbprofilen.')
  }

  return (
    <div>
      <AdminHeader title="Branding" description={`Profil og visuelt uttrykk for ${club.name}.`} />
      <div className="max-w-3xl space-y-6 p-6">
        <ClubProfileForm club={club} />
        <ClubPosterDefaultsForm
          clubId={club.id}
          defaultAiPosterReferenceUrl={club.default_ai_poster_reference_url}
          defaultFrameBackgroundUrl={club.default_frame_background_url}
        />
      </div>
    </div>
  )
}
