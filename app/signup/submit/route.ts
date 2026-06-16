import { NextResponse } from 'next/server'
import { completeArtistRegistration, registerArtist } from '@/lib/actions/artist'
import {
  parseArtistSignupFormData,
  toSignupErrorCode,
  validateArtistSignupForm,
} from '@/lib/artist-signup'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
  const origin = `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host') ?? new URL(request.url).host}`
  const pathname = new URL(request.url).pathname
  const isArtistAppSignup = pathname.startsWith('/artist-app/')
  const signupPath = isArtistAppSignup ? '/artist-app/signup' : '/signup'
  const formData = await request.formData()

  try {
    const completionAuthUserId = await resolveCompletionAuthUserId(String(formData.get('email') ?? '').trim().toLowerCase())
    const parsed = parseArtistSignupFormData(formData)

    if (isArtistAppSignup) {
      validateArtistSignupForm(formData, {
        completionMode: Boolean(completionAuthUserId),
        hasExistingProfileImage: parsed.hasExistingProfileImage,
      })
    }

    const payload = {
      email: parsed.email,
      full_name: parsed.full_name,
      stage_name: parsed.stage_name,
      phone: parsed.phone,
      bio: parsed.bio,
      category: parsed.category,
      language: parsed.language,
      gender: parsed.gender,
      social_links: parsed.social_links,
      profile_image_files: parsed.profile_image_files,
      primary_profile_image_index: parsed.primary_profile_image_index,
    }

    if (completionAuthUserId) {
      await completeArtistRegistration({
        ...payload,
        authUserId: completionAuthUserId,
        password: parsed.password || undefined,
        keepExistingProfileImage: parsed.hasExistingProfileImage,
      })

      if (isArtistAppSignup) {
        return NextResponse.redirect(new URL('/artist-app', origin), 303)
      }
    } else {
      await registerArtist({
        ...payload,
        password: parsed.password,
      })
    }

    return NextResponse.redirect(new URL(`${signupPath}?status=submitted`, origin), 303)
  } catch (error) {
    console.error(error)
    const code = toSignupErrorCode(error)
    return NextResponse.redirect(new URL(`${signupPath}?error=${code}`, origin), 303)
  }
}

async function resolveCompletionAuthUserId(email: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  if (user.email?.trim().toLowerCase() !== email) {
    throw new Error('Email mismatch for logged in account')
  }

  const admin = createAdminClient()
  const { data: artist } = await admin
    .from('artists')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  return artist ? null : user.id
}
