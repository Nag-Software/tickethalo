// @vitest-environment node

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { readImageSize } from '@/lib/marketing/image-meta'
import { renderMarketingExport } from '@/lib/marketing/exports'
import type { MarketingExportSpec } from '@/lib/marketing/export-formats'

const palette = { primary: '#ff5b24', secondary: '#22110a', accent: '#20b8a6' }

async function sourcePoster() {
  return sharp({ create: { width: 120, height: 180, channels: 3, background: '#ff5b24' } }).png().toBuffer()
}

function spec(overrides: Partial<MarketingExportSpec> = {}): MarketingExportSpec {
  return {
    format: 'social_post', label: 'Test', usage: 'Test', width: 80, height: 100,
    fit: 'cover', density: 72, isPrint: false, ...overrides,
  }
}

describe('poster image metadata', () => {
  it('reads raster image dimensions', async () => {
    const buffer = await sourcePoster()
    const file = new File([new Uint8Array(buffer)], 'poster.png', { type: 'image/png' })
    await expect(readImageSize(file)).resolves.toEqual({ width: 120, height: 180 })
  })

  it('returns nullable dimensions for corrupt image input', async () => {
    await expect(readImageSize(new File(['not-image'], 'broken.png', { type: 'image/png' }))).resolves.toEqual({
      width: null, height: null,
    })
  })
})

describe('poster rendering', () => {
  it('renders a cover export to exact dimensions', async () => {
    const result = await renderMarketingExport(await sourcePoster(), spec(), palette)
    const metadata = await sharp(result.buffer).metadata()
    expect(metadata).toMatchObject({ width: 80, height: 100, format: 'jpeg' })
    expect(result).toMatchObject({ contentType: 'image/jpeg', extension: 'jpg' })
  })

  it('renders a blurred wide export without cropping the foreground away', async () => {
    const result = await renderMarketingExport(
      await sourcePoster(),
      spec({ format: 'facebook_event', width: 160, height: 84, fit: 'blur' }),
      palette,
    )
    const metadata = await sharp(result.buffer).metadata()
    expect(metadata).toMatchObject({ width: 160, height: 84, format: 'jpeg' })
  })

  it('renders story blur exports to their requested portrait dimensions', async () => {
    const result = await renderMarketingExport(
      await sourcePoster(),
      spec({ format: 'social_story', width: 90, height: 160, fit: 'blur' }),
      palette,
    )
    expect(await sharp(result.buffer).metadata()).toMatchObject({ width: 90, height: 160 })
  })

  it('uses lossless PNG for print output', async () => {
    const result = await renderMarketingExport(
      await sourcePoster(),
      spec({ format: 'print_a4', isPrint: true, density: 300 }),
      palette,
    )
    expect(await sharp(result.buffer).metadata()).toMatchObject({ width: 80, height: 100, format: 'png' })
    expect(result).toMatchObject({ contentType: 'image/png', extension: 'png' })
  })

  it('writes the configured output density', async () => {
    const result = await renderMarketingExport(await sourcePoster(), spec({ isPrint: true, density: 300 }), palette)
    const metadata = await sharp(result.buffer).metadata()
    expect(metadata.density).toBeGreaterThanOrEqual(299)
  })
})
