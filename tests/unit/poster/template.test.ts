// @vitest-environment node

import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { layoutFromAnalysis } from '@/lib/poster/analyze'
import { layoutCapacity, normalizePosterLayout } from '@/lib/poster/layout'
import { buildPlate, quickPlate, templateCanvas } from '@/lib/poster/plate'

const CANVAS = { width: 600, height: 900 }

/** En «mal» med et tydelig mønster, så enhver endring utenfor feltene synes. */
async function patterned() {
  const stripes = Array.from({ length: 45 }, (_, i) => (
    `<rect y="${i * 20}" width="600" height="20" fill="${i % 2 ? '#c0392b' : '#f1c40f'}"/>`
  )).join('')
  return sharp(Buffer.from(`<svg width="600" height="900" xmlns="http://www.w3.org/2000/svg">${stripes}</svg>`)).png().toBuffer()
}

async function pixels(image: Buffer, region: { left: number; top: number; width: number; height: number }) {
  return sharp(image).extract(region).removeAlpha().raw().toBuffer()
}

function openaiReturning(image: Buffer, verdict = { has_people: false, has_event_text: false }) {
  return {
    images: { edit: vi.fn(async () => ({ data: [{ b64_json: image.toString('base64') }] })) },
    responses: { create: vi.fn(async () => ({ output_text: JSON.stringify(verdict) })) },
  }
}

const layout = normalizePosterLayout({
  canvas: CANVAS,
  frames: [{ id: 'hero', box: { x: 0.25, y: 0.25, width: 0.5, height: 0.25 }, shape: 'rect' }],
  frameStyle: { label: null },
})

describe('buildPlate', () => {
  // Merkevaregarantien: modellen kan tegne hva den vil, men bare feltene og
  // en smal marg rundt dem får lov til å endre seg.
  it('leaves every pixel away from the detected fields identical to the original', async () => {
    const original = await patterned()
    const allBlack = await sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#000000' } }).png().toBuffer()
    const openai = openaiReturning(allBlack)

    const plate = await buildPlate(openai as never, original, layout)
    expect(plate.method).toBe('ai')

    const outside = [
      { left: 0, top: 0, width: 600, height: 150 },
      { left: 0, top: 530, width: 600, height: 370 },
      { left: 0, top: 150, width: 75, height: 380 },
      { left: 525, top: 150, width: 75, height: 380 },
    ]
    for (const region of outside) {
      expect((await pixels(plate.buffer, region)).equals(await pixels(original, region))).toBe(true)
    }

    // …og feltet selv er faktisk byttet ut.
    const inside = await pixels(plate.buffer, { left: 280, top: 320, width: 40, height: 40 })
    expect(Math.max(...inside)).toBeLessThan(10)

    // Et hode som stikker opp over et upresist felt blir også med: endringer
    // like utenfor feltet erstattes, selv om feltet ikke dekket dem.
    const justAbove = await pixels(plate.buffer, { left: 280, top: 195, width: 40, height: 10 })
    expect(Math.max(...justAbove)).toBeLessThan(10)
  })

  it('keeps the original just outside a field when the model changed nothing there', async () => {
    const original = await patterned()
    const padded = await sharp(original).resize({ width: 1024, height: 1536, fit: 'fill' }).png().toBuffer()
    const plate = await buildPlate(openaiReturning(padded) as never, original, layout)
    // Midt i en stripe, like til venstre for feltet: innenfor margen, men uendret.
    const beside = { left: 100, top: 225, width: 30, height: 10 }
    expect((await pixels(plate.buffer, beside)).equals(await pixels(original, beside))).toBe(true)
  })

  it('falls back to flat fill when the model leaves people or text in the fields', async () => {
    const original = await patterned()
    const openai = openaiReturning(await patterned(), { has_people: true, has_event_text: false })

    const plate = await buildPlate(openai as never, original, layout)
    expect(plate.method).toBe('fill')
    expect(openai.images.edit).toHaveBeenCalledTimes(2)
    const untouched = { left: 0, top: 470, width: 600, height: 430 }
    expect((await pixels(plate.buffer, untouched)).equals(await pixels(original, untouched))).toBe(true)
  })

  it('does not call the model for a design that is already blank', async () => {
    const original = await patterned()
    const openai = openaiReturning(original)

    const plate = await buildPlate(openai as never, original, { ...layout, blankTemplate: true })
    expect(plate.method).toBe('original')
    expect(openai.images.edit).not.toHaveBeenCalled()
    const whole = { left: 0, top: 0, width: 600, height: 900 }
    expect((await pixels(plate.buffer, whole)).equals(await pixels(original, whole))).toBe(true)
  })

  it('previews without any model call', async () => {
    const original = await patterned()
    const preview = await quickPlate(original, layout)
    const untouched = { left: 0, top: 0, width: 600, height: 210 }
    expect((await pixels(preview, untouched)).equals(await pixels(original, untouched))).toBe(true)
  })

  it('keeps the template\'s own aspect ratio and caps the size', async () => {
    const a3 = await sharp({ create: { width: 3508, height: 4961, channels: 3, background: '#fff' } }).png().toBuffer()
    const canvas = await templateCanvas(a3)
    expect(canvas.height).toBe(2048)
    expect(canvas.width / canvas.height).toBeCloseTo(3508 / 4961, 2)
  })
})

