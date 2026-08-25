import type { MarketingDesignFileType } from '@/types/database'

/**
 * Filhåndteringen bak markedsføringsfanen.
 *
 * Fila leses også av klientkomponentene (de trenger `accept`-lista på
 * filvelgeren), så den skal ikke importere Node-moduler. Alt som krever sharp
 * ligger i `lib/marketing/image-meta.ts`.
 *
 * Alt klubben laster opp — maler, ferdige plakater og bilder til enkeltruter —
 * ligger i samme bøtte, adskilt på mappenavn. Eksportene har sin egen bøtte
 * fordi de er avledet: de kan slettes og lages på nytt uten at klubben mister
 * noe den selv har laget.
 */

export const MARKETING_DESIGN_BUCKET = 'show-marketing-designs'
export const MARKETING_EXPORT_BUCKET = 'show-marketing-exports'

export const MAX_MARKETING_DESIGN_BYTES = 50 * 1024 * 1024

const MARKETING_DESIGN_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'heic', 'heif'])
const MARKETING_DESIGN_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
])

export const MARKETING_DESIGN_ACCEPT = [...MARKETING_DESIGN_IMAGE_MIME_TYPES].join(',')

export function sanitizeStorageFileName(value: string) {
  const fallback = 'design-file'
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return normalized || fallback
}

function fileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

export function marketingDesignFileType(file: File): MarketingDesignFileType | null {
  const extension = fileExtension(file.name)
  const mimeType = file.type.toLowerCase()

  if (MARKETING_DESIGN_IMAGE_EXTENSIONS.has(extension) || MARKETING_DESIGN_IMAGE_MIME_TYPES.has(mimeType)) {
    return 'image'
  }

  return null
}

export function marketingDesignMimeType(file: File) {
  if (file.type) return file.type
  return 'application/octet-stream'
}

/**
 * Kaster med en melding klubben kan handle på, i stedet for å la Supabase
 * svare med en generisk feil et sted lenger nede.
 */
export function assertUploadableImage(file: unknown): asserts file is File {
  if (!(file instanceof File) || file.size === 0) {
    throw new Error('Pick an image file first.')
  }
  if (file.size > MAX_MARKETING_DESIGN_BYTES) {
    throw new Error('The file can be at most 50 MB.')
  }
  if (!marketingDesignFileType(file)) {
    throw new Error('The file must be PNG, JPG, WebP, GIF, AVIF or HEIC/HEIF.')
  }
}
