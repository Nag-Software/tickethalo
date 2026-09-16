// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'

const stripeMock = vi.hoisted(() => ({
  refunds: { create: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  applicationFees: { retrieve: vi.fn() },
}))

/**
 * Minimal stand-in for the Supabase query builder: records every query and
 * answers from a queue per `table:operation`. Unqueued selects return no rows
 * and unqueued updates succeed.
 */
const db = vi.hoisted(() => {
  type Query = { table: string; op: 'select' | 'update'; payload?: unknown; calls: Array<[string, ...unknown[]]> }
  type Result = { data: unknown; error: { message: string } | null }

  const queries: Query[] = []
  const queued = new Map<string, Result[]>()

  function from(table: string) {
    const query: Query = { table, op: 'select', calls: [] }
    const chain: Record<string, unknown> = {}

    const resolve = () => {
      queries.push(query)
      const next = queued.get(`${table}:${query.op}`)?.shift()
      return Promise.resolve(next ?? { data: null, error: null })
    }

    for (const name of ['select', 'eq', 'neq', 'in', 'is', 'not', 'lt', 'order', 'limit', 'range']) {
      chain[name] = (...args: unknown[]) => {
        query.calls.push([name, ...args])
        return chain
      }
    }
    chain.update = (payload: unknown) => {
      query.op = 'update'
      query.payload = payload
      return chain
    }
    chain.maybeSingle = resolve
    chain.single = resolve
    chain.then = (onFulfilled: (value: Result) => unknown, onRejected: (reason: unknown) => unknown) =>
      resolve().then(onFulfilled, onRejected)

    return chain
  }

  return {
    client: { from },
    queries,
    queue(key: string, result: Result) {
      queued.set(key, [...(queued.get(key) ?? []), result])
    },
    updates(table: string) {
      return queries.filter((query) => query.table === table && query.op === 'update')
    },
    reset() {
      queries.length = 0
      queued.clear()
    },
  }
})

vi.mock('@/lib/stripe', () => ({ stripe: stripeMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db.client }))

import {
  isAwaitingRefund,
  processRefundQueue,
  refundEligibility,
  refundOrder,
  refundStateFromCharge,
  syncRefundFromCharge,
} from '@/lib/refunds'

const paidOrder = (overrides: Record<string, unknown> = {}) => ({
  id: 'order_1',
  status: 'paid',
  amount_total: 50_000,
  currency: 'NOK',
  platform_fee_amount: 5_000,
  refunded_amount: 0,
  application_fee_refunded_amount: 0,
  refunded_at: null,
  refund_reason: null,
  stripe_payment_intent_id: 'pi_1',
  stripe_charge_id: 'ch_1',
  stripe_application_fee_id: 'fee_1',
  stripe_connected_account_id: 'acct_club',
  cancellation_reason: null,
  ...overrides,
})

const charge = (overrides: Partial<Stripe.Charge> = {}) =>
  ({
    id: 'ch_1',
    amount: 50_000,
    amount_refunded: 50_000,
    refunded: true,
    application_fee: 'fee_1',
    payment_intent: 'pi_1',
    ...overrides,
  }) as Stripe.Charge

function stripeError(fields: Record<string, unknown>) {
  return Object.assign(new Error(String(fields.message ?? 'Stripe error')), fields)
}

beforeEach(() => {
  db.reset()
  vi.clearAllMocks()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('refundStateFromCharge', () => {
  it('treats a fully refunded charge as refunded', () => {
    expect(refundStateFromCharge({ amount: 50_000, amount_refunded: 50_000, refunded: true })).toEqual({
      refundedAmount: 50_000,
      fullyRefunded: true,
    })
  })

  it('treats the full amount as refunded even without the flag', () => {
    expect(refundStateFromCharge({ amount: 50_000, amount_refunded: 50_000, refunded: false })).toEqual({
      refundedAmount: 50_000,
      fullyRefunded: true,
    })
  })

  it('keeps a partial refund partial', () => {
    expect(refundStateFromCharge({ amount: 50_000, amount_refunded: 12_500, refunded: false })).toEqual({
      refundedAmount: 12_500,
      fullyRefunded: false,
    })
  })

  it('never records more than the charge amount', () => {
    expect(refundStateFromCharge({ amount: 50_000, amount_refunded: 60_000, refunded: false })).toEqual({
      refundedAmount: 50_000,
      fullyRefunded: true,
    })
  })

  it("trusts Stripe's refunded flag over the amount", () => {
    expect(refundStateFromCharge({ amount: 50_000, amount_refunded: 0, refunded: true })).toEqual({
      refundedAmount: 50_000,
      fullyRefunded: true,
    })
  })

  it('does not treat an unrefunded or zero charge as refunded', () => {
    expect(refundStateFromCharge({ amount: 50_000, amount_refunded: 0, refunded: false })).toEqual({
      refundedAmount: 0,
      fullyRefunded: false,
    })
    expect(refundStateFromCharge({ amount: 0, amount_refunded: 0, refunded: false })).toEqual({
      refundedAmount: 0,
      fullyRefunded: false,
    })
  })
})

describe('refundEligibility', () => {
  it('accepts a paid order', () => {
    expect(refundEligibility(paidOrder() as never)).toEqual({
      kind: 'refundable',
      paymentIntentId: 'pi_1',
      accountId: 'acct_club',
      awaitingRefund: false,
    })
  })

  it('accepts a cancelled order that was paid at Stripe but never refunded', () => {
    const order = paidOrder({ status: 'cancelled', cancellation_reason: 'sold_out' })
    expect(isAwaitingRefund(order as never)).toBe(true)
    expect(refundEligibility(order as never)).toMatchObject({ kind: 'refundable', awaitingRefund: true })
  })

  it('reports an already refunded order as done', () => {
    expect(refundEligibility(paidOrder({ status: 'refunded' }) as never)).toEqual({ kind: 'already_refunded' })
    expect(
      refundEligibility(paidOrder({ status: 'cancelled', refunded_at: '2026-09-01T10:00:00Z' }) as never),
    ).toEqual({ kind: 'already_refunded' })
  })

  it('rejects a cancelled order without a payment', () => {
    const order = paidOrder({ status: 'cancelled', stripe_payment_intent_id: null })
    expect(isAwaitingRefund(order as never)).toBe(false)
    expect(refundEligibility(order as never).kind).toBe('not_refundable')
  })

  it.each(['pending', 'failed'])('rejects a %s order', (status) => {
    expect(refundEligibility(paidOrder({ status }) as never)).toEqual({
      kind: 'not_refundable',
      error: `The order is not paid (${status}).`,
    })
  })

  it('rejects a paid order without Stripe references', () => {
    expect(refundEligibility(paidOrder({ stripe_connected_account_id: null }) as never).kind).toBe('not_refundable')
    expect(refundEligibility(paidOrder({ stripe_payment_intent_id: null }) as never).kind).toBe('not_refundable')
  })
})

describe('refundOrder', () => {
  it('returns ok without calling Stripe when the order is already refunded', async () => {
    db.queue('orders:select', { data: paidOrder({ status: 'refunded' }), error: null })

    await expect(refundOrder('order_1', 'customer_request')).resolves.toEqual({ ok: true, orderId: 'order_1', amount: 0 })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    expect(db.updates('orders')).toHaveLength(0)
  })

  it('refunds the full payment with the commission and never transfers anything', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.refunds.create.mockResolvedValue({ id: 're_1', amount: 50_000, status: 'succeeded' })

    await expect(refundOrder('order_1', 'duplicate')).resolves.toEqual({ ok: true, orderId: 'order_1', amount: 50_000 })

    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      {
        payment_intent: 'pi_1',
        refund_application_fee: true,
        reason: 'duplicate',
        metadata: { order_id: 'order_1', refund_reason: 'duplicate' },
      },
      { stripeAccount: 'acct_club', idempotencyKey: 'refund-order_1' },
    )
    expect(stripeMock).not.toHaveProperty('transfers')

    const [orderUpdate] = db.updates('orders')
    expect(orderUpdate.payload).toMatchObject({
      status: 'refunded',
      refund_reason: 'duplicate',
      refunded_amount: 50_000,
      application_fee_refunded_amount: 5_000,
    })
    expect(db.updates('tickets')).toHaveLength(1)
    expect(db.updates('tickets')[0].payload).toEqual({ status: 'refunded' })
  })

  it('refunds a paid order without a ticket as requested by the customer', async () => {
    db.queue('orders:select', {
      data: paidOrder({ status: 'cancelled', cancellation_reason: 'invalid_show' }),
      error: null,
    })
    stripeMock.refunds.create.mockResolvedValue({ id: 're_1', amount: 50_000, status: 'pending' })

    await expect(refundOrder('order_1', 'no_ticket_issued')).resolves.toMatchObject({ ok: true })
    expect(stripeMock.refunds.create.mock.calls[0][0]).toMatchObject({ reason: 'requested_by_customer' })
    expect(db.updates('orders')[0].payload).toMatchObject({ status: 'refunded', refund_reason: 'no_ticket_issued' })
  })

  it('does not touch Stripe for an order that is not paid', async () => {
    db.queue('orders:select', { data: paidOrder({ status: 'pending' }), error: null })

    await expect(refundOrder('order_1', 'customer_request')).resolves.toMatchObject({ ok: false })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('says the money went back when the order cannot be updated afterwards', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    db.queue('orders:update', { data: null, error: { message: 'connection reset' } })
    stripeMock.refunds.create.mockResolvedValue({ id: 're_1', amount: 50_000, status: 'succeeded' })

    await expect(refundOrder('order_1', 'customer_request')).rejects.toThrow(
      /refund went through in Stripe.*order_1.*charge\.refunded webhook/,
    )
    expect(db.updates('tickets')).toHaveLength(0)
  })

  it('syncs the order when Stripe says the charge is already refunded', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.refunds.create.mockRejectedValue(
      stripeError({ type: 'StripeInvalidRequestError', code: 'charge_already_refunded' }),
    )
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: charge() })
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    await expect(refundOrder('order_1', 'show_cancelled')).resolves.toEqual({ ok: true, orderId: 'order_1', amount: 0 })

    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith(
      'pi_1',
      { expand: ['latest_charge'] },
      { stripeAccount: 'acct_club' },
    )
    expect(db.updates('orders')[0].payload).toMatchObject({
      status: 'refunded',
      refund_reason: 'show_cancelled',
      refunded_amount: 50_000,
      application_fee_refunded_amount: 5_000,
    })
    expect(db.updates('tickets')).toHaveLength(1)
  })

  it('reports other Stripe errors without changing the order', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.refunds.create.mockRejectedValue(
      stripeError({ type: 'StripeInvalidRequestError', code: 'insufficient_funds', message: 'Insufficient funds' }),
    )

    await expect(refundOrder('order_1', 'customer_request')).resolves.toEqual({
      ok: false,
      orderId: 'order_1',
      error: 'Stripe could not refund the payment: Insufficient funds',
    })
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled()
    expect(db.updates('orders')).toHaveLength(0)
  })

  it('does not mark the order refunded while a parallel refund is still in progress', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.refunds.create.mockRejectedValue(
      stripeError({ type: 'StripeAPIError', rawType: 'idempotency_error' }),
    )
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: charge({ amount_refunded: 0, refunded: false }),
    })

    await expect(refundOrder('order_1', 'customer_request')).resolves.toMatchObject({ ok: false })
    expect(db.updates('orders')).toHaveLength(0)
  })
})

