// @vitest-environment node

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { builtinPosterLayout } from '@/lib/poster/builtin'
import { PosterCapacityError, gridCells, planPoster, renderPoster, type PosterArtist, type PosterContent } from '@/lib/poster/compose'
import { normalizePosterLayout, type PosterLayout } from '@/lib/poster/layout'
import { PosterTextOverflowError } from '@/lib/poster/text'

const palette = { primary: '#f2b33d', secondary: '#3b3a1e', accent: '#2f6fb0' }

/** Hver artist får et ensfarget bilde, så en rute kan kjennes igjen på fargen. */
const COLORS = ['#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#00ffff', '#ffff00', '#804000', '#008040']

async function solid(color: string) {
  return sharp({ create: { width: 400, height: 500, channels: 3, background: color } }).png().toBuffer()
}

async function lineup(names: string[], headliners = 1): Promise<PosterArtist[]> {
  return Promise.all(names.map(async (name, index) => ({
    id: `artist-${index}`,
    name,
    photo: await solid(COLORS[index]),
    isHeadliner: index < headliners,
  })))
}

function content(artists: PosterArtist[], overrides: Partial<PosterContent> = {}): PosterContent {
  return {
    title: 'Backstage Stand Up',
    dateText: 'lørdag 17. okt.',
    timeText: 'kl. 20:15',
    venue: 'Skagenkaien 5, 4006 Stavanger',
    footer: 'Billetter · Tickethalo',
    artists,
    ...overrides,
  }
}

async function blankBackground() {
  return sharp({ create: { width: 1024, height: 1536, channels: 3, background: '#ffffff' } }).png().toBuffer()
}

