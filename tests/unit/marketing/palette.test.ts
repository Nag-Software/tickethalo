import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MARKETING_SEED,
  inkOn,
  isHexColor,
  normalizeHex,
  paletteFromColors,
  paletteFromSeed,
  palettePromptLine,
  resolvePalette,
  tint,
} from '@/lib/marketing/palette'

describe('marketing palette', () => {
  it.each(['#fff', '#FF5B24', '336699'])('accepts hex color %s', (color) => {
    expect(isHexColor(color)).toBe(true)
  })

  it.each([null, 123, '', '#12', 'orange'])('rejects non-hex color %j', (color) => {
    expect(isHexColor(color)).toBe(false)
  })

  it('normalizes short and uppercase values', () => {
    expect(normalizeHex('#ABC', '#000000')).toBe('#aabbcc')
  })

  it('uses the requested fallback for invalid values', () => {
    expect(normalizeHex('nope', '#123456')).toBe('#123456')
  })

  it('uses the default marketing seed when no seed exists', () => {
    expect(paletteFromSeed(null)).toEqual(paletteFromSeed(DEFAULT_MARKETING_SEED))
  })

  it.each(['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000'])('creates a complete normalized palette from %s', (seed) => {
    const palette = paletteFromSeed(seed)
    expect(Object.values(palette).every((color) => /^#[0-9a-f]{6}$/.test(color))).toBe(true)
  })

  it('derives a palette when extracted colors are empty', () => {
    expect(paletteFromColors([])).toEqual(paletteFromSeed(DEFAULT_MARKETING_SEED))
  })

  it('uses extracted colors without mutating the input', () => {
    const colors = ['#cc3300', '#111111', '#00aaff']
    const copy = [...colors]
    expect(paletteFromColors(colors).primary).toMatch(/^#[0-9a-f]{6}$/)
    expect(colors).toEqual(copy)
  })

  it('fills invalid stored fields from the club seed', () => {
    const fallback = paletteFromSeed('#663399')
    expect(resolvePalette({ primary: '#abcdef', secondary: 'nope' }, '#663399')).toEqual({
      primary: '#abcdef', secondary: fallback.secondary, accent: fallback.accent,
    })
  })

  it.each([null, undefined, 'bad', 12])('resolves invalid stored palette %j', (stored) => {
    expect(resolvePalette(stored, '#663399')).toEqual(paletteFromSeed('#663399'))
  })

  it('returns readable ink for valid and invalid colors', () => {
    expect(inkOn('#ffffff')).toBe('#2e0c01')
    expect(inkOn('nope')).toBe('#ffffff')
  })

  it('creates an rgba tint and rejects invalid input', () => {
    expect(tint('#336699', 0.25)).toBe('rgba(51, 102, 153, 0.25)')
    expect(tint('nope', 0.25)).toBe('transparent')
  })

  it('writes all roles into an AI-readable prompt line', () => {
    const line = palettePromptLine({ primary: '#111111', secondary: '#222222', accent: '#333333' })
    expect(line).toContain('Primary surface colour #111111')
    expect(line).toContain('secondary/dark colour #222222')
    expect(line).toContain('accent colour #333333')
  })
})
