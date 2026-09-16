import { describe, expect, it } from 'vitest'
import {
  clubBrand,
  clubBrandStyle,
  contrastRatio,
  ensureContrast,
  hslToRgb,
  normalizeBrandColor,
  parseHexColor,
  readableInkOn,
  relativeLuminance,
  rgbToHsl,
  toHexColor,
} from '@/lib/club-brand'

describe('club brand color parsing', () => {
  it.each([
    ['#ff5b24', { r: 255, g: 91, b: 36 }],
    ['ff5b24', { r: 255, g: 91, b: 36 }],
    ['#abc', { r: 170, g: 187, b: 204 }],
    [' FFFFFF ', { r: 255, g: 255, b: 255 }],
  ] as const)('parses %s', (input, expected) => {
    expect(parseHexColor(input)).toEqual(expected)
  })

  it.each([null, undefined, '', '#12', '#abcd', '#gggggg', 'red'])('rejects invalid color %j', (input) => {
    expect(parseHexColor(input)).toBeNull()
  })

  it('clamps and rounds RGB channels when serializing', () => {
    expect(toHexColor({ r: -1, g: 127.6, b: 300 })).toBe('#0080ff')
  })
})

describe('club brand contrast', () => {
  it.each(['#ff0000', '#00ff00', '#0000ff', '#808080', '#ffffff', '#000000'])('round-trips %s through HSL', (hex) => {
    const rgb = parseHexColor(hex)!
    const roundTrip = hslToRgb(rgbToHsl(rgb))
    expect(toHexColor(roundTrip)).toBe(hex)
  })

  it('calculates the WCAG black/white contrast ratio', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 5)
  })

  it('orders white above black by luminance', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeGreaterThan(relativeLuminance({ r: 0, g: 0, b: 0 }))
  })

  it.each([
    [{ r: 10, g: 10, b: 10 }, '#fff4ec'],
    [{ r: 245, g: 245, b: 245 }, '#2e0c01'],
  ] as const)('chooses readable ink for %#', (fill, expected) => {
    expect(toHexColor(readableInkOn(fill))).toBe(expected)
  })

  it('raises a low-contrast accent to the requested contrast', () => {
    const against = { r: 255, g: 254, b: 251 }
    const adjusted = ensureContrast({ r: 250, g: 220, b: 200 }, against, 4.5)
    expect(contrastRatio(adjusted, against)).toBeGreaterThanOrEqual(4.5)
  })

  it('does not change a color that already meets the target', () => {
    const color = { r: 30, g: 20, b: 10 }
    expect(ensureContrast(color, { r: 255, g: 255, b: 255 })).toEqual(color)
  })

  it('constrains extremely pale and dark brand colors to usable lightness', () => {
    for (const color of [{ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }]) {
      const { l, s } = rgbToHsl(normalizeBrandColor(color))
      expect(l).toBeGreaterThanOrEqual(0.3)
      expect(l).toBeLessThanOrEqual(0.62)
      expect(s).toBeGreaterThanOrEqual(0.32)
    }
  })
})

describe('club brand tokens', () => {
  it('falls back to the global Tickethalo brand', () => {
    expect(clubBrand(null)).toEqual({
      fill: '#ff5b24', ink: '#fff4ec', accent: '#b23004',
      wash: 'rgba(255, 91, 36, 0.08)', washStrong: 'rgba(255, 91, 36, 0.16)',
    })
  })

  it('returns normalized hex and rgba values for a custom color', () => {
    const brand = clubBrand('#369')
    expect(brand.fill).toMatch(/^#[0-9a-f]{6}$/)
    expect(brand.wash).toMatch(/^rgba\(\d+, \d+, \d+, 0\.08\)$/)
  })

  it('maps every public surface token from the same brand result', () => {
    const brand = clubBrand('#369')
    expect(clubBrandStyle('#369')).toEqual({
      '--ev-accent-fill': brand.fill,
      '--ev-accent-ink': brand.ink,
      '--ev-accent': brand.accent,
      '--club-wash': brand.wash,
      '--club-wash-strong': brand.washStrong,
    })
  })
})
