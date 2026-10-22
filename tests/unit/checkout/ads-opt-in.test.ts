// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  updates: [] as Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }>,
  error: null as { message: string } | null,
}))

const recordError = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/lib/error-log', () => ({ recordError }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      expect(table).toBe('orders')
      const entry = { patch: {} as Record<string, unknown>, filters: {} as Record<string, unknown> }
      const builder = {
        update(patch: Record<string, unknown>) {
          entry.patch = patch
          state.updates.push(entry)
          return builder
        },
        eq(column: string, value: unknown) {
          entry.filters[column] = value
          return builder
        },
        then(resolve: (value: unknown) => void) {
          resolve({ error: state.error })
        },
      }
      return builder
    },
  }),
}))

import { readAdsOptIn, recordAdsOptIn } from '@/lib/checkout/ads-opt-in'

beforeEach(() => {
  state.updates = []
  state.error = null
  recordError.mockClear()
})

describe('recordAdsOptIn', () => {
  it('sets the box on an order that has the email box, once', async () => {
    await recordAdsOptIn('order_1')
    expect(state.updates).toHaveLength(1)
    expect(state.updates[0].patch).toMatchObject({ ads_opt_in: true })
    expect(state.updates[0].patch.ads_opt_in_at).toEqual(expect.any(String))
    expect(state.updates[0].filters).toEqual({ id: 'order_1', marketing_opt_in: true, ads_opt_in: false })
  })

  it('does nothing without an order', async () => {
    await recordAdsOptIn(null)
    expect(state.updates).toHaveLength(0)
  })

  it('logs a failure instead of throwing it at the buyer', async () => {
    state.error = { message: 'column "ads_opt_in" does not exist' }
    await expect(recordAdsOptIn('order_1')).resolves.toBeUndefined()
    expect(recordError).toHaveBeenCalledWith('checkout', state.error, { action: 'record_ads_opt_in', order_id: 'order_1' })
  })
})

describe('readAdsOptIn', () => {
  it('needs the email box too', () => {
    const form = new FormData()
    form.set('ads_opt_in', 'on')
    expect(readAdsOptIn(form, true)).toBe(true)
    expect(readAdsOptIn(form, false)).toBe(false)
    expect(readAdsOptIn(new FormData(), true)).toBe(false)
  })
})
