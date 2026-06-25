import type { createAdminClient } from '@/lib/supabase/admin'

export const MAX_ARTIST_PROFILE_IMAGES = 6
export const MAX_ARTIST_PROFILE_IMAGE_BYTES = 20 * 1024 * 1024
const PROFILE_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

type AdminClient = ReturnType<typeof createAdminClient>

// Derive the stored extension from the validated MIME type, never from the
// user-supplied file name. The filename is fully attacker-controlled on the public
// signup endpoint; interpolating it raw (e.g. "a.png/evil") would corrupt the
// deterministic profile.<ext> storage-key scheme.
function extensionForMimeType(mimeType: string) {
  return mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
}

function assertValidProfileImage(file: File) {
  if (!PROFILE_IMAGE_MIME_TYPES.has(file.type)) {
    throw new Error('Profilbilder må være PNG, JPG eller WEBP.')
  }
  if (file.size > MAX_ARTIST_PROFILE_IMAGE_BYTES) {
    throw new Error('Profilbilder kan ikke være større enn 20 MB.')
  }
}

function profileStoragePath(authUserId: string, index: number, ext: string) {
  return index === 0 ? `${authUserId}/profile.${ext}` : `${authUserId}/profile-${index + 1}.${ext}`
}

function sortProfileStorageFiles(files: Array<{ name: string }>) {
  return files
    .filter((file) => /^profile(-\d+)?\./.test(file.name))
    .sort((left, right) => {
      const leftMatch = left.name.match(/^profile(?:-(\d+))?\.(.+)$/)
      const rightMatch = right.name.match(/^profile(?:-(\d+))?\.(.+)$/)
      const leftIndex = leftMatch?.[1] ? Number(leftMatch[1]) : 1
      const rightIndex = rightMatch?.[1] ? Number(rightMatch[1]) : 1
      return leftIndex - rightIndex
    })
}

export function getProfileImageFiles(formData: FormData) {
  return formData
    .getAll('profile_image_files')
    .filter((value): value is File => value instanceof File && value.size > 0)
    .slice(0, MAX_ARTIST_PROFILE_IMAGES)
}

export function getPrimaryProfileImageIndex(formData: FormData, fileCount: number) {
  if (fileCount === 0) return 0
  const raw = Number(formData.get('primary_profile_image_index') ?? 0)
  if (!Number.isFinite(raw)) return 0
  return Math.min(Math.max(0, Math.floor(raw)), fileCount - 1)
}

export function resolveProfileImageInput(input: {
  profile_image_files?: File[]
  primary_profile_image_index?: number
}) {
  return {
    files: input.profile_image_files ?? [],
    primaryIndex: input.primary_profile_image_index ?? 0,
  }
}

export async function uploadArtistProfileImages(
  admin: AdminClient,
  authUserId: string,
  files: File[],
  primaryIndex: number,
) {
  if (files.length === 0) {
    throw new Error('Required fields missing')
  }

  if (files.length > MAX_ARTIST_PROFILE_IMAGES) {
    throw new Error(`You can upload at most ${MAX_ARTIST_PROFILE_IMAGES} profile images`)
  }

  // Validate every file before uploading any, so an invalid file never leaves a
  // partially-uploaded set behind.
  files.forEach(assertValidProfileImage)

  const primary = Math.min(Math.max(0, primaryIndex), files.length - 1)
  const orderedFiles = [
    files[primary],
    ...files.filter((_, index) => index !== primary),
  ]

  const urls: string[] = []

  for (const [index, file] of orderedFiles.entries()) {
    const ext = extensionForMimeType(file.type)
    const path = profileStoragePath(authUserId, index, ext)
    const { error } = await admin.storage.from('artist-images').upload(path, file, { upsert: true })
    if (error) {
      throw new Error('Profile image upload failed')
    }

    const { data: urlData } = admin.storage.from('artist-images').getPublicUrl(path)
    urls.push(urlData.publicUrl)
  }

  return {
    profile_image_url: urls[0],
    profile_image_urls: urls.slice(1),
  }
}

export async function resolveExistingProfileImages(admin: AdminClient, authUserId: string) {
  const { data: storedFiles } = await admin.storage.from('artist-images').list(authUserId, { limit: MAX_ARTIST_PROFILE_IMAGES })
  const profileFiles = sortProfileStorageFiles(storedFiles ?? [])
  if (profileFiles.length === 0) return null

  const urls = profileFiles.map((file) => {
    const { data: urlData } = admin.storage.from('artist-images').getPublicUrl(`${authUserId}/${file.name}`)
    return urlData.publicUrl
  })

  return {
    profile_image_url: urls[0],
    profile_image_urls: urls.slice(1),
  }
}