describe('layoutFromAnalysis', () => {
  const frame = (x: number, y: number, width: number, height: number) => ({
    box: { x, y, width, height },
    shape: 'rect' as const,
    name_box: { x, y: y + height, width, height: 0.035 },
    name_color: '#ffffff',
    name_background: '#4a4a2a',
  })

  // Plakaten som startet dette: én stor hovedrute og en jevn rad under.
  const analysis = {
    photo_frames: [frame(0.08, 0.04, 0.5, 0.26), frame(0.05, 0.48, 0.28, 0.29), frame(0.34, 0.48, 0.32, 0.29), frame(0.67, 0.48, 0.28, 0.29)],
    supporting_frames_are_uniform_row: true,
    frame_fill_colors: ['#e8927c', '#f6d98a'],
    text_fields: [
      { role: 'title' as const, box: { x: 0, y: 0.3, width: 1, height: 0.15 }, color: '#ffffff', background: '#4a4a2a', align: 'center' as const, uppercase: false, lines: 2 },
      { role: 'datetime' as const, box: { x: 0.05, y: 0.89, width: 0.9, height: 0.04 }, color: '#f2c14e', background: '#2f6fb0', align: 'center' as const, uppercase: true, lines: 1 },
      { role: 'other' as const, box: { x: 0.05, y: 0.82, width: 0.9, height: 0.05 }, color: '#1d5fa8', background: null, align: 'center' as const, uppercase: true, lines: 2 },
    ],
    title_text: 'Backstage Stand Up',
    title_is_wordmark: false,
    closest_font: 'fredoka' as const,
    has_print_grain: true,
  }

  it('turns a uniform supporting row into a flexible lineup area, keeping the hero fixed', () => {
    const result = layoutFromAnalysis(analysis, { width: 1024, height: 1536 })

    expect(result.frames).toHaveLength(1)
    expect(result.frames[0].nameField).not.toBeNull()
    expect(result.lineupArea).not.toBeNull()
    expect(result.lineupArea!.box.x).toBeCloseTo(0.05)
    expect(result.lineupArea!.box.x + result.lineupArea!.box.width).toBeCloseTo(0.95)
    // Fem komikere får plass — antallet følger lineupen, ikke malen.
    expect(layoutCapacity(result)).toBeGreaterThanOrEqual(5)
    expect(result.frameStyle.label).toMatchObject({ background: '#4a4a2a', font: 'fredoka' })
    expect(result.frameStyle.fills).toEqual(['#e8927c', '#f6d98a'])
  })

  it('erases leftover event text without putting anything back', () => {
    const result = layoutFromAnalysis(analysis, { width: 1024, height: 1536 })
    expect(result.textFields.map((field) => field.role)).toEqual(['title', 'datetime'])
    expect(result.clearZones).toHaveLength(1)
  })

  it('leaves a designed wordmark as pixels and remembers what it says', () => {
    const result = layoutFromAnalysis({ ...analysis, title_is_wordmark: true }, { width: 1024, height: 1536 })
    expect(result.textFields.map((field) => field.role)).toEqual(['datetime'])
    expect(result.fixedTitle).toBe('Backstage Stand Up')
    // Tittelen tømmes ikke: bare den løse teksten er et slettefelt.
    expect(result.clearZones).toHaveLength(1)
  })

  it('treats loose name lists in a template with photo slots as old text, not as a lineup field', () => {
    const names = { role: 'lineup' as const, box: { x: 0.05, y: 0.8, width: 0.3, height: 0.05 }, color: '#1d5fa8', background: null, align: 'center' as const, uppercase: true, lines: 1 }
    const result = layoutFromAnalysis({ ...analysis, text_fields: [...analysis.text_fields, names, names] }, { width: 1024, height: 1536 })
    expect(result.textFields.some((field) => field.role === 'lineup')).toBe(false)
    expect(result.clearZones).toHaveLength(3)
  })

  it('keeps fixed frames when they are not a regular row', () => {
    const result = layoutFromAnalysis({ ...analysis, supporting_frames_are_uniform_row: false }, { width: 1024, height: 1536 })
    expect(result.frames).toHaveLength(4)
    expect(result.lineupArea).toBeNull()
  })
})
