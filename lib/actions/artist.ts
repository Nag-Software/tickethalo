'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { sendArtistRegisteredEmail } from '@/lib/email/mailer'
import { runAutomaticBookingForOpenShows } from '@/lib/actions/booking'
import { runAfterResponse } from '@/lib/background'
import { canonicalRoleValues } from '@/lib/artist-roles'
import type { ArtistGender } from '@/types/database'

export interface RegisterArtistInput {
  email: string
  password: string
  full_name: string
  stage_name?: string
  phone?: string
  bio?: string
  category?: string[]
  city?: string
  country?: string
  languages?: string[]
  gender?: ArtistGender
  social_links?: Record<string, string>
  profile_image_file?: File
}

function normalizeCategoryValues(value: string[] | undefined) {
  const normalized = canonicalRoleValues(value)
  return normalized.length > 0 ? normalized : null
}

/**
 * 6.1 Artist registration
 * Creates Auth user → profile → artist → AI assessment → sends email → triggers AI job
 */
export async function registerArtist(input: RegisterArtistInput) {
  const admin = createAdminClient()
  const normalizedEmail = input.email.trim().toLowerCase()

  // 1. Create Supabase Auth user
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: normalizedEmail,
    password: input.password,
    // We do not run a separate email verification flow in MVP.
    email_confirm: true,
  })
  if (authError || !authData.user) {
    throw new Error(authError?.message ?? 'Failed to create auth user')
  }
  const authUserId = authData.user.id

  try {
    // 2. Create profile with role = artist
    const { error: profileError } = await admin.from('profiles').insert({
      auth_user_id: authUserId,
      email: normalizedEmail,
      full_name: input.full_name,
      role: 'artist',
    })
    if (profileError) throw new Error(profileError.message)

    // 3. Upload profile image if provided
    let profile_image_url: string | undefined
    if (input.profile_image_file) {
      const ext = input.profile_image_file.name.split('.').pop()
      const path = `${authUserId}/profile.${ext}`
      const { error: uploadError } = await admin.storage
        .from('artist-images')
        .upload(path, input.profile_image_file, { upsert: true })
      if (!uploadError) {
        const { data: urlData } = admin.storage.from('artist-images').getPublicUrl(path)
        profile_image_url = urlData.publicUrl
      }
    }

    // 4. Create artist with status = pending_review
    const { data: artist, error: artistError } = await admin.from('artists').insert({
      auth_user_id: authUserId,
      full_name: input.full_name,
      stage_name: input.stage_name ?? null,
      email: normalizedEmail,
      phone: input.phone ?? null,
      profile_image_url: profile_image_url ?? null,
      bio: input.bio ?? null,
      category: normalizeCategoryValues(input.category),
      city: input.city ?? null,
      country: input.country ?? null,
      languages: input.languages?.length ? input.languages : null,
      gender: input.gender ?? null,
      social_links: input.social_links ?? null,
      status: 'pending_review',
    }).select('id').single()
    if (artistError || !artist) throw new Error(artistError?.message ?? 'Failed to create artist')

    // 5. Send registration confirmation email
    await sendArtistRegisteredEmail({ email: normalizedEmail, full_name: input.full_name })

    return { artistId: artist.id }
  } catch (err) {
    // Clean up auth user if later steps fail
    await admin.auth.admin.deleteUser(authUserId)
    throw err
  }
}

/**
 * 6.3 Approve artist
 */
export async function approveArtist(
  artistId: string,
  opts: {
    admin_score: number
    admin_energy_level: 'high' | 'medium' | 'low' | 'uncertain'
    admin_notes?: string
  }
) {
  const { sendArtistApprovedEmail } = await import('@/lib/email/mailer')
  const admin = createAdminClient()

  const { data: artist, error } = await admin
    .from('artists')
    .update({
      status: 'approved',
      admin_score: opts.admin_score,
      admin_energy_level: opts.admin_energy_level,
      admin_notes: opts.admin_notes ?? null,
    })
    .eq('id', artistId)
    .select('email, full_name, admin_score')
    .single()

  if (error || !artist) throw new Error(error?.message ?? 'Artist not found')

  if ((artist.admin_score ?? 0) > 6) {
    const artistAppUrl = process.env.ARTIST_APP_URL ?? `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/artist-app`
    runAfterResponse(`approve-artist-${artistId}`, async () => {
      await sendArtistApprovedEmail({
        email: artist.email,
        full_name: artist.full_name,
        portal_url: `${artistAppUrl.replace(/\/$/, '')}/available-dates`,
      })

      try {
        await runAutomaticBookingForOpenShows()
      } catch (bookingError) {
        console.error('[BookingAutomation] Failed after artist approval:', bookingError)
      }
    })
  }
}
