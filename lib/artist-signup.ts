import { canonicalRoleValues } from '@/lib/artist-roles'
import {
  getPrimaryProfileImageIndex,
  getProfileImageFiles,
} from '@/lib/artist-profile-images'
import type { ArtistGender } from '@/types/database'

export type SignupFieldId =
  | 'full_name'
  | 'email'
  | 'password'
  | 'profile_images'
  | 'phone'
  | 'language'
  | 'gender'

export type SignupDraftLike = {
  full_name?: string
  email?: string
  phone?: string
  language?: string
  gender?: ArtistGender | ''
  hasProfileImage?: boolean
}

export function getSignupRequiredFields(completionMode: boolean) {
  return [
    { id: 'full_name' as const, label: 'Navn' },
    { id: 'email' as const, label: 'E-post' },
    ...(completionMode ? [] : [{ id: 'password' as const, label: 'Passord' }]),
    { id: 'profile_images' as const, label: 'Profilbilder' },
    { id: 'phone' as const, label: 'Telefon' },
    { id: 'language' as const, label: 'Språk' },
    { id: 'gender' as const, label: 'Kjønn' },
  ]
}

export function buildSignupFieldCompletion(
  draft: SignupDraftLike | undefined,
  completionMode: boolean,
): Record<SignupFieldId, boolean> {
  return {
    full_name: Boolean(draft?.full_name?.trim()),
    email: Boolean(draft?.email?.trim()),
    password: completionMode,
    profile_images: Boolean(draft?.hasProfileImage),
    phone: Boolean(draft?.phone?.trim()),
    language: Boolean(draft?.language),
    gender: Boolean(draft?.gender),
  }
}

export function getSignupProgress(
  values: Record<SignupFieldId, boolean>,
  completionMode: boolean,
) {
  const requiredFields = getSignupRequiredFields(completionMode)
  const completed = requiredFields.filter((field) => values[field.id]).length
  const missing = requiredFields.filter((field) => !values[field.id])

  return {
    requiredFields,
    completed,
    total: requiredFields.length,
    progress: Math.round((completed / requiredFields.length) * 100),
    missing,
    isComplete: missing.length === 0,
  }
}

export function validateArtistSignupForm(
  formData: FormData,
  opts: { completionMode: boolean; hasExistingProfileImage: boolean },
) {
  const requiredTextFields = opts.completionMode
    ? ['full_name', 'email', 'phone', 'language', 'gender']
    : ['full_name', 'email', 'password', 'phone', 'language', 'gender']

  const hasMissingText = requiredTextFields.some((field) => !optionalString(formData.get(field)))
  const hasImage = opts.hasExistingProfileImage || getProfileImageFiles(formData).length > 0
  const password = String(formData.get('password') ?? '')

  if (hasMissingText || !hasImage) {
    throw new Error('Required fields missing')
  }

  if (!opts.completionMode && password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }

  if (opts.completionMode && password.length > 0 && password.length < 8) {
    throw new Error('Password must be at least 8 characters')
  }

  const youtube = optionalString(formData.get('youtube'))
  if (youtube && !isYouTubeUrl(youtube)) {
    throw new Error('Invalid YouTube URL')
  }
}

export function parseArtistSignupFormData(formData: FormData) {
  const profileImageFiles = getProfileImageFiles(formData)
  const primaryProfileImageIndex = getPrimaryProfileImageIndex(formData, profileImageFiles.length)

  return {
    email: String(formData.get('email') ?? '').trim().toLowerCase(),
    password: String(formData.get('password') ?? ''),
    full_name: String(formData.get('full_name') ?? ''),
    stage_name: optionalString(formData.get('stage_name')),
    phone: optionalString(formData.get('phone')),
    bio: optionalString(formData.get('bio')),
    category: categories(formData),
    language: optionalString(formData.get('language')),
    gender: gender(formData.get('gender')),
    social_links: socialLinks(formData),
    profile_image_files: profileImageFiles.length > 0 ? profileImageFiles : undefined,
    primary_profile_image_index: primaryProfileImageIndex,
    hasExistingProfileImage: formData.get('existing_profile_image') === '1',
  }
}

export function toSignupErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('already') || message.includes('duplicate')) return 'email_exists'
  if (message.includes('mismatch')) return 'account_mismatch'
  if (message.includes('password')) return 'invalid_password'
  if (message.includes('email')) return 'invalid_email'
  if (message.includes('youtube')) return 'invalid_youtube'
  if (message.includes('required')) return 'missing'
  return 'failed'
}

export function isYouTubeUrl(value: string) {
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./, '')
    return host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com'
  } catch {
    return false
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

export function createTestImageFile(name: string, size = 128) {
  return new File([new Uint8Array(size)], name, { type: 'image/jpeg' })
}

export function createValidSignupFormData(overrides: Record<string, FormDataEntryValue> = {}) {
  const formData = new FormData()
  const defaults: Record<string, FormDataEntryValue> = {
    full_name: 'Ola Nordmann',
    stage_name: 'Ola Komiker',
    email: 'ola@example.com',
    password: 'password123',
    phone: '90000000',
    language: 'Norsk',
    gender: 'male',
    category: 'Stand-up',
    ...overrides,
  }

  for (const [key, value] of Object.entries(defaults)) {
    formData.set(key, value)
  }

  if (!formData.getAll('profile_image_files').length) {
    formData.append('profile_image_files', createTestImageFile('profile-a.jpg'))
  }

  return formData
}
