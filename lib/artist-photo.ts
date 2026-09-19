/**
 * Nedlasting av komikerens profilbilde fra klubbens admin.
 *
 * Bildet ligger på et annet domene (Supabase Storage), og da overser
 * nettleseren `download`-attributtet: filen hadde fått lagringsnavnet sitt, en
 * uuid. Ruten `/admin-app/artists/[id]/photo` henter derfor bildet på serveren
 * og sender det videre med komikerens navn som filnavn.
 */

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

const KNOWN_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'])

/**
 * Vertene serveren får hente bilder fra — de samme som `next.config.ts`
 * slipper gjennom. URL-en står i en rad komikeren selv har fylt ut, og en
 * server som henter hva som helst derfra kan pekes mot interne adresser.
 */
export function isAllowedPhotoUrl(url: string, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol !== 'https:') return false
    const supabaseHost = supabaseUrl ? new URL(supabaseUrl).hostname : null
    return hostname === supabaseHost || hostname === 'upload.wikimedia.org'
  } catch {
    return false
  }
}

/** Filendelsen: innholdstypen først, så URL-en, ellers `jpg`. */
export function photoExtension(contentType: string | null, url: string) {
  const fromType = EXTENSION_BY_TYPE[(contentType ?? '').split(';')[0].trim().toLowerCase()]
  if (fromType) return fromType

  try {
    const fromUrl = new URL(url).pathname.split('.').pop()?.toLowerCase() ?? ''
    if (KNOWN_EXTENSIONS.has(fromUrl)) return fromUrl === 'jpeg' ? 'jpg' : fromUrl
  } catch {
    // Faller til standarden under.
  }
  return 'jpg'
}

/**
 * «Ida Example.jpg». Navnet beholdes som det står på profilen — også æ, ø og
 * å — og bare tegn et filsystem ikke tåler tas bort.
 */
export function artistPhotoFileName(name: string, extension: string) {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')

  return `${cleaned || 'comedian'}.${extension}`
}

/**
 * `Content-Disposition` med begge former: `filename*` bærer navnet som det er,
 * `filename` er ASCII-reserven for klienter som ikke leser RFC 5987.
 */
export function attachmentDisposition(fileName: string) {
  const ascii = fileName.normalize('NFKD').replace(/[^\x20-\x7e]+/g, '').replace(/["\\]/g, '') || 'photo'
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}
