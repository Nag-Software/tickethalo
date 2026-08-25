import sharp from 'sharp'

/**
 * Bildets mål, til å regne ut format og til å vise proporsjonene i admin.
 *
 * Skilt fra `lib/marketing/storage.ts` fordi den fila også leses av
 * klientkomponentene, og sharp finnes bare på serveren.
 */
export async function readImageSize(file: File): Promise<{ width: number | null; height: number | null }> {
  try {
    const metadata = await sharp(Buffer.from(await file.arrayBuffer())).metadata()
    return { width: metadata.width ?? null, height: metadata.height ?? null }
  } catch {
    // Målene er pynt. HEIC uten støtte i sharp skal ikke stoppe opplastingen.
    return { width: null, height: null }
  }
}
