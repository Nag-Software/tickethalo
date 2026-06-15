'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { validateFrameBackgroundImage } from '@/lib/poster-validation'

const CLUB_MEDIA_BUCKET = 'club-media'
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024
const MAX_GALLERY_IMAGES = 8

function getOptionalText(formData: FormData, key: string) {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function getRequiredText(formData: FormData, key: string, label: string) {
  const value = getOptionalText(formData, key)
  if (!value) {
    throw new Error(`${label} er påkrevd.`)
  }

  return value
}

function assertImageFile(file: File, label: string) {
  if (!file.type.startsWith('image/')) {
    throw new Error(`${label} må være et bilde.`)
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error(`${label} kan ikke være større enn 8 MB.`)
  }
}

function getSingleImage(formData: FormData, key: string, label: string) {
  const value = formData.get(key)

  if (!(value instanceof File) || value.size === 0) {
    return null
  }

  assertImageFile(value, label)
  return value
}

function getGalleryImages(formData: FormData) {
  const files = formData
    .getAll('galleryFiles')
    .filter((value): value is File => value instanceof File && value.size > 0)

  files.forEach((file) => assertImageFile(file, 'Galleribilde'))

  if (files.length > MAX_GALLERY_IMAGES) {
    throw new Error(`Du kan laste opp maks ${MAX_GALLERY_IMAGES} galleribilder om gangen.`)
  }

  return files
}

function getFileExtension(file: File) {
  const fromName = file.name.split('.').pop()?.trim().toLowerCase()
  if (fromName) return fromName

  const fromMime = file.type.split('/').pop()?.trim().toLowerCase()
  return fromMime || 'jpg'
}

async function uploadClubImage(clubId: string, folder: 'logo' | 'header' | 'gallery' | 'poster-ai-reference' | 'poster-frame-background', file: File) {
  const admin = createAdminClient()
  const extension = getFileExtension(file)
  const path = `${clubId}/${folder}/${Date.now()}-${crypto.randomUUID()}.${extension}`

  const { error } = await admin.storage
    .from(CLUB_MEDIA_BUCKET)
    .upload(path, file, {
      contentType: file.type,
      upsert: false,
    })

  if (error) {
    throw new Error(`Kunne ikke laste opp ${folder === 'gallery' ? 'galleribilde' : 'bilde'}.`)
  }

  const { data } = admin.storage.from(CLUB_MEDIA_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export async function saveClubProfileAction(formData: FormData) {
  const clubId = await getDefaultClubIdForAdmin()
  const admin = createAdminClient()

  const { data: currentClub, error: currentClubError } = await admin
    .from('clubs')
    .select('id, slug, logo_url, header_image_url, gallery_image_urls')
    .eq('id', clubId)
    .single()

  if (currentClubError || !currentClub) {
    throw new Error('Fant ikke valgt klubb.')
  }

  const name = getRequiredText(formData, 'name', 'Klubbnavn')
  const description = getOptionalText(formData, 'description')
  const city = getOptionalText(formData, 'city')
  const locationName = getOptionalText(formData, 'locationName')
  const addressLine = getOptionalText(formData, 'addressLine')

  const logoFile = getSingleImage(formData, 'logoFile', 'Logo')
  const headerFile = getSingleImage(formData, 'headerFile', 'Headerbilde')
  const galleryFiles = getGalleryImages(formData)

  const existingLogoUrl = getOptionalText(formData, 'existingLogoUrl')
  const existingHeaderImageUrl = getOptionalText(formData, 'existingHeaderImageUrl')
  const retainedGalleryUrls = formData
    .getAll('galleryExisting')
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .filter((value) => (currentClub.gallery_image_urls ?? []).includes(value))

  let logoUrl = currentClub.logo_url
  let headerImageUrl = currentClub.header_image_url

  if (!logoFile && existingLogoUrl !== currentClub.logo_url) {
    logoUrl = null
  }

  if (!headerFile && existingHeaderImageUrl !== currentClub.header_image_url) {
    headerImageUrl = null
  }

  if (logoFile) {
    logoUrl = await uploadClubImage(clubId, 'logo', logoFile)
  }

  if (headerFile) {
    headerImageUrl = await uploadClubImage(clubId, 'header', headerFile)
  }

  const uploadedGalleryUrls = await Promise.all(
    galleryFiles.slice(0, MAX_GALLERY_IMAGES).map((file) => uploadClubImage(clubId, 'gallery', file)),
  )

  const galleryImageUrls = [...retainedGalleryUrls, ...uploadedGalleryUrls].slice(0, MAX_GALLERY_IMAGES)

  const { error } = await admin
    .from('clubs')
    .update({
      name,
      description,
      city,
      location_name: locationName,
      address_line: addressLine,
      logo_url: logoUrl,
      header_image_url: headerImageUrl,
      gallery_image_urls: galleryImageUrls,
    })
    .eq('id', clubId)

  if (error) {
    throw new Error('Kunne ikke lagre klubbprofilen.')
  }

  revalidatePath('/admin-app')
  revalidatePath('/admin-app/min-klubb')
  revalidatePath('/')
  revalidatePath(`/${currentClub.slug}`)
}

export async function saveClubPosterDefaultsAction(formData: FormData) {
  const clubId = await getDefaultClubIdForAdmin()
  const admin = createAdminClient()

  const aiReferenceFile = getSingleImage(formData, 'ai_reference_file', 'AI-referanseplakat')
  const frameBackgroundFile = getSingleImage(formData, 'frame_background_file', 'Ramme-bakgrunn')

  if (!aiReferenceFile && !frameBackgroundFile) {
    throw new Error('Velg minst én fil å lagre.')
  }

  const update: {
    default_ai_poster_reference_url?: string
    default_frame_background_url?: string
  } = {}

  if (aiReferenceFile) {
    update.default_ai_poster_reference_url = await uploadClubImage(clubId, 'poster-ai-reference', aiReferenceFile)
  }

  if (frameBackgroundFile) {
    const validation = await validateFrameBackgroundImage(Buffer.from(await frameBackgroundFile.arrayBuffer()))
    if (!validation.ok) {
      throw new Error(validation.reason)
    }

    update.default_frame_background_url = await uploadClubImage(clubId, 'poster-frame-background', frameBackgroundFile)
  }

  const { error } = await admin.from('clubs').update(update).eq('id', clubId)
  if (error) {
    throw new Error('Kunne ikke lagre plakat-standarder.')
  }

  revalidatePath('/admin-app/min-klubb')
  revalidatePath('/admin-app/shows')
}