describe('syncRefundFromCharge', () => {
  it('records a partial refund without touching status or tickets', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 1_000 })

    await syncRefundFromCharge(charge({ amount_refunded: 10_000, refunded: false }), 'acct_club')

    const [orderUpdate] = db.updates('orders')
    expect(orderUpdate.payload).toEqual({ refunded_amount: 10_000, application_fee_refunded_amount: 1_000 })
    expect(db.updates('tickets')).toHaveLength(0)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('tickets remain valid'))
  })

  it('marks a fully refunded order and its tickets as refunded', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    await syncRefundFromCharge(charge(), 'acct_club')

    // Provisjonen ligger på plattformen — ingen stripeAccount.
    expect(stripeMock.applicationFees.retrieve).toHaveBeenCalledWith('fee_1')
    expect(db.updates('orders')[0].payload).toMatchObject({
      status: 'refunded',
      refund_reason: 'other',
      refunded_amount: 50_000,
      application_fee_refunded_amount: 5_000,
    })
    expect(db.updates('tickets')).toHaveLength(1)
  })

  it('falls back to the payment intent and keeps existing refund details', async () => {
    db.queue('orders:select', { data: null, error: null })
    db.queue('orders:select', {
      data: paidOrder({
        status: 'cancelled',
        stripe_charge_id: null,
        refunded_at: null,
        refund_reason: null,
        application_fee_refunded_amount: 5_000,
      }),
      error: null,
    })
    stripeMock.applicationFees.retrieve.mockRejectedValue(new Error('rate limited'))

    await syncRefundFromCharge(charge(), 'acct_club')

    const lookups = db.queries.filter((query) => query.table === 'orders' && query.op === 'select')
    expect(lookups[1].calls).toContainEqual(['eq', 'stripe_payment_intent_id', 'pi_1'])
    expect(db.updates('orders')[0].payload).toMatchObject({
      status: 'refunded',
      refund_reason: 'no_ticket_issued',
      application_fee_refunded_amount: 5_000,
    })
  })

  it('never lowers the refunded amount', async () => {
    db.queue('orders:select', { data: paidOrder({ refunded_amount: 20_000, application_fee_refunded_amount: 2_000 }), error: null })
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 1_000 })

    await syncRefundFromCharge(charge({ amount_refunded: 10_000, refunded: false }), 'acct_club')

    expect(db.updates('orders')[0].payload).toEqual({ refunded_amount: 20_000, application_fee_refunded_amount: 2_000 })
  })

  it('ignores charges without an order', async () => {
    await syncRefundFromCharge(charge({ payment_intent: null }), 'acct_club')
    expect(db.updates('orders')).toHaveLength(0)
  })

  it('ignores a charge reported by a different account', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    await syncRefundFromCharge(charge(), 'acct_other')
    expect(db.updates('orders')).toHaveLength(0)
  })

  it('throws when the order cannot be updated, so Stripe retries the webhook', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    db.queue('orders:update', { data: null, error: { message: 'timeout' } })
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    await expect(syncRefundFromCharge(charge(), 'acct_club')).rejects.toThrow(/order_1.*timeout/)
  })
})

