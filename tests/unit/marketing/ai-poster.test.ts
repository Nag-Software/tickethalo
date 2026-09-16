// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenAI } from '@/lib/openai'
import { generateShowPoster } from '@/lib/actions/ai'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/openai', () => ({ getOpenAI: vi.fn() }))

const generate = vi.fn()
const edit = vi.fn()
const upload = vi.fn()
const getPublicUrl = vi.fn()
const updateEq = vi.fn()
const update = vi.fn(() => ({ eq: updateEq }))

const baseOptions = {
  title: 'Friday Laughs',
  date: '2026-09-18',
  startTime: '20:30:00',
  venue: 'Comedy House',
  artists: [] as Array<string | { name: string; profile_image_url?: string | null; role_name?: string | null }>,
}

describe('AI poster generation boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    generate.mockResolvedValue({ data: [{ b64_json: Buffer.from('png').toString('base64') }] })
    edit.mockResolvedValue({ data: [{ b64_json: Buffer.from('png').toString('base64') }] })
    upload.mockResolvedValue({ error: null })
    getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn.example/poster.png' } })
    updateEq.mockResolvedValue({ error: null })
    vi.mocked(getOpenAI).mockReturnValue({ images: { generate, edit } } as never)
    vi.mocked(createAdminClient).mockReturnValue({
      storage: { from: vi.fn(() => ({ upload, getPublicUrl })) },
      from: vi.fn(() => ({ update })),
    } as never)
  })

  it('generates, uploads, and persists a poster without reference photos', async () => {
    await expect(generateShowPoster('show-1', baseOptions)).resolves.toBe('https://cdn.example/poster.png')
    expect(generate).toHaveBeenCalledOnce()
    expect(edit).not.toHaveBeenCalled()
    expect(upload).toHaveBeenCalledWith(
      'show-1/poster-1700000000000.png',
      expect.any(Buffer),
      { contentType: 'image/png', upsert: true },
    )
    expect(update).toHaveBeenCalledWith({ poster_url: 'https://cdn.example/poster.png' })
    expect(updateEq).toHaveBeenCalledWith('id', 'show-1')
  })

  it('includes exact show details in the prompt', async () => {
    await generateShowPoster('show-1', baseOptions)
    const prompt = generate.mock.calls[0][0].prompt as string
    expect(prompt).toContain('Title: "Friday Laughs"')
    expect(prompt).toContain('fredag 18. sep.')
    expect(prompt).toContain('kl. 20:30')
    expect(prompt).toContain('Venue: Comedy House')
  })

  it('orders headliners before supporting comedians in the prompt', async () => {
    await generateShowPoster('show-1', {
      ...baseOptions,
      artists: [
        { name: 'Support', role_name: 'Stand-up' },
        { name: 'Main', role_name: 'Headliner' },
      ],
    })
    const prompt = generate.mock.calls[0][0].prompt as string
    expect(prompt).toContain('Headliner comedian(s): Main')
    expect(prompt).toContain('Supporting comedians: Support')
  })

  it('deduplicates artist names case-insensitively', async () => {
    await generateShowPoster('show-1', { ...baseOptions, artists: ['Ada', ' ada ', 'Bjørn'] })
    const prompt = generate.mock.calls[0][0].prompt as string
    expect(prompt.split('\n').filter((line) => line === 'Ada - no reference photo')).toHaveLength(1)
    expect(prompt.split('\n').some((line) => line.trim() === 'ada - no reference photo')).toBe(false)
  })

  it('adds the exact venue palette to a generated design', async () => {
    await generateShowPoster('show-1', {
      ...baseOptions,
      palette: { primary: '#111111', secondary: '#222222', accent: '#333333' },
    })
    const prompt = generate.mock.calls[0][0].prompt as string
    expect(prompt).toContain('Use this exact brand palette')
    expect(prompt).toContain('#111111')
    expect(prompt).toContain('#222222')
    expect(prompt).toContain('#333333')
  })

  it('returns null by default when OpenAI returns no image', async () => {
    generate.mockResolvedValue({ data: [] })
    await expect(generateShowPoster('show-1', baseOptions)).resolves.toBeNull()
    expect(upload).not.toHaveBeenCalled()
  })

  it('rethrows generation errors when the caller requests strict handling', async () => {
    generate.mockRejectedValue(new Error('rate limited'))
    await expect(generateShowPoster('show-1', { ...baseOptions, throwOnError: true })).rejects.toThrow('rate limited')
  })

  it('does not persist when storage upload fails', async () => {
    upload.mockResolvedValue({ error: { message: 'bucket unavailable' } })
    await expect(generateShowPoster('show-1', baseOptions)).resolves.toBeNull()
    expect(update).not.toHaveBeenCalled()
  })

  it('reports a persistence error in strict mode', async () => {
    updateEq.mockResolvedValue({ error: { message: 'database unavailable' } })
    await expect(generateShowPoster('show-1', { ...baseOptions, throwOnError: true })).rejects.toThrow(
      'Kunne ikke lagre plakat på showet: database unavailable',
    )
  })

  it('uses Tickethalo as the venue fallback', async () => {
    await generateShowPoster('show-1', { ...baseOptions, venue: '' })
    expect(generate.mock.calls[0][0].prompt).toContain('Venue: Tickethalo')
  })
})
