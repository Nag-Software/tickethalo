// @vitest-environment node

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenAI } from '@/lib/openai'
import { generateShowPoster, type GeneratePosterOptions } from '@/lib/poster/generate'
import { builtinPosterLayout } from '@/lib/poster/builtin'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/openai', () => ({ getOpenAI: vi.fn() }))

const palette = { primary: '#f2b33d', secondary: '#3b3a1e', accent: '#2f6fb0' }

const imagesGenerate = vi.fn()
const imagesEdit = vi.fn()
const responsesCreate = vi.fn()
const upload = vi.fn()
const remove = vi.fn()
const insert = vi.fn()
const updateEq = vi.fn()
const update = vi.fn(() => ({ eq: updateEq }))

const options: GeneratePosterOptions = {
  clubId: 'club-1',
  title: 'Backstage Stand Up',
  date: '2026-10-17',
  startTime: '20:15:00',
  venue: 'Skagenkaien 5, 4006 Stavanger',
  palette,
  artists: [
    { id: 'a1', name: 'Rune Feyling', imageUrl: 'https://cdn.example/rune.png', roleName: 'Headliner' },
    { id: 'a2', name: 'Tom Soyler', imageUrl: 'https://cdn.example/tom.png', roleName: 'Host' },
    { id: 'a3', name: 'Jaran Hereid', imageUrl: null, roleName: 'Stand-up' },
  ],
}

async function png(color: string, width = 300, height = 400) {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()
}

