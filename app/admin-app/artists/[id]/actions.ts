'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClubAccess } from '@/lib/club-auth'
import { approveArtist } from '@/lib/actions/artist'
import { canonicalRoleValues } from '@/lib/artist-roles'
import type { Artist, EnergyLevel, ArtistGender, ArtistStatus } from '@/types/database'

/**
 * These Server Actions use the service-role admin client, which bypasses RLS, so
 * every one of them MUST authenticate the caller and scope club-specific writes
 * to a club the caller belongs to. There is no middleware doing this — proxy.ts
 * only refreshes the Supabase session. Without this gate the action endpoints are
 * an open mutation surface (delete/approve/reject any artist, or write scores for
 * any club).
 */
async function assertArtistAdminAccess(clubId: string | null) {
  const access = await getClubAccess()
  if (!access.isSuperadmin && access.clubIds.length === 0) {
    throw new Error('Du har ikke tilgang.')
  }
  if (clubId && !access.isSuperadmin && !access.clubIds.includes(clubId)) {
    throw new Error('Du har ikke tilgang til denne klubben.')
  }
}

export async function saveArtistAdminReview(formData: FormData) {
  const artistId = formData.get('artist_id') as string
  const clubId = (formData.get('club_id') as string) || null
  await assertArtistAdminAccess(clubId)
  const db = createAdminClient()

  const energyRaw = ((formData.get('admin_energy_level') as string) || null) as EnergyLevel | null
  const statusRaw = (formData.get('status') as string) as ArtistStatus
  const genderRaw = ((formData.get('gender') as string) || null) as ArtistGender | null
  // The "Nivå" chips are the club's own segmentation — stored per club, not on the
  // global artist record (which keeps the artist's self-declared category).
  const categoryValues = canonicalRoleValues(formData.getAll('category').map((value) => String(value)))

  await db.from('artists').update({
    admin_energy_level: energyRaw,
    gender: genderRaw,
    admin_notes: (formData.get('admin_notes') as string) || null,
    status: statusRaw,
    is_flagged: formData.get('is_flagged') === 'true',
    flag_reason: (formData.get('flag_reason') as string) || null,
  }).eq('id', artistId)

  if (clubId) {
    await db.from('artist_club_scores').upsert(
      {
        artist_id: artistId,
        club_id: clubId,
        categories: categoryValues.length ? categoryValues : null,
        approved: statusRaw === 'approved',
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: 'artist_id,club_id' }
    )
  }

  revalidatePath(`/admin-app/artists/${artistId}`)
}

export async function approveArtistAction(formData: FormData) {
  const artistId = formData.get('artist_id') as string
  const clubId = (formData.get('club_id') as string) || null
  await assertArtistAdminAccess(clubId)
  const energy = (((formData.get('admin_energy_level') as string) || 'uncertain') as EnergyLevel)
  await approveArtist(artistId, { admin_energy_level: energy })
  if (clubId) {
    const db = createAdminClient()
    await db.from('artist_club_scores').upsert(
      { artist_id: artistId, club_id: clubId, approved: true, reviewed_at: new Date().toISOString() },
      { onConflict: 'artist_id,club_id' }
    )
  }
  revalidatePath(`/admin-app/artists/${artistId}`)
}

export async function rejectArtistAction(formData: FormData) {
  const artistId = formData.get('artist_id') as string
  const clubId = (formData.get('club_id') as string) || null
  await assertArtistAdminAccess(clubId)
  const db = createAdminClient()
  await db.from('artists').update({ status: 'rejected' }).eq('id', artistId)
  if (clubId) {
    await db.from('artist_club_scores').upsert(
      { artist_id: artistId, club_id: clubId, approved: false, reviewed_at: new Date().toISOString() },
      { onConflict: 'artist_id,club_id' }
    )
  }
  revalidatePath(`/admin-app/artists/${artistId}`)
}

export async function updateArtistProfile(formData: FormData) {
  const artistId = formData.get('artist_id') as string
  if (!artistId) throw new Error('Mangler artist_id')
  await assertArtistAdminAccess(null)
  const db = createAdminClient()

  const socialLinksRaw = formData.get('social_links') as string | null
  let social_links: Record<string, string> | null = null
  if (socialLinksRaw) {
    try { social_links = JSON.parse(socialLinksRaw) } catch { social_links = null }
  }
  const categoryValues = canonicalRoleValues(formData.getAll('category').map((value) => String(value)))

  const update: Partial<Artist> = {}
  if (formData.has('full_name')) update.full_name = (formData.get('full_name') as string).trim()
  if (formData.has('stage_name')) update.stage_name = (formData.get('stage_name') as string).trim() || null
  if (formData.has('email')) update.email = (formData.get('email') as string).trim()
  if (formData.has('phone')) update.phone = (formData.get('phone') as string).trim() || null
  if (formData.has('category') || formData.has('category_present')) update.category = categoryValues.length > 0 ? categoryValues : null
  if (formData.has('language')) update.language = (formData.get('language') as string).trim() || null
  if (formData.has('bio')) update.bio = (formData.get('bio') as string).trim() || null
  if (formData.has('gender')) update.gender = ((formData.get('gender') as string).trim() || null) as Artist['gender']
  if (formData.has('social_links')) update.social_links = social_links

  await db.from('artists').update(update).eq('id', artistId)
  revalidatePath(`/admin-app/artists/${artistId}`)
}

export async function deleteArtistAction(formData: FormData) {
  const artistId = formData.get('artist_id') as string
  await assertArtistAdminAccess(null)
  const db = createAdminClient()
  await db.from('artists').delete().eq('id', artistId)
  revalidatePath('/admin-app/artists')
  redirect('/admin-app/artists')
}

export async function saveClubScoreAction(formData: FormData) {
  const artistId = formData.get('artist_id') as string
  const clubId = formData.get('club_id') as string
  if (!artistId || !clubId) throw new Error('Mangler artist_id eller club_id')
  await assertArtistAdminAccess(clubId)

  const approved = formData.get('approved') === 'true'
  const scoreRaw = formData.get('score') as string | null
  const score = scoreRaw ? Number(scoreRaw) : null
  const notes = (formData.get('notes') as string | null) || null

  const db = createAdminClient()
  await db.from('artist_club_scores').upsert(
    {
      artist_id: artistId,
      club_id: clubId,
      approved,
      score: approved ? score : null,
      notes,
      reviewed_at: new Date().toISOString(),
    },
    { onConflict: 'artist_id,club_id' }
  )

  revalidatePath(`/admin-app/artists/${artistId}`)
}
