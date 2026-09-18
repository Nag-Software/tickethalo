// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const send = vi.fn()
const insert = vi.fn()

vi.mock('@/lib/resend', () => ({
  resend: { emails: { send: (...args: unknown[]) => send(...args) } },
  FROM_EMAIL: 'noreply@tickethalo.test',
  REPLY_TO_EMAIL: 'hei@tickethalo.test',
  fromWithName: (name: string) => `${name} <noreply@tickethalo.test>`,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: () => ({ insert: (...args: unknown[]) => insert(...args) }) }),
}))

import { sendShowCancelledEmail } from '@/lib/email/mailer'

const notice = {
  email: 'ida@example.test',
  full_name: 'Ida',
  show_title: 'Backstage',
  show_date: '2026-10-17',
  club_name: 'Backstage',
  booked: true,
}

/** Lar ventetiden mellom forsøkene gå uten at testen venter på den. */
async function settle<T>(work: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync()
  return work
}

describe('email delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    send.mockResolvedValue({ data: { id: 're_123' }, error: null })
    insert.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends with a reply-to and records the delivery', async () => {
    const result = await settle(sendShowCancelledEmail(notice))

    expect(result).toEqual({ success: true, resendId: 're_123' })
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0]).toMatchObject({
      from: 'noreply@tickethalo.test',
      to: 'ida@example.test',
      replyTo: 'hei@tickethalo.test',
      subject: 'Show cancelled: Backstage',
    })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      recipient_email: 'ida@example.test',
      template_name: 'show_cancelled',
      resend_email_id: 're_123',
      status: 'sent',
    }))
  })

  it('retries a rate limit with the same idempotency key', async () => {
    send
      .mockResolvedValueOnce({ data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests', statusCode: 429 } })
      .mockResolvedValueOnce({ data: { id: 're_456' }, error: null })

    const result = await settle(sendShowCancelledEmail(notice))

    expect(result.success).toBe(true)
    expect(send).toHaveBeenCalledTimes(2)
    const keys = send.mock.calls.map((call) => (call[1] as { idempotencyKey: string }).idempotencyKey)
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
  })

  it('does not retry an error that will be the same next time', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'Invalid `to` field', statusCode: 422 } })

    const result = await settle(sendShowCancelledEmail(notice))

    expect(result).toEqual({ success: false, error: 'validation_error: Invalid `to` field' })
    expect(send).toHaveBeenCalledOnce()
  })

  it('gives up after three attempts, logs it, and never throws', async () => {
    send.mockRejectedValue(new Error('fetch failed'))

    const result = await settle(sendShowCancelledEmail(notice))

    expect(result).toEqual({ success: false, error: 'fetch failed' })
    expect(send).toHaveBeenCalledTimes(3)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[Email] show_cancelled to ida@example.test failed: fetch failed'))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', error_message: 'fetch failed', sent_at: null }))
  })

  it('still reports the email as sent when the log cannot be written', async () => {
    insert.mockRejectedValue(new Error('database unavailable'))

    await expect(settle(sendShowCancelledEmail(notice))).resolves.toEqual({ success: true, resendId: 're_123' })
  })
})