describe('processRefundQueue', () => {
  it('refunds orders paid without a ticket and counts the outcome', async () => {
    db.queue('orders:select', { data: [{ id: 'order_1' }, { id: 'order_2' }], error: null })
    db.queue('orders:select', { data: paidOrder({ status: 'cancelled', cancellation_reason: 'sold_out' }), error: null })
    db.queue('orders:select', {
      data: paidOrder({ id: 'order_2', status: 'cancelled', stripe_connected_account_id: null }),
      error: null,
    })
    stripeMock.refunds.create.mockResolvedValue({ id: 're_1', amount: 50_000, status: 'succeeded' })

    await expect(processRefundQueue({ minAgeMinutes: 10, limit: 20 })).resolves.toEqual({
      processed: 2,
      refunded: 1,
      failed: 1,
    })

    const [queueQuery] = db.queries
    expect(queueQuery.calls).toEqual(
      expect.arrayContaining([
        ['eq', 'status', 'cancelled'],
        ['not', 'stripe_payment_intent_id', 'is', null],
        ['is', 'refunded_at', null],
        ['limit', 20],
      ]),
    )
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1)
  })

  it('throws when the queue cannot be read', async () => {
    db.queue('orders:select', { data: null, error: { message: 'down' } })
    await expect(processRefundQueue()).rejects.toThrow(/refund queue: down/)
  })
})