describe('generateShowPoster', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const photo = await png('#336699')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(photo), { headers: { 'content-type': 'image/png' } })))

    imagesGenerate.mockResolvedValue({ data: [{ b64_json: (await png('#f2b33d', 1024, 1536)).toString('base64') }] })
    responsesCreate.mockResolvedValue({ output_text: JSON.stringify({ has_people: false, has_text: false }) })
    upload.mockResolvedValue({ error: null })
    remove.mockResolvedValue({ error: null })
    insert.mockResolvedValue({ error: null })
    updateEq.mockResolvedValue({ error: null })

    vi.mocked(getOpenAI).mockReturnValue({ images: { generate: imagesGenerate, edit: imagesEdit }, responses: { create: responsesCreate } } as never)
    vi.mocked(createAdminClient).mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } }),
        })),
      },
      from: vi.fn(() => ({ insert, update })),
    } as never)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('sends the image model a background brief only — never names, photos or show text', async () => {
    await generateShowPoster('show-1', options)

    expect(imagesEdit).not.toHaveBeenCalled()
    expect(imagesGenerate).toHaveBeenCalledOnce()
    const prompt = imagesGenerate.mock.calls[0][0].prompt as string
    for (const secret of ['Rune', 'Feyling', 'Tom', 'Soyler', 'Jaran', 'Backstage', 'Skagenkaien', '20:15']) {
      expect(prompt).not.toContain(secret)
    }
  })

  it('archives every generated poster with the lineup it was made for', async () => {
    const url = await generateShowPoster('show-1', options)

    expect(url).toMatch(/^https:\/\/cdn\.example\/show-1\/posters\/poster-\d+\.png$/)
    expect(insert).toHaveBeenCalledOnce()
    expect(insert.mock.calls[0][0]).toMatchObject({
      show_id: 'show-1',
      club_id: 'club-1',
      kind: 'poster',
      source: 'ai',
      lineup_snapshot: [
        { artist_id: 'a1', name: 'Rune Feyling' },
        { artist_id: 'a2', name: 'Tom Soyler' },
        { artist_id: 'a3', name: 'Jaran Hereid' },
      ],
    })
    // Ingen plakatfil overskrives: opplastingen er aldri en upsert.
    for (const call of upload.mock.calls) expect(call[2]).toMatchObject({ upsert: false })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ poster_url: url, poster_source: 'ai' }))
  })

  it('removes the file again when the archive row cannot be written', async () => {
    insert.mockResolvedValue({ error: { message: 'insert denied' } })

    await expect(generateShowPoster('show-1', { ...options, throwOnError: true })).rejects.toThrow('insert denied')
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(/^show-1\/posters\//)])
    expect(update).not.toHaveBeenCalled()
  })

  it('reuses the show\'s background when only the lineup changed', async () => {
    const first = await generateShowPoster('show-1', options)
    expect(first).toBeTruthy()
    const backgroundPath = upload.mock.calls.find((call) => String(call[0]).includes('/backgrounds/'))![0] as string
    imagesGenerate.mockClear()

    await generateShowPoster('show-1', {
      ...options,
      existingBackground: { url: `https://cdn.example/${backgroundPath}`, path: backgroundPath },
    })
    expect(imagesGenerate).not.toHaveBeenCalled()
  })

  it('paints a new background when asked, or when the brand colours changed', async () => {
    await generateShowPoster('show-1', options)
    const backgroundPath = upload.mock.calls.find((call) => String(call[0]).includes('/backgrounds/'))![0] as string
    const existingBackground = { url: `https://cdn.example/${backgroundPath}`, path: backgroundPath }

    imagesGenerate.mockClear()
    await generateShowPoster('show-1', { ...options, existingBackground, newBackground: true })
    expect(imagesGenerate).toHaveBeenCalledOnce()

    imagesGenerate.mockClear()
    await generateShowPoster('show-1', { ...options, existingBackground, palette: { ...palette, primary: '#112233' } })
    expect(imagesGenerate).toHaveBeenCalledOnce()
  })

  it('falls back to a drawn background when the model paints people or text', async () => {
    responsesCreate.mockResolvedValue({ output_text: JSON.stringify({ has_people: true, has_text: false }) })

    await expect(generateShowPoster('show-1', options)).resolves.toBeTruthy()
    expect(imagesGenerate).toHaveBeenCalledTimes(2)
  })

  const readyTemplate = () => ({
    id: 't1',
    label: 'House poster',
    fileUrl: 'https://cdn.example/template.png',
    layout: builtinPosterLayout({ framedCount: 3, headlinerCount: 1, palette, seed: 1 }),
    layoutStatus: 'confirmed' as const,
    plateUrl: 'https://cdn.example/plate.png',
  })

  it('uses a set-up template without painting anything', async () => {
    responsesCreate.mockResolvedValue({ output_text: JSON.stringify({ has_problem: false, problem: '' }) })

    await expect(generateShowPoster('show-1', { ...options, template: readyTemplate() })).resolves.toBeTruthy()
    expect(imagesGenerate).not.toHaveBeenCalled()
    expect(imagesEdit).not.toHaveBeenCalled()
    // Ett kall: kontrollen av det ferdige resultatet.
    expect(responsesCreate).toHaveBeenCalledOnce()
  })

  it('falls back to the built-in layout when the template result does not look right', async () => {
    responsesCreate.mockImplementation(async (args: { text: { format: { name: string } } }) => ({
      output_text: JSON.stringify(args.text.format.name === 'poster_quality'
        ? { has_problem: true, problem: 'photo covers the logo' }
        : { has_people: false, has_text: false }),
    }))

    await expect(generateShowPoster('show-1', { ...options, template: readyTemplate(), throwOnError: true })).resolves.toBeTruthy()
    expect(imagesGenerate).toHaveBeenCalledOnce()
    // Oppsettet som ga et dårlig resultat glemmes.
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ layout_status: 'none', plate_url: null }))
  })

  // «Korrekt informasjon»: et ordmerke i malen må stemme med showet.
  it('does not use a template whose built-in title is another show\'s title', async () => {
    responsesCreate.mockResolvedValue({ output_text: JSON.stringify({ has_problem: false, problem: '', has_people: false, has_text: false }) })
    const template = { ...readyTemplate(), layout: { ...readyTemplate().layout, textFields: [], fixedTitle: 'Friday Open Mic' } }

    await generateShowPoster('show-1', { ...options, template })
    expect(imagesGenerate).toHaveBeenCalledOnce()

    imagesGenerate.mockClear()
    await generateShowPoster('show-1', { ...options, title: 'FRIDAY OPEN-MIC', template })
    expect(imagesGenerate).not.toHaveBeenCalled()
  })

  it('never uses a template that would show a face without a name', async () => {
    responsesCreate.mockResolvedValue({ output_text: JSON.stringify({ has_problem: false, problem: '', has_people: false, has_text: false }) })
    const base = readyTemplate().layout
    const template = { ...readyTemplate(), layout: { ...base, frames: base.frames.map((frame) => ({ ...frame, nameField: null })), frameStyle: { ...base.frameStyle, label: null } } }

    await expect(generateShowPoster('show-1', { ...options, template, throwOnError: true })).resolves.toBeTruthy()
    expect(imagesGenerate).toHaveBeenCalledOnce()
  })

  it('falls back to the built-in layout when the template has too few photo slots', async () => {
    const template = { ...readyTemplate(), layout: { ...readyTemplate().layout, lineupArea: null } }
    await expect(generateShowPoster('show-1', { ...options, template, throwOnError: true })).resolves.toBeTruthy()
    expect(imagesGenerate).toHaveBeenCalledOnce()
    expect(insert.mock.calls[0][0].lineup_snapshot).toHaveLength(3)
  })

  it('does not make a poster for an empty lineup', async () => {
    await expect(generateShowPoster('show-1', { ...options, artists: [], throwOnError: true })).rejects.toThrow(/no confirmed artists/)
  })

  it('treats the same artist listed twice as one', async () => {
    await generateShowPoster('show-1', { ...options, artists: [...options.artists, options.artists[0]] })
    expect(insert.mock.calls[0][0].lineup_snapshot).toHaveLength(3)
  })
})
