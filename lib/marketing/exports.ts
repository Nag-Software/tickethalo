import sharp from 'sharp'
import type { MarketingExportSpec } from '@/lib/marketing/export-formats'
import type { MarketingPalette } from '@/types/database'

/**
 * Rendrer plakaten inn i ett format.
 *
 * Trykkfilene skrives som PNG uten komprimeringstap — et trykkeri skal ikke
 * få JPEG-artefakter i en flate. Skjermfilene skrives som JPEG, som er det
 * Facebook og Instagram uansett komprimerer dem til.
 */
export async function renderMarketingExport(
  posterBuffer: Buffer,
  spec: MarketingExportSpec,
  palette: MarketingPalette,
): Promise<{ buffer: Buffer; contentType: string; extension: string }> {
  const canvas = spec.fit === 'cover'
    ? await sharp(posterBuffer, { animated: false })
      .rotate()
      .resize({ width: spec.width, height: spec.height, fit: 'cover', position: 'attention' })
      .toBuffer()
    : await renderOnBlurredBackdrop(posterBuffer, spec, palette)

  const pipeline = sharp(canvas).withMetadata({ density: spec.density }).toColorspace('srgb')

  if (spec.isPrint) {
    return {
      buffer: await pipeline.png({ compressionLevel: 9 }).toBuffer(),
      contentType: 'image/png',
      extension: 'png',
    }
  }

  return {
    buffer: await pipeline.jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toBuffer(),
    contentType: 'image/jpeg',
    extension: 'jpg',
  }
}

/**
 * Hele plakaten, sentrert oppå en uskarp forstørrelse av seg selv.
 *
 * Alternativet — en flat bakgrunnsfarge — gir en synlig ramme rundt plakaten
 * i feeden. Den uskarpe versjonen leser som del av samme bilde, og fargene
 * stemmer alltid fordi de kommer fra plakaten selv. Palettens mørke farge
 * ligger under som et lag, slik at et transparent eller lyst plakathjørne
 * ikke gir en grå kant.
 */
async function renderOnBlurredBackdrop(
  posterBuffer: Buffer,
  spec: MarketingExportSpec,
  palette: MarketingPalette,
): Promise<Buffer> {
  const backdrop = await sharp(posterBuffer, { animated: false })
    .rotate()
    .resize({ width: spec.width, height: spec.height, fit: 'cover', position: 'centre' })
    .blur(Math.max(12, Math.round(Math.min(spec.width, spec.height) / 28)))
    .modulate({ brightness: 0.62, saturation: 1.05 })
    .toBuffer()

  // Litt luft rundt plakaten, ellers ser det ut som et uhell snarere enn et valg.
  const inset = spec.format === 'social_story' ? 0.9 : 0.86
  const foreground = await sharp(posterBuffer, { animated: false })
    .rotate()
    .resize({
      width: Math.round(spec.width * inset),
      height: Math.round(spec.height * inset),
      fit: 'inside',
      withoutEnlargement: false,
    })
    .toBuffer()

  const { width = spec.width, height = spec.height } = await sharp(foreground).metadata()

  return sharp({
    create: {
      width: spec.width,
      height: spec.height,
      channels: 3,
      background: palette.secondary,
    },
  })
    .composite([
      { input: backdrop, left: 0, top: 0 },
      {
        input: foreground,
        left: Math.round((spec.width - width) / 2),
        top: Math.round((spec.height - height) / 2),
      },
    ])
    .png()
    .toBuffer()
}
