import { createAdminClient } from '@/lib/supabase/admin'
import type { ArtistGender } from '@/types/database'

export type ArtistSignupDraft = {
  mode: 'complete'
  authUserId: string
  email: string
  full_name: string
  stage_name: string
  phone: string
  bio: string
  language: string
  gender: ArtistGender | ''
  category: string[]
  youtube: string
  instagram: string
  tiktok: string
  facebook: string
  website: string
  hasProfileImage: boolean
  profileImageUrl: string | null
}

export async function getArtistSignupDraft(authUserId: string): Promise<ArtistSignupDraft | null> {
  const admin = createAdminClient()

  const [{ data: authUserData }, { data: profile }, { data: artist }] = await Promise.all([
    admin.auth.admin.getUserById(authUserId),
    admin.from('profiles').select('email, full_name, role').eq('auth_user_id', authUserId).maybeSingle(),
    admin.from('artists').select('*').eq('auth_user_id', authUserId).maybeSingle(),
  ])

  const email = authUserData.user?.email?.trim().toLowerCase()
  if (!email) return null

  // Fully linked artist — no signup draft needed.
  if (artist) return null

  return {
    mode: 'complete',
    authUserId,
    email,
    full_name: profile?.full_name ?? '',
    stage_name: '',
    phone: '',
    bio: '',
    language: '',
    gender: '',
    category: [],
    youtube: '',
    instagram: '',
    tiktok: '',
    facebook: '',
    website: '',
    hasProfileImage: false,
    profileImageUrl: null,
  }
}
