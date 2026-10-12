// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  inserts: [] as Array<{ table: string; row: unknown }>,
  insertResult: { error: null as { message: string } | null },
  throwOnInsert: false,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      return {
        insert: async (row: unknown) => {
          if (db.throwOnInsert) throw new Error('database unreachable')
          db.inserts.push({ table, row })
          return db.insertResult
        },
      }
    },
  }),
}))

import { describeError, recordError } from '@/lib/error-log'

beforeEach(() => {
  db.inserts = []
  db.insertResult = { error: null }
  db.throwOnInsert = false
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('describeError', () => {
  it('takes the message and stack from an Error', () => {
    const record = describeError('checkout', new Error('boom'), { show_id: 's1' })
    expect(record).toMatchObject({ scope: 'checkout', message: 'boom', context: { show_id: 's1' } })
    expect(record.stack).toContain('boom')
  })

  it('accepts a plain string and never leaves the message empty', () => {
    expect(describeError('cron', 'payout release failed').message).toBe('payout release failed')
    expect(describeError('cron', '').message).toBe('Unknown error')
    expect(describeError('cron', 'x').stack).toBeNull()
  })

  it('keeps the row writable when the context cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(describeError('checkout', 'x', cyclic).context).toEqual({ unserialisable: '[object Object]' })
  })

  it('caps a huge context so one error cannot fill the table', () => {
    const record = describeError('checkout', 'x', { blob: 'a'.repeat(10_000) })
    expect(typeof record.context.truncated).toBe('string')
    expect((record.context.truncated as string).length).toBeLessThanOrEqual(4000)
  })
})

describe('recordError', () => {
  it('writes the error to app_errors and logs it', async () => {
    await recordError('ticket_email', new Error('Resend down'), { order_id: 'o1' })
    expect(db.inserts).toHaveLength(1)
    expect(db.inserts[0]).toMatchObject({ table: 'app_errors', row: { scope: 'ticket_email', message: 'Resend down', context: { order_id: 'o1' } } })
    expect(console.error).toHaveBeenCalledWith('[ticket_email] Resend down order_id=o1')
  })

  it('never throws, whether the insert is refused or the database is unreachable', async () => {
    db.insertResult = { error: { message: 'permission denied' } }
    await expect(recordError('cron', 'x')).resolves.toBeUndefined()
    db.throwOnInsert = true
    await expect(recordError('cron', 'x')).resolves.toBeUndefined()
  })
})
