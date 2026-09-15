/**
 * Mobilbilder er 5–12 MB rett fra kameraet, og en serverless-funksjon tar
 * imot maks ~4,5 MB body. Derfor krymper vi bildet i nettleseren før det
 * legges i skjemaet — ellers svarer plattformen 413 før koden vår kjører.
 */

/**
 * Serverless-funksjonene tar imot ~4,5 MB body. Vi stopper godt under, så det
 * er plass til tekstfeltene i samme skjema.
 */
export const MAX_UPLOAD_BYTES = 4_000_000

/** Lengste side etter skalering. Profilbilder vises aldri større enn dette. */
const MAX_DIMENSION = 1600
/** Vi prøver lavere kvalitet helt til fila er under dette. */
const TARGET_BYTES = 1_200_000
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.45]

export async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  try {
    const source = await loadImage(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(source.width, source.height))

    // Alt som allerede er lite nok slipper en runde med reenkoding.
    if (scale === 1 && file.size <= TARGET_BYTES) return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(source.width * scale)
    canvas.height = Math.round(source.height * scale)
    const context = canvas.getContext('2d')
    if (!context) return file
    // JPEG har ingen alfakanal — uten hvit bunn blir gjennomsiktige PNG-er svarte.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    if ('close' in source) source.close()

    let best: Blob | null = null
    for (const quality of QUALITY_STEPS) {
      const blob = await toBlob(canvas, quality)
      if (!blob) break
      best = blob
      if (blob.size <= TARGET_BYTES) break
    }

    if (!best || best.size >= file.size) return file

    return new File([best], jpegName(file.name), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  } catch {
    // Klarer vi ikke krympe, sender vi originalen og lar størrelsessjekken ta den.
    return file
  }
}

type DrawableImage = (ImageBitmap | HTMLImageElement) & { width: number; height: number }

async function loadImage(file: File): Promise<DrawableImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      // `from-image` holder på EXIF-rotasjonen, ellers legger telefonbilder seg på siden.
      return (await createImageBitmap(file, { imageOrientation: 'from-image' })) as DrawableImage
    } catch {
      // Eldre Safari kjenner ikke opsjonen — fall videre til <img>.
    }
  }

  const url = URL.createObjectURL(file)
  try {
    return await new Promise<DrawableImage>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image as DrawableImage)
      image.onerror = () => reject(new Error('Could not decode image'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

function jpegName(name: string) {
  const base = name.replace(/\.[^.]+$/, '') || 'profile'
  return `${base}.jpg`
}
