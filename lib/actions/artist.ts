'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { sendArtistApprovedEmail } from '@/lib/email/mailer'

import { runAfterResponse } from '@/lib/background'
import { insertArtistProfile } from '@/lib/artist-profile-insert'
import type { ArtistGender } from '@/types/database'
import { appPath } from '@/lib/app-url'

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

    // 3–4. Headshot + the artist row, approved so the new user can enter immediately.
    const artist = await insertArtistProfile(admin, { authUserId, email: normalizedEmail, profile: input })

    // 5. Komikeren er inne med det samme, så e-posten er portalenken — ikke
    //    en kvittering på en søknad ingen behandler. Lenken går til
    //    kalenderen, der hen markerer dagene hen ikke kan.
    //
    //    Motoren kjøres ikke herfra. En ny komiker er ikke på noen klubbs
    //    liste ennå, så det ville vært en full runde over alle show på
    //    plattformen uten en eneste ny kandidat. Motoren kjøres i stedet når
    //    en klubb legger komikeren på listen sin — se `connectArtistAction`.
    const artistAppUrl = process.env.ARTIST_APP_URL ?? appPath('/artist-app')
    runAfterResponse(`register-artist-${artist.id}`, async () => {
      await sendArtistApprovedEmail({
        email: normalizedEmail,
        full_name: input.full_name,
        portal_url: `${artistAppUrl.replace(/\/$/, '')}/availability`,
      })
    })

    return { artistId: artist.id }
  } catch (err) {
    // Clean up auth user if later steps fail
    await admin.auth.admin.deleteUser(authUserId)
    throw err
  }
}
