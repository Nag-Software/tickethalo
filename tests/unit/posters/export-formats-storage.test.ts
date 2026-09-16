import { describe, expect, it } from 'vitest'
import {
  exportSpec,
  isMarketingExportFormat,
  MARKETING_EXPORT_SPECS,
} from '@/lib/marketing/export-formats'
import {
  assertUploadableImage,
  MARKETING_DESIGN_ACCEPT,
  MAX_MARKETING_DESIGN_BYTES,
  marketingDesignFileType,
  marketingDesignMimeType,
  sanitizeStorageFileName,
} from '@/lib/marketing/storage'

describe('poster export format contracts', () => {
  it('defines every format exactly once', () => {
    expect(new Set(MARKETING_EXPORT_SPECS.map((spec) => spec.format)).size).toBe(MARKETING_EXPORT_SPECS.length)
  })

  it.each([
    ['facebook_event', 1920, 1005, 72, 'blur', false],
    ['social_post', 1080, 1350, 72, 'cover', false],
    ['social_story', 1080, 1920, 72, 'blur', false],
    ['print_a4', 2480, 3508, 300, 'cover', true],
    ['print_a3', 3508, 4961, 300, 'cover', true],
  ] as const)('defines %s correctly', (format, width, height, density, fit, isPrint) => {
    expect(exportSpec(format)).toMatchObject({ format, width, height, density, fit, isPrint })
    expect(isMarketingExportFormat(format)).toBe(true)
  })

  it.each([null, undefined, 1, '', 'instagram', 'PRINT_A4'])('rejects unknown format %j', (format) => {
    expect(isMarketingExportFormat(format)).toBe(false)
    expect(exportSpec(String(format ?? ''))).toBeNull()
  })

  it('uses 300 DPI only for print formats', () => {
    expect(MARKETING_EXPORT_SPECS.every((spec) => spec.isPrint === (spec.density === 300))).toBe(true)
  })

  it('has positive dimensions and useful labels', () => {
    for (const spec of MARKETING_EXPORT_SPECS) {
      expect(spec.width).toBeGreaterThan(0)
      expect(spec.height).toBeGreaterThan(0)
      expect(spec.label).toBeTruthy()
      expect(spec.usage).toContain(`${spec.width}×${spec.height}`)
    }
  })
})

describe('poster upload validation', () => {
  it.each([
    ['My Poster FINAL!!.PNG', 'my-poster-final-.png'],
    ['../../secret.jpg', '..-..-secret.jpg'],
    [' ÆØÅ ', 'design-file'],
    ['', 'design-file'],
    ['already-safe.webp', 'already-safe.webp'],
  ])('sanitizes %j to %s', (input, expected) => {
    expect(sanitizeStorageFileName(input)).toBe(expected)
  })

  it.each([
    ['poster.png', 'image/png'], ['poster.JPG', ''], ['poster.unknown', 'image/webp'],
    ['poster.heic', 'application/octet-stream'],
  ])('accepts image %s with MIME %s', (name, type) => {
    expect(marketingDesignFileType(new File(['image'], name, { type }))).toBe('image')
  })

  it('rejects a non-image file', () => {
    expect(marketingDesignFileType(new File(['text'], 'notes.txt', { type: 'text/plain' }))).toBeNull()
  })

  it('uses the browser MIME type or a binary fallback', () => {
    expect(marketingDesignMimeType(new File(['x'], 'x.png', { type: 'image/png' }))).toBe('image/png')
    expect(marketingDesignMimeType(new File(['x'], 'x.png'))).toBe('application/octet-stream')
  })

  it('publishes every supported MIME type in the file-input accept list', () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/heic', 'image/heif']) {
      expect(MARKETING_DESIGN_ACCEPT).toContain(mime)
    }
  })

  it('accepts a non-empty supported image below the size limit', () => {
    expect(() => assertUploadableImage(new File(['image'], 'poster.png', { type: 'image/png' }))).not.toThrow()
  })

  it.each([
    [null, 'Pick an image file first.'],
    [new File([], 'empty.png', { type: 'image/png' }), 'Pick an image file first.'],
    [new File(['text'], 'notes.txt', { type: 'text/plain' }), 'The file must be PNG'],
  ])('rejects invalid upload %#', (file, message) => {
    expect(() => assertUploadableImage(file)).toThrow(message)
  })

  it('rejects images above 50 MB', () => {
    const file = new File([new Uint8Array(MAX_MARKETING_DESIGN_BYTES + 1)], 'huge.png', { type: 'image/png' })
    expect(() => assertUploadableImage(file)).toThrow('The file can be at most 50 MB.')
  })
})
