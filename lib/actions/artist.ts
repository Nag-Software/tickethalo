'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { sendArtistRegisteredEmail } from '@/lib/email/mailer'
import { runAutomaticBookingForOpenShows } from '@/lib/actions/booking'
import { runAfterResponse } from '@/lib/background'
import { canonicalRoleValues } from '@/lib/artist-roles'
import {
  resolveExistingProfileImages,
  resolveProfileImageInput,
  uploadArtistProfileImages,
} from '@/lib/artist-profile-images'
import type { ArtistGender } from '@/types/database'

export interface RegisterArtistInput {
  email: string
  password: string
  full_name: string
  stage_name?: string
  phone?: string
  bio?: string
  category?: string[]
  language?: string
  gender?: ArtistGender
  social_links?: Record<string, string>
  profile_image_files?: File[]
  primary_profile_image_index?: number
}

export interface CompleteArtistRegistrationInput extends Omit<RegisterArtistInput, 'password'> {
  authUserId: string
  password?: string
  keepExistingProfileImage?: boolean
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

    // 3. Upload required profile images
    const profileImages = resolveProfileImageInput(input)
    const { profile_image_url, profile_image_urls } = await uploadArtistProfileImages(
      admin,
      authUserId,
      profileImages.files,
      profileImages.primaryIndex,
    )

    // 4. Create artist with status = pending_review
    const { data: artist, error: artistError } = await admin.from('artists').insert({
      auth_user_id: authUserId,
      full_name: input.full_name,
      stage_name: input.stage_name ?? null,
      email: normalizedEmail,
      phone: input.phone ?? null,
      profile_image_url: profile_image_url ?? null,
      profile_image_urls,
      bio: input.bio ?? null,
      category: normalizeCategoryValues(input.category),
      language: input.language ?? null,
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
 * Complete an artist profile for an existing auth user (partial registration).
 */
export async function completeArtistRegistration(input: CompleteArtistRegistrationInput) {
  const admin = createAdminClient()
  const normalizedEmail = input.email.trim().toLowerCase()

  const { data: authUserData, error: authError } = await admin.auth.admin.getUserById(input.authUserId)
  if (authError || !authUserData.user) {
    throw new Error('Auth user not found')
  }

  if (authUserData.user.email?.trim().toLowerCase() !== normalizedEmail) {
    throw new Error('Email mismatch for existing account')
  }

  const { data: existingArtist } = await admin
    .from('artists')
    .select('id')
    .eq('auth_user_id', input.authUserId)
    .maybeSingle()

  if (existingArtist) {
    throw new Error('Artist profile already exists')
  }

  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, role')
    .eq('auth_user_id', input.authUserId)
    .maybeSingle()

  // Never silently demote a privileged account to 'artist'. /signup is public and does
  // not bounce logged-in non-artist users, so without this guard an owner/admin/staff/
  // superadmin who submits the form with their own email would lose admin access (and
  // have their password reset below). Checked before any mutation.
  if (existingProfile?.role && existingProfile.role !== 'artist') {
    throw new Error('Denne kontoen har allerede en rolle i systemet og kan ikke registreres som artist.')
  }

  if (input.password && input.password.length >= 8) {
    const { error: passwordError } = await admin.auth.admin.updateUserById(input.authUserId, {
      password: input.password,
    })
    if (passwordError) throw new Error(passwordError.message)
  }

  if (existingProfile) {
    const { error: profileError } = await admin
      .from('profiles')
      .update({
        email: normalizedEmail,
        full_name: input.full_name,
        role: 'artist',
      })
      .eq('auth_user_id', input.authUserId)

    if (profileError) throw new Error(profileError.message)
  } else {
    const { error: profileError } = await admin.from('profiles').insert({
      auth_user_id: input.authUserId,
      email: normalizedEmail,
      full_name: input.full_name,
      role: 'artist',
    })
    if (profileError) throw new Error(profileError.message)
  }

  let profile_image_url: string | undefined
  let profile_image_urls: string[] = []

  const profileImages = resolveProfileImageInput(input)
  if (profileImages.files.length > 0) {
    const uploaded = await uploadArtistProfileImages(
      admin,
      input.authUserId,
      profileImages.files,
      profileImages.primaryIndex,
    )
    profile_image_url = uploaded.profile_image_url
    profile_image_urls = uploaded.profile_image_urls
  } else if (input.keepExistingProfileImage) {
    const existing = await resolveExistingProfileImages(admin, input.authUserId)
    if (existing) {
      profile_image_url = existing.profile_image_url
      profile_image_urls = existing.profile_image_urls
    }
  }

  if (!profile_image_url) {
    throw new Error('Required fields missing')
  }

  const { data: artist, error: artistError } = await admin.from('artists').insert({
    auth_user_id: input.authUserId,
    full_name: input.full_name,
    stage_name: input.stage_name ?? null,
    email: normalizedEmail,
    phone: input.phone ?? null,
    profile_image_url: profile_image_url ?? null,
    profile_image_urls,
    bio: input.bio ?? null,
    category: normalizeCategoryValues(input.category),
    language: input.language ?? null,
    gender: input.gender ?? null,
    social_links: input.social_links ?? null,
    status: 'pending_review',
  }).select('id').single()

  if (artistError || !artist) throw new Error(artistError?.message ?? 'Failed to create artist')

  await sendArtistRegisteredEmail({ email: normalizedEmail, full_name: input.full_name })

  return { artistId: artist.id }
}

/**
 * 6.3 Approve artist
 */
export async function approveArtist(
  artistId: string,
  opts: {
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
      admin_energy_level: opts.admin_energy_level,
      admin_notes: opts.admin_notes ?? null,
    })
    .eq('id', artistId)
    .select('email, full_name')
    .single()

  if (error || !artist) throw new Error(error?.message ?? 'Artist not found')

  {
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
