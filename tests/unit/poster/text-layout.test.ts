// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { builtInTitle, layoutCapacity, layoutClearZones, normalizePosterLayout, sameTitle } from '@/lib/poster/layout'
import { backgroundPrompt } from '@/lib/poster/background'
import { PosterTextOverflowError, fitText, loadPosterFonts } from '@/lib/poster/text'

const box = { left: 100, top: 100, width: 600, height: 120 }

async function fit(text: string, overrides: Partial<Parameters<typeof fitText>[0]> = {}) {
  return fitText({
    text,
    font: 'anton',
    fonts: await loadPosterFonts(null),
    box,
    color: '#ffffff',
    align: 'center',
    vAlign: 'middle',
    maxLines: 2,
    letterSpacing: 0.02,
    minFontSize: 14,
    what: 'test field',
    ...overrides,
  })
}

/** Ytterpunktene til alle koordinatene i banen. */
function bounds(svg: string) {
  const numbers = [...svg.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
  const xs = numbers.filter((_, index) => index % 2 === 0)
  return { minX: Math.min(...xs), maxX: Math.max(...xs) }
}

describe('fitText', () => {
  it('sets Norwegian letters as real glyphs, not missing-glyph boxes', async () => {
    const fonts = await loadPosterFonts(null)
    for (const id of ['geist', 'anton', 'archivo-black', 'bebas-neue', 'dm-serif-display', 'fredoka', 'oswald'] as const) {
      for (const char of 'æøåÆØÅ') expect(fonts.get(id).charToGlyphIndex(char), `${id} ${char}`).not.toBe(0)
    }
    expect((await fit('LØRDAG 17. OKT., KL. 20:15'))?.svg).toContain('<path')
  })

  it('falls back to a full-coverage font for letters the display font lacks', async () => {
    const fonts = await loadPosterFonts(null)
    expect(fonts.get('anton').charToGlyphIndex('ő')).toBe(0)
    expect(fonts.fallback.charToGlyphIndex('ő')).not.toBe(0)
    await expect(fit('Zoltán Illő')).resolves.toBeTruthy()
  })

  it('keeps the text inside its box', async () => {
    const fitted = await fit('Backstage Stand Up med veldig mange ekstra ord i tittelen')
    const { minX, maxX } = bounds(fitted!.svg)
    expect(minX).toBeGreaterThanOrEqual(box.left)
    expect(maxX).toBeLessThanOrEqual(box.left + box.width)
  })

  it('breaks a hyphenated surname across lines when that lets the name be larger', async () => {
    const narrow = { left: 0, top: 0, width: 150, height: 60 }
    const fitted = await fit('ÅSE ØDEGÅRD-SÆTHER', { box: narrow, minFontSize: 10 })
    expect(fitted!.lines).toEqual(['ÅSE ØDEGÅRD-', 'SÆTHER'])
  })

  it('throws instead of setting unreadable text', async () => {
    await expect(fit('A very long venue name that cannot possibly fit', { box: { left: 0, top: 0, width: 60, height: 14 }, maxLines: 1 }))
      .rejects.toThrow(PosterTextOverflowError)
  })

  it('returns nothing for empty text', async () => {
    await expect(fit('   ')).resolves.toBeNull()
  })
})

describe('poster layout', () => {
  it('clamps whatever a model or a client sends into a valid layout', () => {
    const layout = normalizePosterLayout({
      canvas: { width: 99999, height: -4 },
      frames: [{ box: { x: 2, y: -1, width: 9, height: 'nope' }, shape: 'hexagon' }],
      lineupArea: { box: { x: 0.1, y: 0.5, width: 0.8, height: 0.3 }, maxFrames: 400 },
      textFields: [{ role: 'headliner', font: 'comic-sans', color: 'red', maxLines: 99, box: {} }],
      grain: 12,
    })

    expect(layout.canvas).toEqual({ width: 4096, height: 512 })
    expect(layout.frames[0].shape).toBe('rect')
    expect(layout.frames[0].box.x + layout.frames[0].box.width).toBeLessThanOrEqual(1)
    expect(layout.lineupArea!.maxFrames).toBe(12)
    // «headliner» finnes ikke som tekstrolle: navn kommer bare fra ruten artisten står i.
    expect(layout.textFields[0]).toMatchObject({ role: 'custom', font: 'geist', color: '#ffffff', maxLines: 4 })
    expect(layout.grain).toBe(1)
  })

  it('refuses the custom font when no font file is attached', () => {
    const layout = normalizePosterLayout({ textFields: [{ role: 'title', font: 'custom', box: {} }] })
    expect(layout.textFields[0].font).toBe('geist')
  })

  it('allows only one lineup field, so no name is printed twice', () => {
    const field = { role: 'lineup', box: { x: 0.1, y: 0.8, width: 0.8, height: 0.05 } }
    expect(normalizePosterLayout({ textFields: [field, field, field] }).textFields).toHaveLength(1)
  })

  it('compares titles the way a person would', () => {
    expect(sameTitle('Backstage Stand Up', 'BACKSTAGE STAND-UP!')).toBe(true)
    expect(sameTitle('Backstage Stand Up', 'Backstage Open Mic')).toBe(false)
  })

  it('only reports a built-in title while no title field replaces it', () => {
    expect(builtInTitle(normalizePosterLayout({ fixedTitle: 'Backstage Stand Up' }))).toBe('Backstage Stand Up')
    expect(builtInTitle(normalizePosterLayout({
      fixedTitle: 'Backstage Stand Up',
      textFields: [{ role: 'title', box: { x: 0, y: 0.4, width: 1, height: 0.1 } }],
    }))).toBeNull()
  })

  it('counts fixed frames and the lineup area towards capacity', () => {
    const layout = normalizePosterLayout({
      frames: [{ box: { x: 0, y: 0, width: 0.4, height: 0.4 } }],
      lineupArea: { box: { x: 0, y: 0.5, width: 1, height: 0.3 }, maxFrames: 6 },
    })
    expect(layoutCapacity(layout)).toBe(7)
  })

  it('clears photo slots, name fields, the lineup area and every text field — nothing else', () => {
    const layout = normalizePosterLayout({
      frames: [{
        box: { x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
        nameField: { box: { x: 0.5, y: 0.2, width: 0.4, height: 0.1 } },
      }],
      lineupArea: { box: { x: 0.1, y: 0.6, width: 0.8, height: 0.2 } },
      textFields: [{ role: 'date', box: { x: 0.1, y: 0.85, width: 0.8, height: 0.05 } }],
      clearZones: [{ x: 0.1, y: 0.92, width: 0.8, height: 0.03 }],
    })
    expect(layoutClearZones(layout)).toHaveLength(5)
  })
})

describe('background prompt', () => {
  it('never carries names, faces or show text to the image model', () => {
    const prompt = backgroundPrompt({ primary: '#f2b33d', secondary: '#3b3a1e', accent: '#2f6fb0' }, 3)
    expect(prompt).toContain('#f2b33d')
    expect(prompt).toMatch(/no people/i)
    expect(prompt).toMatch(/no text/i)
  })
})
