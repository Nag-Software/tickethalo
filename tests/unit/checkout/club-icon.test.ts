// @vitest-environment node
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLUB_ICON_MAX_BYTES, buildClubIcon, clubIconFilename } from '@/lib/club-icon'

describe('clubIconFilename', () => {
  it('names the file after the club and a fingerprint of the logo address', () => {
    const name = clubIconFilename({ id: 'club_1', logo_url: 'https://cdn.example.com/club_1/logo/1-a.png' })

    expect(name).toMatch(/^tickethalo-club-club_1-[0-9a-f]{16}\.png$/)
    expect(clubIconFilename({ id: 'club_1', logo_url: 'https://cdn.example.com/club_1/logo/1-a.png' })).toBe(name)
    expect(clubIconFilename({ id: 'club_1', logo_url: 'https://cdn.example.com/club_1/logo/2-b.png' })).not.toBe(name)
  })
})

describe('buildClubIcon', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function serve(body: Buffer, status = 200) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(body), { status })),
    )
  }

  it('turns a wide logo into a square PNG with the logo kept whole', async () => {
    const wide = await sharp({ create: { width: 300, height: 100, channels: 4, background: '#ff5b24' } }).png().toBuffer()
    serve(wide)

    const icon = await buildClubIcon('https://cdn.example.com/logo.png')
    const meta = await sharp(icon).metadata()

    expect(meta.format).toBe('png')
    expect(meta.width).toBe(512)
    expect(meta.height).toBe(512)
    expect(icon.length).toBeLessThanOrEqual(CLUB_ICON_MAX_BYTES)

    // Padded, not stretched: the rows above the logo are transparent.
    const { data } = await sharp(icon).raw().toBuffer({ resolveWithObject: true })
    const topLeftAlpha = data[3]
    const centreAlpha = data[(256 * 512 + 256) * 4 + 3]
    expect(topLeftAlpha).toBe(0)
    expect(centreAlpha).toBe(255)
  })

  it('fails loudly when the logo cannot be fetched', async () => {
    serve(Buffer.alloc(0), 404)

    await expect(buildClubIcon('https://cdn.example.com/missing.png')).rejects.toThrow('404')
  })
})
