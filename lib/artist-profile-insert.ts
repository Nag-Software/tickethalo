import { canonicalRoleValues } from '@/lib/artist-roles'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ArtistProfileFields } from '@/lib/artist-signup-form'

type AdminClient = ReturnType<typeof createAdminClient>

function normalizeCategoryValues(value: string[] | undefined) {
  const normalized = canonicalRoleValues(value)
  return normalized.length > 0 ? normalized : null
}

/**
 * Komikerraden for en innlogging, med headshotet lastet opp.
 *
 * Delt mellom den offentlige registreringen (`registerArtist`, som lager
 * innloggingen først) og «Create comedian profile» under My club, der raden
 * havner på klubbinnloggingen. Ligger utenfor `lib/actions/artist.ts` fordi
 * alt som eksporteres fra en `'use server'`-fil kan kalles fra nettleseren.
 */
export async function insertArtistProfile(
  admin: AdminClient,
  input: { authUserId: string; email: string; profile: ArtistProfileFields }
): Promise<{ id: string }> {
  const { authUserId, email, profile } = input

  let profile_image_url: string | undefined
  if (profile.profile_image_file) {
    const ext = profile.profile_image_file.name.split('.').pop()
    const path = `${authUserId}/profile.${ext}`
    const { error: uploadError } = await admin.storage
      .from('artist-images')
      .upload(path, profile.profile_image_file, { upsert: true })
    if (!uploadError) {
      const { data: urlData } = admin.storage.from('artist-images').getPublicUrl(path)
      profile_image_url = urlData.publicUrl
    }
  }

  // Godkjent med en gang, så den nye brukeren slipper rett inn.
  const { data: artist, error: artistError } = await admin.from('artists').insert({
    auth_user_id: authUserId,
    full_name: profile.full_name,
    stage_name: profile.stage_name ?? null,
    email,
    phone: profile.phone ?? null,
    profile_image_url: profile_image_url ?? null,
    bio: profile.bio ?? null,
    category: normalizeCategoryValues(profile.category),
    city: profile.city ?? null,
    country: profile.country ?? null,
    languages: profile.languages?.length ? profile.languages : null,
    gender: profile.gender ?? null,
    social_links: profile.social_links ?? null,
    // Ingen kø. Alle slipper inn med én gang, og superadmin tar ut igjen
    // dem som ikke skal være her — se `updateArtistStatusAction`.
    status: 'approved',
  }).select('id').single()
  if (artistError || !artist) {
    const error = new Error(artistError?.message ?? 'Failed to create artist') as Error & { code?: string }
    error.code = artistError?.code
    throw error
  }

  return artist
}
