import type { Area } from 'react-easy-crop'

export const POSTER_CROP_ASPECT = 2 / 3
export const POSTER_OUTPUT_WIDTH = 1024
export const POSTER_OUTPUT_HEIGHT = 1536

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => reject(new Error('Kunne ikke laste bildet.')))
    image.crossOrigin = 'anonymous'
    image.src = src
  })
}

export async function cropImageToPosterBlob(imageSrc: string, crop: Area): Promise<Blob> {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  canvas.width = POSTER_OUTPUT_WIDTH
  canvas.height = POSTER_OUTPUT_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas er ikke tilgjengelig.')

  ctx.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    POSTER_OUTPUT_WIDTH,
    POSTER_OUTPUT_HEIGHT,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Kunne ikke lagre det beskårne bildet.'))),
      'image/jpeg',
      0.92,
    )
  })
}
