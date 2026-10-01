// @vitest-environment node
import sharp from 'sharp'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const create = vi.fn()
vi.mock('@/lib/openai', () => ({ getOpenAI: () => ({ responses: { create } }) }))

const { headshotToken, isApprovedHeadshot, judgeHeadshot } = await import('@/lib/headshot-check')

let image: Buffer

beforeAll(async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
  image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#888' } }).jpeg().toBuffer()
})

beforeEach(() => {
  create.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('headshot receipt', () => {
  it('accepts the exact image it was issued for', () => {
    expect(isApprovedHeadshot(image, headshotToken(image))).toBe(true)
  })

  it('rejects another image, a missing token and garbage', () => {
    const other = Buffer.concat([image, Buffer.from([0])])
    expect(isApprovedHeadshot(other, headshotToken(image))).toBe(false)
    expect(isApprovedHeadshot(image, undefined)).toBe(false)
    expect(isApprovedHeadshot(image, 'not-hex')).toBe(false)
  })
})

describe('judgeHeadshot', () => {
  it('passes on the model’s rejection reason', async () => {
    create.mockResolvedValue({ output_text: JSON.stringify({ approved: false, problem: 'multiple_people' }) })
    await expect(judgeHeadshot(image)).resolves.toEqual({ approved: false, problem: 'multiple_people' })
  })

  it('approves when the model approves', async () => {
    create.mockResolvedValue({ output_text: JSON.stringify({ approved: true, problem: 'none' }) })
    await expect(judgeHeadshot(image)).resolves.toEqual({ approved: true })
  })

  it('approves rather than block the signup when the model fails', async () => {
    create.mockRejectedValue(new Error('timeout'))
    await expect(judgeHeadshot(image)).resolves.toEqual({ approved: true })
  })

  it('approves a rejection without a reason it knows', async () => {
    create.mockResolvedValue({ output_text: JSON.stringify({ approved: false, problem: 'none' }) })
    await expect(judgeHeadshot(image)).resolves.toEqual({ approved: true })
  })
})
