import { isApprovedHeadshot } from '@/lib/headshot-check'
import { lookupCountry, type CountryCode } from '@/lib/geo'
import { normalizeLanguages } from '@/lib/languages'
import { socialLinksFromForm } from '@/lib/social-links'
import type { RegisterArtistInput } from '@/lib/actions/artist'
import type { ArtistGender } from '@/types/database'

/**
 * Registreringsskjemaet til komikerne, lest og sjekket ett sted.
 *
 * Skjemaet brukes to steder: den offentlige registreringen, som lager en ny
 * innlogging (`new-account`), og «Create comedian profile» under My club,
 * der profilen havner på klubbinnloggingen brukeren alt har
 * (`existing-account`). Da finnes det ikke noe passord å sjekke, og e-posten
 * er bare adressen tilbudene sendes til.
 */
export type ArtistSignupMode = 'new-account' | 'existing-account'

export type ArtistProfileFields = Omit<RegisterArtistInput, 'email' | 'password'>

export type ParsedArtistSignup = {
  email: string
  /** Bare i `new-account`. */
  password?: string
  profile: ArtistProfileFields
}

export async function parseArtistSignupForm(formData: FormData, mode: ArtistSignupMode): Promise<ParsedArtistSignup> {
  validateSignupForm(formData, mode)
  await validateHeadshot(formData)

  return {
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    password: mode === 'new-account' ? String(formData.get('password') ?? '') : undefined,
    profile: {
      full_name: String(formData.get('full_name') ?? ''),
      phone: optionalString(formData.get('phone')),
      bio: optionalString(formData.get('bio')),
      city: optionalString(formData.get('city')),
      country: country(formData.get('country')),
      languages: normalizeLanguages(formData.getAll('language').map((value) => String(value))),
      gender: gender(formData.get('gender')),
      social_links: socialLinksFromForm(formData) ?? undefined,
      profile_image_file: fileOrUndefined(formData.get('profile_image_file')),
    },
  }
}

export function toSignupErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('already') || message.includes('duplicate')) return 'email_exists'
  if (message.includes('passwords do not match')) return 'password_mismatch'
  if (message.includes('password')) return 'invalid_password'
  if (message.includes('email')) return 'invalid_email'
  if (message.includes('video')) return 'invalid_video'
  if (message.includes('headshot')) return 'photo_unchecked'
  if (message.includes('required')) return 'missing'
  return 'failed'
}

function validateSignupForm(formData: FormData, mode: ArtistSignupMode) {
  const requiredTextFields = mode === 'new-account'
    ? ['full_name', 'email', 'password', 'phone', 'city', 'gender']
    : ['full_name', 'email', 'phone', 'city', 'gender']
  const hasMissingText = requiredTextFields.some((field) => !optionalString(formData.get(field)))
  const hasImage = Boolean(fileOrUndefined(formData.get('profile_image_file')))
  const hasCountry = Boolean(country(formData.get('country')))
  const hasLanguage = normalizeLanguages(formData.getAll('language').map((value) => String(value))).length > 0
  const video = optionalString(formData.get('showcase'))

  if (hasMissingText || !hasImage || !hasCountry || !hasLanguage) {
    throw new Error('Required fields missing')
  }

  if (mode === 'new-account') {
    const password = optionalString(formData.get('password'))
    const passwordConfirmation = optionalString(formData.get('password_confirm'))
    if (password !== passwordConfirmation) {
      throw new Error('Passwords do not match')
    }
  } else if (!isEmail(String(formData.get('email') ?? '').trim())) {
    // Ny innlogging sjekkes av Supabase. Her lages ingen innlogging, så
    // adressen tilbudene skal til må sjekkes av oss.
    throw new Error('Invalid email')
  }

  if (video && !isVideoUrl(video)) {
    throw new Error('Invalid video URL')
  }
}

/**
 * Bildet må være det skjemaet fikk godkjent — kvitteringen er signert for
 * akkurat de bytene. Se `lib/headshot-check.ts`.
 */
async function validateHeadshot(formData: FormData) {
  const photo = fileOrUndefined(formData.get('profile_image_file'))
  if (!photo) return
  const image = Buffer.from(await photo.arrayBuffer())
  if (!isApprovedHeadshot(image, optionalString(formData.get('profile_image_check')))) {
    throw new Error('Headshot not approved')
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

export function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isVideoUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function fileOrUndefined(value: FormDataEntryValue | null) {
  return value instanceof File && value.size > 0 ? value : undefined
}
