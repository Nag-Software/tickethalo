// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const batchSend = vi.fn()

vi.mock('@/lib/resend', () => ({
  resend: { batch: { send: (...args: unknown[]) => batchSend(...args) }, emails: { send: vi.fn() } },
  FROM_EMAIL: 'noreply@tickethalo.test',
  REPLY_TO_EMAIL: 'hei@tickethalo.test',
  fromWithName: (name: string) => `${name} <noreply@tickethalo.test>`,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import { BATCH_SIZE, chunk, sendBatch } from '@/lib/email/bulk'

const payload = (to: string) => ({ from: 'Club <noreply@tickethalo.test>', to, subject: 'Hi', html: '<p>Hi</p>' })

async function settle<T>(work: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync()
  return work
}

describe('chunk', () => {
  it('splits 2 000 contacts into twenty batches of a hundred', () => {
    const batches = chunk(Array.from({ length: 2000 }, (_, index) => index), BATCH_SIZE)
    expect(batches).toHaveLength(20)
    expect(batches.every((batch) => batch.length === 100)).toBe(true)
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]])
  })
})

describe('sendBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.useRealTimers())

  it('sends permissively and maps ids and per-address errors back to the recipients', async () => {
    batchSend.mockResolvedValue({
      data: { data: [{ id: 're_1' }, { id: 're_3' }], errors: [{ index: 1, message: 'Invalid `to` field' }] },
      error: null,
    })
    const outcomes = await settle(sendBatch([payload('a@x.test'), payload('bad'), payload('c@x.test')], 'key-1'))

    expect(batchSend).toHaveBeenCalledWith(expect.any(Array), { idempotencyKey: 'key-1', batchValidation: 'permissive' })
    expect(outcomes).toEqual([
      { email: 'a@x.test', resendId: 're_1', error: null },
      { email: 'bad', resendId: null, error: 'Invalid `to` field' },
      { email: 'c@x.test', resendId: 're_3', error: null },
    ])
  })

  it('retries a rate limit with the same idempotency key', async () => {
    batchSend
      .mockResolvedValueOnce({ data: null, error: { name: 'rate_limit_exceeded', message: 'Too many', statusCode: 429 } })
      .mockResolvedValueOnce({ data: { data: [{ id: 're_1' }] }, error: null })

    const outcomes = await settle(sendBatch([payload('a@x.test')], 'key-2'))
    expect(batchSend).toHaveBeenCalledTimes(2)
    expect(batchSend.mock.calls.map((call) => call[1].idempotencyKey)).toEqual(['key-2', 'key-2'])
    expect(outcomes[0]).toEqual({ email: 'a@x.test', resendId: 're_1', error: null })
  })

  it('does not retry an error that will not go away, and fails every address in the batch', async () => {
    batchSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'Domain not verified', statusCode: 403 } })
    const outcomes = await settle(sendBatch([payload('a@x.test'), payload('b@x.test')], 'key-3'))
    expect(batchSend).toHaveBeenCalledOnce()
    expect(outcomes.map((outcome) => outcome.error)).toEqual([
      'validation_error: Domain not verified',
      'validation_error: Domain not verified',
    ])
  })
})
