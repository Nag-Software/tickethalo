import { NextResponse } from 'next/server'
import { registerArtist } from '@/lib/actions/artist'
import { lookupCountry, type CountryCode } from '@/lib/geo'
import { normalizeLanguages } from '@/lib/languages'
import type { ArtistGender } from '@/types/database'

const signupPath = '/artist-app/signup'

export async function POST(request: Request) {
  const origin = `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host') ?? new URL(request.url).host}`
  const formData = await request.formData()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()

  try {
    validateSignupForm(formData)

    await registerArtist({
      email,
      password: String(formData.get('password') ?? ''),
      full_name: String(formData.get('full_name') ?? ''),
      phone: optionalString(formData.get('phone')),
      bio: optionalString(formData.get('bio')),
      city: optionalString(formData.get('city')),
      country: country(formData.get('country')),
      languages: normalizeLanguages(formData.getAll('language').map((value) => String(value))),
      gender: gender(formData.get('gender')),
      social_links: socialLinks(formData),
      profile_image_file: fileOrUndefined(formData.get('profile_image_file')),
    })

    return NextResponse.redirect(new URL(`${signupPath}?status=submitted`, origin), 303)
  } catch (error) {
    console.error(error)
    const code = toSignupErrorCode(error)
    return NextResponse.redirect(new URL(`${signupPath}?error=${code}`, origin), 303)
  }
}

function toSignupErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('already') || message.includes('duplicate')) return 'email_exists'
  if (message.includes('password')) return 'invalid_password'
  if (message.includes('email')) return 'invalid_email'
  if (message.includes('youtube')) return 'invalid_youtube'
  if (message.includes('required')) return 'missing'
  return 'failed'
}

function validateSignupForm(formData: FormData) {
  const requiredTextFields = ['full_name', 'email', 'password', 'phone', 'city', 'gender']
  const hasMissingText = requiredTextFields.some((field) => !optionalString(formData.get(field)))
  const hasImage = Boolean(fileOrUndefined(formData.get('profile_image_file')))
  const hasCountry = Boolean(country(formData.get('country')))
  const hasLanguage = normalizeLanguages(formData.getAll('language').map((value) => String(value))).length > 0
  const youtube = optionalString(formData.get('youtube'))

  if (hasMissingText || !hasImage || !hasCountry || !hasLanguage || !youtube) {
    throw new Error('Required fields missing')
  }

  if (!isYouTubeUrl(youtube)) {
    throw new Error('Invalid YouTube URL')
  }
}

function optionalString(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : undefined
}

/** Kun land vi faktisk har i tabellen — ellers blir kolonnen fritekst igjen. */
function country(value: FormDataEntryValue | null): CountryCode | undefined {
  const text = optionalString(value)?.toUpperCase()
  return text && lookupCountry(text) ? (text as CountryCode) : undefined
}

const GENDER_VALUES: readonly ArtistGender[] = ['woman', 'man', 'non_binary', 'prefer_not_to_say']

function gender(value: FormDataEntryValue | null): ArtistGender | undefined {
  const text = optionalString(value)
  return GENDER_VALUES.find((allowed) => allowed === text)
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
