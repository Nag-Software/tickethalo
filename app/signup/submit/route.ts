import { NextResponse } from 'next/server'
import { completeArtistRegistration, registerArtist } from '@/lib/actions/artist'
import { canonicalRoleValues } from '@/lib/artist-roles'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ArtistGender } from '@/types/database'

export async function POST(request: Request) {
  const origin = `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host') ?? new URL(request.url).host}`
  const pathname = new URL(request.url).pathname
  const isArtistAppSignup = pathname.startsWith('/artist-app/')
  const signupPath = isArtistAppSignup ? '/artist-app/signup' : '/signup'
  const formData = await request.formData()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const hasExistingProfileImage = formData.get('existing_profile_image') === '1'

  try {
    const completionAuthUserId = await resolveCompletionAuthUserId(email)

    if (isArtistAppSignup) {
      validateSignupForm(formData, {
        completionMode: Boolean(completionAuthUserId),
        hasExistingProfileImage,
      })
    }

    const payload = {
      email,
      full_name: String(formData.get('full_name') ?? ''),
      stage_name: optionalString(formData.get('stage_name')),
      phone: optionalString(formData.get('phone')),
      bio: optionalString(formData.get('bio')),
      category: categories(formData),
      language: optionalString(formData.get('language')),
      gender: gender(formData.get('gender')),
      social_links: socialLinks(formData),
      profile_image_file: fileOrUndefined(formData.get('profile_image_file')),
    }

    if (completionAuthUserId) {
      await completeArtistRegistration({
        ...payload,
        authUserId: completionAuthUserId,
        password: password || undefined,
        keepExistingProfileImage: hasExistingProfileImage,
      })

      if (isArtistAppSignup) {
        return NextResponse.redirect(new URL('/artist-app', origin), 303)
      }
    } else {
      await registerArtist({
        ...payload,
        password,
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

function toSignupErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('already') || message.includes('duplicate')) return 'email_exists'
  if (message.includes('mismatch')) return 'account_mismatch'
  if (message.includes('password')) return 'invalid_password'
  if (message.includes('email')) return 'invalid_email'
  if (message.includes('youtube')) return 'invalid_youtube'
  if (message.includes('required')) return 'missing'
  return 'failed'
}

function validateSignupForm(
  formData: FormData,
  opts: { completionMode: boolean; hasExistingProfileImage: boolean },
) {
  const requiredTextFields = opts.completionMode
    ? ['full_name', 'stage_name', 'email', 'phone', 'language', 'gender']
    : ['full_name', 'stage_name', 'email', 'password', 'phone', 'language', 'gender']

  const hasMissingText = requiredTextFields.some((field) => !optionalString(formData.get(field)))
  const hasImage = opts.hasExistingProfileImage || Boolean(fileOrUndefined(formData.get('profile_image_file')))
  const hasCategory = formData.getAll('category').some((value) => optionalString(value))
  const youtube = optionalString(formData.get('youtube'))
  const password = String(formData.get('password') ?? '')

  if (hasMissingText || !hasImage || !hasCategory || !youtube) {
    throw new Error('Required fields missing')
  }

  if (!opts.completionMode && password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }

  if (opts.completionMode && password.length > 0 && password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }

  if (!isYouTubeUrl(youtube)) {
    throw new Error('Invalid YouTube URL')
  }
}

function optionalString(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : undefined
}

function categories(formData: FormData) {
  const values = formData
    .getAll('category')
    .map((value) => optionalString(value))
    .filter((value): value is string => Boolean(value))
  const normalized = canonicalRoleValues(values)
  return normalized.length > 0 ? normalized : undefined
}

function gender(value: FormDataEntryValue | null): ArtistGender | undefined {
  const text = optionalString(value)
  if (text === 'male' || text === 'female' || text === 'other') return text
  return undefined
}

function socialLinks(formData: FormData): Record<string, string> | undefined {
  const links = {
    instagram: optionalString(formData.get('instagram')),
    tiktok: optionalString(formData.get('tiktok')),
    youtube: optionalString(formData.get('youtube')),
    facebook: optionalString(formData.get('facebook')),
    website: optionalString(formData.get('website')),
  }
  const entries = Object.entries(links).filter((entry): entry is [string, string] => Boolean(entry[1]))
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function isYouTubeUrl(value: string) {
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./, '')
    return host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com'
  } catch {
    return false
  }
}

function fileOrUndefined(value: FormDataEntryValue | null) {
  return value instanceof File && value.size > 0 ? value : undefined
}
