import { NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { strToU8, zipSync, type Zippable } from 'fflate'
import { assertShowAccess } from '@/lib/club-auth'
import { loadShowMaterial } from '@/lib/marketing/show-material'
import { showMaterialText } from '@/lib/marketing/copy'
import { materialFileName } from '@/lib/marketing/material-files'

export const runtime = 'nodejs'

/**
 * «Download all show material» — én zip med det klubben trenger for å lage
 * sin egen plakat eller post: QR-koden til showsiden, komikerbildene med
 * navnet som filnavn, plakaten om den er lastet opp, og teksten med biografiene.
 *
 * Bildene hentes fra lagringen her og legges rett i fila. Et bilde som ikke
 * lar seg hente, hoppes over — resten av materiellet er fortsatt nyttig.
 */

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

/**
 * Bare bilder fra vår egen lagring. Adressene står i basen, og serveren skal
 * ikke kunne lokkes til å hente noe annet på vegne av den som laster ned.
 */
function isStorageUrl(url: string) {
  try {
    const storage = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : null
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && storage !== null && parsed.hostname === storage
  } catch {
    return false
  }
}

async function fetchImage(url: string): Promise<{ bytes: Uint8Array; extension: string } | null> {
  if (!isStorageUrl(url)) return null
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) return null
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
    const fromPath = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[1]?.toLowerCase()
    const extension = IMAGE_EXTENSIONS[type] ?? (fromPath === 'jpeg' ? 'jpg' : fromPath)
    if (!extension) return null
    return { bytes: new Uint8Array(await response.arrayBuffer()), extension }
  } catch {
    return null
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await assertShowAccess(id)
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const material = await loadShowMaterial(id)
  if (!material) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const files: Zippable = {}

  // Stor nok til trykk på en A3-plakat. Bildefiler komprimeres ikke en gang
  // til (`level: 0`) — de er allerede komprimert.
  files['qr-code.png'] = [
    new Uint8Array(await QRCode.toBuffer(material.publicUrl, { type: 'png', width: 1024, margin: 2, errorCorrectionLevel: 'M' })),
    { level: 0 },
  ]

  const used = new Set<string>()
  const images = await Promise.all(material.comedians.map(async (comedian) => (
    comedian.imageUrl ? { comedian, image: await fetchImage(comedian.imageUrl) } : null
  )))
  for (const entry of images) {
    if (!entry?.image) continue
    const name = materialFileName(entry.comedian.name, entry.image.extension, used)
    files[`comedians/${name}`] = [entry.image.bytes, { level: 0 }]
  }

  if (material.show.posterUrl) {
    const poster = await fetchImage(material.show.posterUrl)
    if (poster) files[`poster.${poster.extension}`] = [poster.bytes, { level: 0 }]
  }

  files['show-text.txt'] = strToU8(showMaterialText({
    ...material.copy,
    bios: material.comedians.map((comedian) => ({ name: comedian.name, bio: comedian.bio })),
  }))

  const zip = zipSync(files, { level: 6 })
  const archiveName = materialFileName(`${material.show.title} ${material.show.date}`, 'zip', new Set())

  return new NextResponse(Buffer.from(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${archiveName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(archiveName)}`,
      'Cache-Control': 'private, no-store',
    },
  })
}
