'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { approveArtist } from '@/lib/actions/artist'
import { canonicalRoleValues } from '@/lib/artist-roles'
import type { Artist, EnergyLevel, ArtistGender, ArtistStatus } from '@/types/database'

export async function saveArtistAdminReview(formData: FormData) {
  const artistId = formData.get('artist_id') as string
  const clubId = (formData.get('club_id') as string) || null
  const db = createAdminClient()

  const energyRaw = ((formData.get('admin_energy_level') as string) || null) as EnergyLevel | null
  const statusRaw = (formData.get('status') as string) as ArtistStatus
  const genderRaw = ((formData.get('gender') as string) || null) as ArtistGender | null
  const categoryValues = canonicalRoleValues(formData.getAll('category').map((value) => String(value)))
  const scoreRaw = formData.get('admin_score')
  const score = scoreRaw ? Number(scoreRaw) : null

  await db.from('artists').update({
    admin_score: score,
    admin_energy_level: energyRaw,
    category: categoryValues.length ? categoryValues : null,
    gender: genderRaw,
    admin_notes: (formData.get('admin_notes') as string) || null,
    status: statusRaw,
    is_flagged: formData.get('is_flagged') === 'true',
    flag_reason: (formData.get('flag_reason') as string) || null,
  }).eq('id', artistId)

  if (clubId && score) {
    await db.from('artist_club_scores').upsert(
      {
        artist_id: artistId,
        club_id: clubId,
        score,
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
  const score = Number(formData.get('admin_score') ?? 0)
  const energy = (((formData.get('admin_energy_level') as string) || 'uncertain') as EnergyLevel)
  await approveArtist(artistId, { admin_score: score, admin_energy_level: energy })
  if (clubId) {
    const db = createAdminClient()
    await db.from('artist_club_scores').upsert(
      { artist_id: artistId, club_id: clubId, approved: true, score: score || null, reviewed_at: new Date().toISOString() },
      { onConflict: 'artist_id,club_id' }
    )
  }
  revalidatePath(`/admin-app/artists/${artistId}`)
}

export async function rejectArtistAction(formData: FormData) {
  const artistId = formData.get('artist_id') as string
  const clubId = (formData.get('club_id') as string) || null
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
  const db = createAdminClient()
  await db.from('artists').delete().eq('id', artistId)
  revalidatePath('/admin-app/artists')
  redirect('/admin-app/artists')
}

export async function saveClubScoreAction(formData: FormData) {
  const artistId = formData.get('artist_id') as string
  const clubId = formData.get('club_id') as string
  if (!artistId || !clubId) throw new Error('Mangler artist_id eller club_id')

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