/** Fargen midt i en rute på den ferdige plakaten. */
async function colorAt(poster: Buffer, box: { left: number; top: number; width: number; height: number }) {
  const { data } = await sharp(poster)
    .extract({ left: box.left + Math.floor(box.width / 2) - 2, top: box.top + Math.floor(box.height / 2) - 2, width: 4, height: 4 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return `#${[data[0], data[1], data[2]].map((value) => Math.round(value / 255) * 255).map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

const FIVE = ['Rune Feyling', 'Tom Soyler', 'Ida Brattås', 'Zoltan Illes', 'Jaran Hereid']

describe('planPoster', () => {
  it('gives every artist exactly one slot, headliner first', async () => {
    const artists = await lineup(FIVE)
    const layout = builtinPosterLayout({ framedCount: 5, headlinerCount: 1, palette, seed: 1 })
    const plan = planPoster(layout, artists)

    expect(plan.placements.map((placement) => placement.artist.name)).toEqual(FIVE)
    expect(plan.placements[0].slot).toBe('frame:hero')
    expect(plan.placements.slice(1).map((placement) => placement.slot)).toEqual(['grid:1', 'grid:2', 'grid:3', 'grid:4'])
    expect(plan.listed).toEqual([])
  })

  // Feilen som utløste omskrivingen: fem komikere, fire ruter, og én forsvant.
  it('refuses a lineup that does not fit instead of dropping someone', async () => {
    const artists = await lineup(FIVE)
    const fourSlots = normalizePosterLayout({
      frames: [0, 1, 2, 3].map((index) => ({ id: `f${index}`, box: { x: 0.05 + index * 0.23, y: 0.5, width: 0.2, height: 0.2 } })),
    })

    expect(() => planPoster(fourSlots, artists)).toThrow(PosterCapacityError)
    expect(() => planPoster(fourSlots, artists)).toThrow(/4 photo slots, but the lineup has 5/)
  })

  it('lists artists without a photo by name when the layout has a lineup field', async () => {
    const artists = await lineup(FIVE)
    artists[4] = { ...artists[4], photo: null }
    const layout = normalizePosterLayout({
      lineupArea: { box: { x: 0.05, y: 0.4, width: 0.9, height: 0.3 }, maxFrames: 8 },
      textFields: [{ id: 'names', role: 'lineup', box: { x: 0.05, y: 0.75, width: 0.9, height: 0.05 } }],
    })
    const plan = planPoster(layout, artists)

    expect(plan.placements).toHaveLength(4)
    expect(plan.listed.map((artist) => artist.name)).toEqual(['Jaran Hereid'])
  })

  it('gives an artist without a photo an initials slot when there is no lineup field', async () => {
    const artists = await lineup(FIVE)
    artists[4] = { ...artists[4], photo: null }
    const layout = builtinPosterLayout({ framedCount: 5, headlinerCount: 1, palette, seed: 1 })

    expect(planPoster(layout, artists).placements.map((placement) => placement.artist.name)).toContain('Jaran Hereid')
  })
})

describe('gridCells', () => {
  const area = { left: 60, top: 900, width: 900, height: 360 }

  it('draws as many cells as the lineup needs, inside the area and without overlap', () => {
    for (let count = 1; count <= 9; count++) {
      const cells = gridCells(area, count, 0.02, 0.15, 46)
      expect(cells).toHaveLength(count)
      for (const cell of cells) {
        expect(cell.photo.left).toBeGreaterThanOrEqual(area.left)
        expect(cell.photo.left + cell.photo.width).toBeLessThanOrEqual(area.left + area.width)
        expect(cell.photo.top).toBeGreaterThanOrEqual(area.top)
        expect(cell.label!.top + cell.label!.height).toBeLessThanOrEqual(area.top + area.height + 1)
        expect(cell.label!.height).toBeGreaterThanOrEqual(46)
      }
      const overlapping = cells.some((a, i) => cells.some((b, j) => (
        i < j
        && a.photo.left < b.photo.left + b.photo.width && b.photo.left < a.photo.left + a.photo.width
        && a.photo.top < b.photo.top + b.photo.height && b.photo.top < a.photo.top + a.photo.height
      )))
      expect(overlapping).toBe(false)
    }
  })
})

describe('renderPoster', () => {
  it('puts each artist\'s own photo in the slot that carries their name', async () => {
    const artists = await lineup(FIVE)
    const layout = builtinPosterLayout({ framedCount: 5, headlinerCount: 1, palette, seed: 1 })
    // Kornet ville farget pikslene vi måler på.
    const { buffer, plan } = await renderPoster({ layout: { ...layout, grain: 0 }, content: content(artists), background: await blankBackground() })

    const meta = await sharp(buffer).metadata()
    expect([meta.width, meta.height]).toEqual([1024, 1536])

    for (const [index, placement] of plan.placements.entries()) {
      expect(placement.artist.name).toBe(FIVE[index])
      expect(await colorAt(buffer, placement.photoBox)).toBe(COLORS[index])
    }
  })

  it('renders for every lineup size from one to eight', async () => {
    const names = [...FIVE, 'Åse Ødegård-Sæther', 'Kristoffer Aleksandersen', 'Li Wu']
    for (let count = 1; count <= 8; count++) {
      const artists = await lineup(names.slice(0, count))
      const layout = builtinPosterLayout({ framedCount: count, headlinerCount: 1, palette, seed: count })
      const { plan } = await renderPoster({ layout, content: content(artists), background: await blankBackground() })
      expect(plan.placements).toHaveLength(count)
    }
  })

  it('fails loudly when show text cannot be set at a readable size', async () => {
    const artists = await lineup(FIVE.slice(0, 2))
    const layout: PosterLayout = normalizePosterLayout({
      lineupArea: { box: { x: 0.05, y: 0.3, width: 0.9, height: 0.3 }, maxFrames: 8 },
      textFields: [{ id: 'venue', role: 'venue', box: { x: 0.4, y: 0.8, width: 0.05, height: 0.012 }, maxLines: 1 }],
    })

    await expect(renderPoster({ layout, content: content(artists), background: await blankBackground() }))
      .rejects.toThrow(PosterTextOverflowError)
  })

  it('shortens a name that is too long for its label rather than failing the poster', async () => {
    const artists = await lineup(['Rune Feyling', 'Maximilian Bartholomeus Aleksandersen-Haugland'])
    const layout = builtinPosterLayout({ framedCount: 2, headlinerCount: 1, palette, seed: 2 })
    await expect(renderPoster({ layout, content: content(artists), background: await blankBackground() })).resolves.toBeTruthy()
  })
})
