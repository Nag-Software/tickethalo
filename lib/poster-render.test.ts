import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { renderPosterFromTemplate } from '@/lib/poster-render'
import { normalizeSchema } from '@/lib/poster-template'

// The deterministic template renderer (min-klubb maler) must (1) render
// Norwegian text with real glyphs via the bundled fonts, (2) keep the
// schema's canvas size, (3) be byte-deterministic — same inputs, same
// poster, every run.

// normalizeSchema fills slot defaults (vAlign, letterSpacing, …) from loose input.
const schema = normalizeSchema(<never>{
  canvasWidth: 1024,
  canvasHeight: 1536,
  plateUrl: null,
  palette: ['#181628', '#ffffff'],
  textSlots: [
    { role: 'title', box: { x: 0.06, y: 0.05, width: 0.88, height: 0.14 }, align: 'center', color: '#ffffff', fontWeight: 700, uppercase: true, maxLines: 2 },
    { role: 'lineup', box: { x: 0.08, y: 0.78, width: 0.84, height: 0.06 }, align: 'center', color: '#ffffff', fontWeight: 500, maxLines: 2 },
    { role: 'date', box: { x: 0.08, y: 0.86, width: 0.84, height: 0.05 }, align: 'center', color: '#ffffff', fontWeight: 600, uppercase: true },
    { role: 'venue', box: { x: 0.08, y: 0.905, width: 0.84, height: 0.035 }, align: 'center', color: '#cfcfd4', fontWeight: 500 },
  ],
  photoFrames: [],
  logos: [],
})

const showFacts = {
  title: 'Låvestandup på Lørenskog',
  dateText: 'Lørdag 22. august',
  timeText: 'kl. 20:00',
  venue: 'Æøå-scenen, Oslo',
  headliners: [{ name: 'Jaran Hereid', profileImageUrl: null, roleName: 'Headliner' }],
  supporting: [
    { name: 'Tom Søyler', profileImageUrl: null, roleName: 'Stand-up' },
    { name: 'Guri Sørumshagen', profileImageUrl: null, roleName: 'Stand-up' },
  ],
}

describe('renderPosterFromTemplate', () => {
  it('renders text onto the plate at the schema canvas size', async () => {
    const poster = await renderPosterFromTemplate({ schema, ...showFacts })

    const meta = await sharp(poster).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(schema.canvasWidth)
    expect(meta.height).toBe(schema.canvasHeight)

    // Text must actually land on the solid palette plate.
    const bare = await sharp({
      create: { width: schema.canvasWidth, height: schema.canvasHeight, channels: 3, background: '#181628' },
    }).raw().toBuffer()
    const after = await sharp(poster).removeAlpha().raw().toBuffer()
    let changed = 0
    for (let i = 0; i < bare.length; i += 3) {
      if (Math.abs(bare[i] - after[i]) > 8) changed++
    }
    // Title + lineup + date/venue should touch well over 1% of pixels.
    expect(changed).toBeGreaterThan((bare.length / 3) * 0.01)
  })

  it('is byte-deterministic for identical inputs', async () => {
    const [a, b] = await Promise.all([
      renderPosterFromTemplate({ schema, ...showFacts }),
      renderPosterFromTemplate({ schema, ...showFacts }),
    ])

    expect(a.equals(b)).toBe(true)
  })
})
