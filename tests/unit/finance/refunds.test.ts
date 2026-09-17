// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'

const stripeMock = vi.hoisted(() => ({
  refunds: { create: vi.fn(), list: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  applicationFees: { retrieve: vi.fn() },
  charges: { retrieve: vi.fn() },
  disputes: { retrieve: vi.fn() },
}))

/**
 * Minimal stand-in for the Supabase query builder: records every query and
 * answers from a queue per `table:operation`. Unqueued selects return no rows
 * and unqueued updates succeed.
 */
const db = vi.hoisted(() => {
  type Query = { table: string; op: 'select' | 'update'; payload?: unknown; calls: Array<[string, ...unknown[]]> }
  type Result = { data: unknown; error: { message: string } | null; count?: number | null }

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

    for (const name of ['select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'lt', 'gte', 'order', 'limit', 'range']) {
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
    selects(table: string) {
      return queries.filter((query) => query.table === table && query.op === 'select')
    },
    reset() {
      queries.length = 0
      queued.clear()
    },
  }
})

vi.mock('@/lib/stripe', () => ({ stripe: stripeMock }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => db.client }))
vi.mock('@/lib/email/mailer', () => ({ sendTicketPurchaseEmail: vi.fn() }))

import {
  DISPUTE_OPEN_MESSAGE,
  MAX_REFUND_QUEUE_ATTEMPTS,
  disputeOrderUpdate,
  isAwaitingRefund,
  isDisputeOpen,
  processRefundQueue,
  refundEligibility,
  refundIdempotencyKey,
  refundOrder,
  refundQueueSkipReason,
  refundReversalUpdate,
  refundShow,
  refundStateFromCharge,
  refundedAmountAfterRefund,
  refundsCoverPayment,
  syncDisputeFromStripe,
  syncRefundFromCharge,
  syncRefundStatus,
} from '@/lib/refunds'
import { applicationFeeFromMetadata, chargeFactsRepair, repairMissingChargeFacts } from '@/lib/checkout/finalize'

const ORDER_UUID = '6f1c1c9e-6c1a-4f55-9d6a-2b8f2f5b8a11'
const NOW = '2026-09-17T08:00:00.000Z'

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
  dispute_status: null,
  disputed_at: null,
  refund_attempts: 0,
  ...overrides,
})

const refundedOrder = (overrides: Record<string, unknown> = {}) =>
  paidOrder({
    status: 'refunded',
    refunded_at: '2026-09-10T10:00:00Z',
    refund_reason: 'show_cancelled',
    refunded_amount: 50_000,
    application_fee_refunded_amount: 5_000,
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

const stripeRefund = (overrides: Partial<Stripe.Refund> = {}) =>
  ({
    id: 're_1',
    object: 'refund',
    amount: 50_000,
    status: 'failed',
    failure_reason: 'expired_or_canceled_card',
    charge: 'ch_1',
    payment_intent: 'pi_1',
    metadata: { order_id: 'order_1', refund_reason: 'show_cancelled' },
    ...overrides,
  }) as Stripe.Refund

const stripeDispute = (overrides: Partial<Stripe.Dispute> = {}) =>
  ({
    id: 'dp_1',
    object: 'dispute',
    amount: 50_000,
    currency: 'nok',
    created: 1_789_000_000,
    reason: 'fraudulent',
    status: 'needs_response',
    charge: 'ch_1',
    payment_intent: 'pi_1',
    ...overrides,
  }) as Stripe.Dispute

function stripeError(fields: Record<string, unknown>) {
  return Object.assign(new Error(String(fields.message ?? 'Stripe error')), fields)
}

beforeEach(() => {
  db.reset()
  // Nullstiller også implementasjonene, så et mockResolvedValue fra én test
  // ikke lekker inn i neste.
  vi.resetAllMocks()
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

describe('isDisputeOpen', () => {
  it.each(['needs_response', 'under_review', 'warning_needs_response', 'warning_under_review'])(
    'treats %s as open',
    (status) => {
      expect(isDisputeOpen(status)).toBe(true)
    },
  )

  it.each([null, undefined, 'won', 'lost', 'warning_closed', 'prevented'])('treats %s as not open', (status) => {
    expect(isDisputeOpen(status)).toBe(false)
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
    const order = paidOrder({ status: 'cancelled', cancellation_reason: 'sales_closed' })
    expect(isAwaitingRefund(order as never)).toBe(true)
    expect(refundEligibility(order as never)).toMatchObject({ kind: 'refundable', awaitingRefund: true })
  })

  it('reports an already refunded order as done', () => {
    expect(refundEligibility(paidOrder({ status: 'refunded' }) as never)).toEqual({ kind: 'already_refunded' })
    expect(
      refundEligibility(paidOrder({ status: 'cancelled', refunded_at: '2026-09-01T10:00:00Z' }) as never),
    ).toEqual({ kind: 'already_refunded' })
    // En tapt disputt er refundert av banken.
    expect(
      refundEligibility(paidOrder({ status: 'refunded', dispute_status: 'lost' }) as never),
    ).toEqual({ kind: 'already_refunded' })
  })

  it('rejects a cancelled order without a payment', () => {
    const order = paidOrder({ status: 'cancelled', stripe_payment_intent_id: null })
    expect(isAwaitingRefund(order as never)).toBe(false)
    expect(refundEligibility(order as never)).toMatchObject({ kind: 'not_refundable', code: 'no_payment' })
  })

  it.each(['pending', 'failed'])('rejects a %s order', (status) => {
    expect(refundEligibility(paidOrder({ status }) as never)).toEqual({
      kind: 'not_refundable',
      code: 'not_paid',
      error: `The order is not paid (${status}).`,
    })
  })

  it('rejects a paid order without Stripe references and explains legacy payments', () => {
    expect(refundEligibility(paidOrder({ stripe_connected_account_id: null }) as never)).toEqual({
      kind: 'not_refundable',
      code: 'missing_stripe_reference',
      error: expect.stringContaining('Stripe dashboard'),
    })
    expect(refundEligibility(paidOrder({ stripe_payment_intent_id: null }) as never)).toMatchObject({
      kind: 'not_refundable',
      code: 'missing_stripe_reference',
    })
  })

  it.each(['needs_response', 'under_review', 'warning_needs_response'])(
    'refuses while a dispute is %s',
    (dispute_status) => {
      expect(refundEligibility(paidOrder({ dispute_status }) as never)).toEqual({
        kind: 'not_refundable',
        code: 'dispute_open',
        error: DISPUTE_OPEN_MESSAGE,
      })
      expect(
        refundEligibility(paidOrder({ status: 'cancelled', cancellation_reason: 'sold_out', dispute_status }) as never),
      ).toMatchObject({ code: 'dispute_open' })
    },
  )

  it.each(['won', 'warning_closed', 'prevented'])('accepts a paid order after the dispute is %s', (dispute_status) => {
    expect(refundEligibility(paidOrder({ dispute_status }) as never).kind).toBe('refundable')
  })
})

describe('refundQueueSkipReason', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    stripe_connected_account_id: 'acct_club',
    refund_attempts: 0,
    dispute_status: null,
    ...overrides,
  })

  it('processes a fresh order with a connected account', () => {
    expect(refundQueueSkipReason(row())).toBeNull()
    expect(refundQueueSkipReason(row({ refund_attempts: MAX_REFUND_QUEUE_ATTEMPTS - 1 }))).toBeNull()
    expect(refundQueueSkipReason(row({ dispute_status: 'won' }))).toBeNull()
  })

  it('leaves legacy platform payments to the booker', () => {
    expect(refundQueueSkipReason(row({ stripe_connected_account_id: null }))).toBe('missing_connected_account')
  })

  it('gives up after the attempts cap', () => {
    expect(MAX_REFUND_QUEUE_ATTEMPTS).toBe(5)
    expect(refundQueueSkipReason(row({ refund_attempts: 5 }))).toBe('attempts_exhausted')
    expect(refundQueueSkipReason(row({ refund_attempts: 9 }))).toBe('attempts_exhausted')
  })

  it('waits for an open dispute', () => {
    expect(refundQueueSkipReason(row({ dispute_status: 'under_review' }))).toBe('dispute_open')
  })
})

describe('refundIdempotencyKey', () => {
  it('uses one key per attempt', () => {
    expect(refundIdempotencyKey('order_1', 0)).toBe('refund-order_1-0')
    expect(refundIdempotencyKey('order_1', 1)).toBe('refund-order_1-1')
    expect(refundIdempotencyKey('order_1', 4)).toBe('refund-order_1-4')
  })

  it('falls back to the first attempt for missing or invalid counters', () => {
    expect(refundIdempotencyKey('order_1', null)).toBe('refund-order_1-0')
    expect(refundIdempotencyKey('order_1', undefined)).toBe('refund-order_1-0')
    expect(refundIdempotencyKey('order_1', -1)).toBe('refund-order_1-0')
    expect(refundIdempotencyKey('order_1', 1.5)).toBe('refund-order_1-0')
  })
})

describe('refundedAmountAfterRefund', () => {
  it('adds the refund to what was already refunded', () => {
    expect(refundedAmountAfterRefund({ amount_total: 50_000, refunded_amount: 0 }, 50_000)).toBe(50_000)
    expect(refundedAmountAfterRefund({ amount_total: 50_000, refunded_amount: 30_000 }, 20_000)).toBe(50_000)
  })

  it('never goes above the payment or below the recorded amount', () => {
    expect(refundedAmountAfterRefund({ amount_total: 50_000, refunded_amount: 30_000 }, 50_000)).toBe(50_000)
    expect(refundedAmountAfterRefund({ amount_total: 50_000, refunded_amount: 60_000 }, 0)).toBe(60_000)
    expect(refundedAmountAfterRefund({ amount_total: null, refunded_amount: 1_000 }, 2_000)).toBe(3_000)
  })
})

describe('refundsCoverPayment', () => {
  it('counts pending, requires_action and succeeded refunds', () => {
    expect(
      refundsCoverPayment(
        [
          { amount: 30_000, status: 'succeeded' },
          { amount: 20_000, status: 'pending' },
        ],
        50_000,
      ),
    ).toBe(true)
    expect(refundsCoverPayment([{ amount: 50_000, status: 'requires_action' }], 50_000)).toBe(true)
  })

  it('ignores failed and canceled refunds', () => {
    expect(
      refundsCoverPayment(
        [
          { amount: 50_000, status: 'failed' },
          { amount: 50_000, status: 'canceled' },
          { amount: 10_000, status: 'succeeded' },
        ],
        50_000,
      ),
    ).toBe(false)
  })

  it('never covers an unknown or zero payment', () => {
    expect(refundsCoverPayment([{ amount: 0, status: 'succeeded' }], 0)).toBe(false)
    expect(refundsCoverPayment([{ amount: 50_000, status: 'succeeded' }], null)).toBe(false)
  })
})

describe('refundReversalUpdate', () => {
  const context = { error: 'Stripe refund re_1 failed (expired_or_canceled_card).', now: NOW }

  it('puts a refunded order with tickets back to paid, lowering the amounts to Stripe’s values', () => {
    expect(refundReversalUpdate(refundedOrder() as never, { refundedAmount: 0, fullyRefunded: false }, 0, context)).toEqual({
      refunded_amount: 0,
      application_fee_refunded_amount: 0,
      status: 'paid',
      refunded_at: null,
      refund_reason: null,
      refund_attempts: 1,
      last_refund_attempt_at: NOW,
      last_refund_error: context.error,
    })
  })

  it('puts an order without tickets back in the refund queue', () => {
    const update = refundReversalUpdate(
      refundedOrder({ cancellation_reason: 'sold_out', refund_attempts: 2 }) as never,
      { refundedAmount: 0, fullyRefunded: false },
      null,
      context,
    )
    expect(update).toMatchObject({ status: 'cancelled', refunded_at: null, refund_attempts: 3 })
    // Ukjent provisjon: verdien ordren har, beholdes.
    expect(update?.application_fee_refunded_amount).toBe(5_000)

    const cancelledWithRefund = refundReversalUpdate(
      paidOrder({ status: 'cancelled', cancellation_reason: 'sold_out', refunded_at: NOW, refunded_amount: 50_000 }) as never,
      { refundedAmount: 0, fullyRefunded: false },
      0,
      context,
    )
    expect(cancelledWithRefund).toMatchObject({ refunded_at: null, refunded_amount: 0 })
    expect(cancelledWithRefund).not.toHaveProperty('status')
  })

  it('keeps an earlier partial refund that did not fail', () => {
    expect(
      refundReversalUpdate(refundedOrder() as never, { refundedAmount: 10_000, fullyRefunded: false }, 1_000, context),
    ).toMatchObject({ refunded_amount: 10_000, application_fee_refunded_amount: 1_000, status: 'paid' })
  })

  it('lowers a failed partial refund without touching status or attempts', () => {
    expect(
      refundReversalUpdate(
        paidOrder({ refunded_amount: 10_000, application_fee_refunded_amount: 1_000 }) as never,
        { refundedAmount: 0, fullyRefunded: false },
        0,
        context,
      ),
    ).toEqual({ refunded_amount: 0, application_fee_refunded_amount: 0 })
  })

  it('changes nothing while other refunds still cover the payment, or when the order already matches', () => {
    expect(
      refundReversalUpdate(refundedOrder() as never, { refundedAmount: 50_000, fullyRefunded: true }, 5_000, context),
    ).toBeNull()
    expect(refundReversalUpdate(paidOrder() as never, { refundedAmount: 0, fullyRefunded: false }, 0, context)).toBeNull()
  })
})

describe('disputeOrderUpdate', () => {
  const withdrawn = [{ net: -50_000 - 15_000 }]

  it('records an open dispute and the money Stripe withdrew from the club', () => {
    expect(disputeOrderUpdate(paidOrder() as never, stripeDispute({ balance_transactions: withdrawn as never }), NOW)).toEqual({
      update: {
        dispute_status: 'needs_response',
        dispute_net_amount: 65_000,
        disputed_at: new Date(1_789_000_000 * 1000).toISOString(),
      },
      invalidateTickets: false,
    })
  })

  it('a won dispute nets to the dispute fee only', () => {
    const { update } = disputeOrderUpdate(
      paidOrder({ disputed_at: '2026-09-01T00:00:00Z' }) as never,
      stripeDispute({ status: 'won', balance_transactions: [{ net: -65_000 }, { net: 50_000 }] as never }),
      NOW,
    )
    expect(update).toEqual({ dispute_status: 'won', dispute_net_amount: 15_000 })
  })

  it('closes a lost dispute covering the payment as refunded without touching refunded_amount', () => {
    expect(
      disputeOrderUpdate(
        paidOrder({ disputed_at: '2026-09-01T00:00:00Z' }) as never,
        stripeDispute({ status: 'lost', balance_transactions: withdrawn as never }),
        NOW,
      ),
    ).toEqual({
      update: {
        dispute_status: 'lost',
        dispute_net_amount: 65_000,
        status: 'refunded',
        refunded_at: NOW,
        refund_reason: 'dispute_lost',
      },
      invalidateTickets: true,
    })
  })

  it('keeps the order and its tickets when a lost dispute covers only part of the payment', () => {
    const { update, invalidateTickets } = disputeOrderUpdate(
      paidOrder({ amount_total: 110_000 }) as never,
      stripeDispute({ status: 'lost', amount: 27_500, balance_transactions: [{ net: -27_500 }] as never }),
      NOW,
    )
    expect(update.status).toBeUndefined()
    expect(update.dispute_net_amount).toBe(27_500)
    expect(invalidateTickets).toBe(false)
  })

  it('reopens an order closed by a lost dispute that Stripe later marks as won', () => {
    const { update, invalidateTickets } = disputeOrderUpdate(
      refundedOrder({ refund_reason: 'dispute_lost', disputed_at: NOW }) as never,
      stripeDispute({ status: 'won', balance_transactions: [{ net: -50_000 }, { net: 50_000 }] as never }),
      NOW,
    )
    expect(update).toMatchObject({ dispute_status: 'won', dispute_net_amount: 0, status: 'paid', refunded_at: null, refund_reason: null })
    expect(invalidateTickets).toBe(false)
  })

  it('does not reopen an order the club refunded itself', () => {
    const { update } = disputeOrderUpdate(
      refundedOrder({ refund_reason: 'requested_by_customer', disputed_at: NOW }) as never,
      stripeDispute({ status: 'won' }),
      NOW,
    )
    expect(update.status).toBeUndefined()
  })

  it('records the loss on an order that was already refunded, and still invalidates tickets', () => {
    expect(
      disputeOrderUpdate(refundedOrder({ disputed_at: NOW }) as never, stripeDispute({ status: 'lost', balance_transactions: withdrawn as never }), NOW),
    ).toEqual({
      update: { dispute_status: 'lost', dispute_net_amount: 65_000 },
      invalidateTickets: true,
    })
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
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    await expect(refundOrder('order_1', 'duplicate')).resolves.toEqual({ ok: true, orderId: 'order_1', amount: 50_000 })

    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      {
        payment_intent: 'pi_1',
        refund_application_fee: true,
        reason: 'duplicate',
        metadata: { order_id: 'order_1', refund_reason: 'duplicate' },
      },
      { stripeAccount: 'acct_club', idempotencyKey: 'refund-order_1-0' },
    )
    // Første forsøk: ingen oppslag av tidligere refusjoner.
    expect(stripeMock.refunds.list).not.toHaveBeenCalled()
    expect(stripeMock).not.toHaveProperty('transfers')
    // Provisjonen ligger på plattformen — ingen stripeAccount.
    expect(stripeMock.applicationFees.retrieve).toHaveBeenCalledWith('fee_1')

    const [orderUpdate] = db.updates('orders')
    expect(orderUpdate.payload).toMatchObject({
      status: 'refunded',
      refund_reason: 'duplicate',
      refunded_amount: 50_000,
      application_fee_refunded_amount: 5_000,
      last_refund_error: null,
    })
    expect(db.updates('tickets')).toHaveLength(1)
    expect(db.updates('tickets')[0].payload).toEqual({ status: 'refunded' })
  })

  it('stores the commission Stripe actually returned, not the full commission', async () => {
    // 30 000 ble refundert i dashbordet uten provisjon. Stripe gir bare en
    // forholdsmessig del av provisjonen tilbake på resten.
    db.queue('orders:select', { data: paidOrder({ refunded_amount: 30_000 }), error: null })
    stripeMock.refunds.create.mockResolvedValue({ id: 're_2', amount: 20_000, status: 'succeeded' })
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 2_000 })

    await refundOrder('order_1', 'customer_request')

    expect(db.updates('orders')[0].payload).toMatchObject({
      refunded_amount: 50_000,
      application_fee_refunded_amount: 2_000,
    })
  })

  it('keeps the recorded commission when the application fee cannot be read', async () => {
    db.queue('orders:select', { data: paidOrder({ application_fee_refunded_amount: 700 }), error: null })
    stripeMock.refunds.create.mockResolvedValue({ id: 're_1', amount: 50_000, status: 'succeeded' })
    stripeMock.applicationFees.retrieve.mockRejectedValue(new Error('timeout'))

    await refundOrder('order_1', 'customer_request')
    expect(db.updates('orders')[0].payload).toMatchObject({ application_fee_refunded_amount: 700 })
  })

  it('marks a pending refund as refunded and warns that it can still fail', async () => {
    db.queue('orders:select', {
      data: paidOrder({ status: 'cancelled', cancellation_reason: 'invalid_show' }),
      error: null,
    })
    stripeMock.refunds.create.mockResolvedValue({ id: 're_1', amount: 50_000, status: 'pending', pending_reason: 'insufficient_funds' })

    await expect(refundOrder('order_1', 'no_ticket_issued')).resolves.toMatchObject({ ok: true })
    expect(stripeMock.refunds.create.mock.calls[0][0]).toMatchObject({ reason: 'requested_by_customer' })
    expect(db.updates('orders')[0].payload).toMatchObject({ status: 'refunded', refund_reason: 'no_ticket_issued' })
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('insufficient_funds'))
  })

  it('does not touch Stripe for an order that is not paid', async () => {
    db.queue('orders:select', { data: paidOrder({ status: 'pending' }), error: null })

    await expect(refundOrder('order_1', 'customer_request')).resolves.toMatchObject({ ok: false })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    expect(db.updates('orders')).toHaveLength(0)
  })

  it('refuses a disputed order with a clear message and without calling Stripe', async () => {
    db.queue('orders:select', { data: paidOrder({ dispute_status: 'needs_response' }), error: null })

    await expect(refundOrder('order_1', 'show_cancelled')).resolves.toEqual({
      ok: false,
      orderId: 'order_1',
      error: DISPUTE_OPEN_MESSAGE,
    })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    expect(db.updates('orders')).toHaveLength(0)
  })

  it('records the failure for a legacy payment without a connected account', async () => {
    db.queue('orders:select', {
      data: paidOrder({ status: 'cancelled', cancellation_reason: 'invalid_show', stripe_connected_account_id: null }),
      error: null,
    })

    const result = await refundOrder('order_1', 'no_ticket_issued')

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('before the club’s Stripe account') })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    expect(db.updates('orders')[0].payload).toEqual({
      refund_attempts: 1,
      last_refund_attempt_at: expect.any(String),
      last_refund_error: expect.stringContaining('before the club’s Stripe account'),
    })
  })

  it('says the money went back when the order cannot be updated afterwards', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    db.queue('orders:update', { data: null, error: { message: 'connection reset' } })
    stripeMock.refunds.create.mockResolvedValue({ id: 're_1', amount: 50_000, status: 'succeeded' })
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

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

  it('records a refund Stripe fails immediately as a failed attempt', async () => {
    db.queue('orders:select', { data: paidOrder({ refund_attempts: 1 }), error: null })
    stripeMock.refunds.list.mockResolvedValue({ data: [] })
    stripeMock.refunds.create.mockResolvedValue({
      id: 're_1',
      amount: 50_000,
      status: 'failed',
      failure_reason: 'lost_or_stolen_card',
    })

    const result = await refundOrder('order_1', 'customer_request')

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('lost_or_stolen_card') })
    expect(db.updates('orders')).toHaveLength(1)
    expect(db.updates('orders')[0].payload).toMatchObject({ refund_attempts: 2 })
    expect(db.updates('orders')[0].payload).not.toHaveProperty('status')
    expect(db.updates('tickets')).toHaveLength(0)
  })

  it('records other Stripe errors as a failed attempt without changing the order status', async () => {
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
    expect(db.updates('orders')[0].payload).toEqual({
      refund_attempts: 1,
      last_refund_attempt_at: expect.any(String),
      last_refund_error: 'Stripe could not refund the payment: Insufficient funds',
    })
  })

  it('explains a payment that does not exist on the club account', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.refunds.create.mockRejectedValue(
      stripeError({ type: 'StripeInvalidRequestError', code: 'resource_missing', message: "No such payment_intent: 'pi_1'" }),
    )

    const result = await refundOrder('order_1', 'customer_request')
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('not found on the club’s Stripe account') })
    expect(db.updates('orders')[0].payload).toMatchObject({ refund_attempts: 1 })
  })

  it('does not count a rate limit as a failed attempt', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.refunds.create.mockRejectedValue(stripeError({ type: 'StripeRateLimitError', message: 'Too many requests' }))

    await expect(refundOrder('order_1', 'customer_request')).resolves.toMatchObject({ ok: false })
    expect(db.updates('orders')[0].payload).not.toHaveProperty('refund_attempts')
  })

  it('maps charge_disputed to the dispute message without counting an attempt', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.refunds.create.mockRejectedValue(
      stripeError({ type: 'StripeInvalidRequestError', code: 'charge_disputed', message: 'Charge ch_1 has been charged back' }),
    )

    await expect(refundOrder('order_1', 'show_cancelled')).resolves.toEqual({
      ok: false,
      orderId: 'order_1',
      error: DISPUTE_OPEN_MESSAGE,
    })
    expect(db.updates('orders')[0].payload).toEqual({ last_refund_attempt_at: expect.any(String) })
  })

  it('does not mark the order refunded after an idempotency conflict on an unrefunded charge', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.refunds.create.mockRejectedValue(
      stripeError({ type: 'StripeIdempotencyError', rawType: 'idempotency_error' }),
    )
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      latest_charge: charge({ amount_refunded: 0, refunded: false }),
    })

    const result = await refundOrder('order_1', 'customer_request')

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('earlier refund attempt') })
    expect(result).not.toMatchObject({ error: expect.stringContaining('being processed') })
    // Bare forsøket registreres — neste forsøk får en ny nøkkel.
    expect(db.updates('orders')).toHaveLength(1)
    expect(db.updates('orders')[0].payload).toMatchObject({ refund_attempts: 1 })
    expect(db.updates('orders')[0].payload).not.toHaveProperty('status')
  })

  it('retries with a new idempotency key after a failed attempt', async () => {
    db.queue('orders:select', { data: paidOrder({ refund_attempts: 2 }), error: null })
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: 're_old', amount: 50_000, status: 'failed' }] })
    stripeMock.refunds.create.mockResolvedValue({ id: 're_2', amount: 50_000, status: 'succeeded' })
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    await expect(refundOrder('order_1', 'customer_request')).resolves.toMatchObject({ ok: true, amount: 50_000 })

    expect(stripeMock.refunds.list).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', limit: 100 },
      { stripeAccount: 'acct_club' },
    )
    expect(stripeMock.refunds.create.mock.calls[0][1]).toEqual({
      stripeAccount: 'acct_club',
      idempotencyKey: 'refund-order_1-2',
    })
  })

  it('syncs instead of creating a second refund when an earlier one still covers the payment', async () => {
    db.queue('orders:select', { data: paidOrder({ refund_attempts: 1 }), error: null })
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: 're_1', amount: 50_000, status: 'pending' }] })
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: charge() })
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    await expect(refundOrder('order_1', 'show_cancelled')).resolves.toEqual({ ok: true, orderId: 'order_1', amount: 0 })

    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    expect(db.updates('orders')[0].payload).toMatchObject({ status: 'refunded', refund_reason: 'show_cancelled' })
  })

  it('still refunds when the earlier refunds cannot be listed', async () => {
    db.queue('orders:select', { data: paidOrder({ refund_attempts: 1 }), error: null })
    stripeMock.refunds.list.mockRejectedValue(new Error('Stripe is down'))
    stripeMock.refunds.create.mockResolvedValue({ id: 're_2', amount: 50_000, status: 'succeeded' })
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    await expect(refundOrder('order_1', 'customer_request')).resolves.toMatchObject({ ok: true })
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1)
  })
})

describe('syncRefundFromCharge', () => {
  it('records a partial refund without touching status or tickets', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.charges.retrieve.mockResolvedValue(charge({ amount_refunded: 10_000, refunded: false }))
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 1_000 })

    await syncRefundFromCharge(charge({ amount_refunded: 10_000, refunded: false }), 'acct_club')

    const [orderUpdate] = db.updates('orders')
    expect(orderUpdate.payload).toEqual({ refunded_amount: 10_000, application_fee_refunded_amount: 1_000 })
    expect(db.updates('tickets')).toHaveLength(0)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('tickets remain valid'))
  })

  it('marks a fully refunded order and its tickets as refunded', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.charges.retrieve.mockResolvedValue(charge())
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    await syncRefundFromCharge(charge(), 'acct_club')

    // Betalingen leses på nytt fra klubbens konto; provisjonen fra plattformen.
    expect(stripeMock.charges.retrieve).toHaveBeenCalledWith('ch_1', {}, { stripeAccount: 'acct_club' })
    expect(stripeMock.applicationFees.retrieve).toHaveBeenCalledWith('fee_1')
    expect(db.updates('orders')[0].payload).toMatchObject({
      status: 'refunded',
      refund_reason: 'other',
      refunded_amount: 50_000,
      application_fee_refunded_amount: 5_000,
    })
    expect(db.updates('tickets')).toHaveLength(1)
  })

  it('uses the live charge, so a late event does not re-mark a refund that has since failed', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.charges.retrieve.mockResolvedValue(charge({ amount_refunded: 0, refunded: false }))
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 0 })

    await syncRefundFromCharge(charge(), 'acct_club')

    expect(db.updates('orders')[0].payload).toEqual({ refunded_amount: 0, application_fee_refunded_amount: 0 })
    expect(db.updates('tickets')).toHaveLength(0)
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
    stripeMock.charges.retrieve.mockResolvedValue(charge())
    stripeMock.applicationFees.retrieve.mockRejectedValue(new Error('rate limited'))

    await syncRefundFromCharge(charge(), 'acct_club')

    const lookups = db.selects('orders')
    expect(lookups[1].calls).toContainEqual(['eq', 'stripe_payment_intent_id', 'pi_1'])
    expect(db.updates('orders')[0].payload).toMatchObject({
      status: 'refunded',
      refund_reason: 'no_ticket_issued',
      application_fee_refunded_amount: 5_000,
    })
  })

  it('never lowers the refunded amount, but takes the commission from Stripe', async () => {
    db.queue('orders:select', { data: paidOrder({ refunded_amount: 20_000, application_fee_refunded_amount: 5_000 }), error: null })
    stripeMock.charges.retrieve.mockResolvedValue(charge({ amount_refunded: 10_000, refunded: false }))
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 1_000 })

    await syncRefundFromCharge(charge({ amount_refunded: 10_000, refunded: false }), 'acct_club')

    expect(db.updates('orders')[0].payload).toEqual({ refunded_amount: 20_000, application_fee_refunded_amount: 1_000 })
  })

  it('ignores charges without an order', async () => {
    await syncRefundFromCharge(charge({ payment_intent: null }), 'acct_club')
    expect(db.updates('orders')).toHaveLength(0)
    expect(stripeMock.charges.retrieve).not.toHaveBeenCalled()
  })

  it('ignores a charge reported by a different account', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    await syncRefundFromCharge(charge(), 'acct_other')
    expect(db.updates('orders')).toHaveLength(0)
  })

  it('throws when the order cannot be updated, so Stripe retries the webhook', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    db.queue('orders:update', { data: null, error: { message: 'timeout' } })
    stripeMock.charges.retrieve.mockResolvedValue(charge())
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    await expect(syncRefundFromCharge(charge(), 'acct_club')).rejects.toThrow(/order_1.*timeout/)
  })

  it('throws when the charge cannot be read, so Stripe retries the webhook', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.charges.retrieve.mockRejectedValue(new Error('api down'))

    await expect(syncRefundFromCharge(charge(), 'acct_club')).rejects.toThrow(/ch_1.*api down/)
    expect(db.updates('orders')).toHaveLength(0)
  })
})

/** Ordren stemmer alt med Stripe: bare en ventende refusjonsstatus ryddes, med vakt. */
function expectOnlyRefundStatusCleared(status: string) {
  const updates = db.updates('orders')
  expect(updates).toHaveLength(1)
  expect(updates[0].payload).toEqual({ refund_status: status })
  expect(updates[0].calls).toContainEqual(['in', 'refund_status', ['pending', 'requires_action']])
}

describe('syncRefundStatus', () => {
  it.each(['pending', 'requires_action'])('does nothing for a %s refund', async (status) => {
    await syncRefundStatus(stripeRefund({ status }), 'acct_club')
    expect(db.queries).toHaveLength(0)
    expect(stripeMock.charges.retrieve).not.toHaveBeenCalled()
  })

  it('marks a pending refund as settled when Stripe reports it succeeded', async () => {
    db.queue('orders:select', { data: refundedOrder({ refund_status: 'pending' }), error: null })
    await syncRefundStatus(stripeRefund({ status: 'succeeded' }), 'acct_club')
    const [update] = db.updates('orders')
    expect(update.payload).toEqual({ refund_status: 'succeeded' })
    expect(update.calls).toContainEqual(['in', 'refund_status', ['pending', 'requires_action']])
    expect(stripeMock.charges.retrieve).not.toHaveBeenCalled()
  })

  it('reverts a refunded order when Stripe fails the refund, and alerts', async () => {
    db.queue('orders:select', { data: refundedOrder(), error: null })
    stripeMock.charges.retrieve.mockResolvedValue(charge({ amount_refunded: 0, refunded: false }))
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    await syncRefundStatus(stripeRefund(), 'acct_club')

    expect(stripeMock.charges.retrieve).toHaveBeenCalledWith('ch_1', {}, { stripeAccount: 'acct_club' })
    const [update] = db.updates('orders')
    expect(update.payload).toMatchObject({
      status: 'paid',
      refunded_at: null,
      refund_reason: null,
      refunded_amount: 0,
      application_fee_refunded_amount: 5_000,
      refund_attempts: 1,
      last_refund_error: expect.stringContaining('expired_or_canceled_card'),
    })
    // Bare én av refund.failed / refund.updated / charge.refund.updated teller.
    expect(update.calls).toEqual(
      expect.arrayContaining([
        ['eq', 'id', 'order_1'],
        ['eq', 'status', 'refunded'],
        ['not', 'refunded_at', 'is', null],
      ]),
    )
    // Billettene på et avlyst show skal ikke bli gyldige igjen.
    expect(db.updates('tickets')).toHaveLength(0)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('ALERT'))
  })

  it('puts an order without tickets back in the refund queue', async () => {
    db.queue('orders:select', { data: refundedOrder({ cancellation_reason: 'sold_out' }), error: null })
    stripeMock.charges.retrieve.mockResolvedValue(charge({ amount_refunded: 0, refunded: false }))
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 0 })

    await syncRefundStatus(stripeRefund({ status: 'canceled', failure_reason: undefined }), 'acct_club')

    expect(db.updates('orders')[0].payload).toMatchObject({ status: 'cancelled', refunded_at: null, refund_attempts: 1 })
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('back in the refund queue'))
  })

  it('finds the order through the refund metadata when it matches the payment', async () => {
    db.queue('orders:select', { data: refundedOrder({ id: ORDER_UUID }), error: null })
    stripeMock.charges.retrieve.mockResolvedValue(charge({ amount_refunded: 0, refunded: false }))
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 0 })

    await syncRefundStatus(stripeRefund({ metadata: { order_id: ORDER_UUID } }), 'acct_club')

    expect(db.selects('orders')[0].calls).toContainEqual(['eq', 'id', ORDER_UUID])
    expect(db.updates('orders')[0].calls).toContainEqual(['eq', 'id', ORDER_UUID])
  })

  it('leaves the order alone while other refunds still cover the payment', async () => {
    db.queue('orders:select', { data: refundedOrder(), error: null })
    stripeMock.charges.retrieve.mockResolvedValue(charge())
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    await syncRefundStatus(stripeRefund(), 'acct_club')
    expectOnlyRefundStatusCleared('failed')
  })

  it('does not count the same failure twice once the order is reverted', async () => {
    db.queue('orders:select', { data: paidOrder({ refund_attempts: 1 }), error: null })
    stripeMock.charges.retrieve.mockResolvedValue(charge({ amount_refunded: 0, refunded: false }))
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 0 })

    await syncRefundStatus(stripeRefund(), 'acct_club')
    expectOnlyRefundStatusCleared('failed')
  })

  it('keeps the order refunded when the buyer got the money through a lost dispute', async () => {
    db.queue('orders:select', { data: refundedOrder({ dispute_status: 'lost', refund_reason: 'dispute_lost' }), error: null })

    await syncRefundStatus(stripeRefund({ failure_reason: 'charge_for_pending_refund_disputed' }), 'acct_club')

    expect(stripeMock.charges.retrieve).not.toHaveBeenCalled()
    expect(db.updates('orders')).toHaveLength(0)
  })

  it('ignores a refund reported by a different account', async () => {
    db.queue('orders:select', { data: refundedOrder(), error: null })
    await syncRefundStatus(stripeRefund(), 'acct_other')
    expect(db.updates('orders')).toHaveLength(0)
  })

  it('throws when the order cannot be updated, so Stripe retries the webhook', async () => {
    db.queue('orders:select', { data: refundedOrder(), error: null })
    db.queue('orders:update', { data: null, error: { message: 'deadlock' } })
    stripeMock.charges.retrieve.mockResolvedValue(charge({ amount_refunded: 0, refunded: false }))
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 0 })

    await expect(syncRefundStatus(stripeRefund(), 'acct_club')).rejects.toThrow(/re_1.*order_1.*deadlock/)
  })
})

describe('syncDisputeFromStripe', () => {
  it('records an open dispute from the live dispute', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.disputes.retrieve.mockResolvedValue(stripeDispute({ status: 'under_review' }))

    await syncDisputeFromStripe(stripeDispute(), 'acct_club')

    expect(stripeMock.disputes.retrieve).toHaveBeenCalledWith('dp_1', {}, { stripeAccount: 'acct_club' })
    expect(db.updates('orders')[0].payload).toEqual({
      dispute_status: 'under_review',
      dispute_net_amount: 0,
      disputed_at: new Date(1_789_000_000 * 1000).toISOString(),
    })
    expect(db.updates('tickets')).toHaveLength(0)
  })

  it('closes the order as refunded when the dispute is lost, even from a late created event', async () => {
    db.queue('orders:select', { data: paidOrder({ dispute_status: 'under_review', disputed_at: NOW }), error: null })
    stripeMock.disputes.retrieve.mockResolvedValue(stripeDispute({ status: 'lost' }))

    await syncDisputeFromStripe(stripeDispute({ status: 'needs_response' }), 'acct_club')

    expect(db.updates('orders')[0].payload).toMatchObject({
      dispute_status: 'lost',
      status: 'refunded',
      refund_reason: 'dispute_lost',
    })
    expect(db.updates('orders')[0].payload).not.toHaveProperty('refunded_amount')
    expect(db.updates('tickets')).toHaveLength(1)
    expect(db.updates('tickets')[0].payload).toEqual({ status: 'refunded' })
  })

  it('falls back to the payment intent when the charge id is not stored', async () => {
    db.queue('orders:select', { data: null, error: null })
    db.queue('orders:select', { data: paidOrder({ stripe_charge_id: null }), error: null })
    stripeMock.disputes.retrieve.mockResolvedValue(stripeDispute())

    await syncDisputeFromStripe(stripeDispute(), 'acct_club')

    expect(db.selects('orders')[1].calls).toContainEqual(['eq', 'stripe_payment_intent_id', 'pi_1'])
    expect(db.updates('orders')).toHaveLength(1)
  })

  it('ignores disputes without an order or from another account', async () => {
    await syncDisputeFromStripe(stripeDispute(), 'acct_club')
    db.queue('orders:select', { data: paidOrder(), error: null })
    await syncDisputeFromStripe(stripeDispute(), 'acct_other')

    expect(stripeMock.disputes.retrieve).not.toHaveBeenCalled()
    expect(db.updates('orders')).toHaveLength(0)
  })

  it('throws when the dispute cannot be read, so Stripe retries the webhook', async () => {
    db.queue('orders:select', { data: paidOrder(), error: null })
    stripeMock.disputes.retrieve.mockRejectedValue(new Error('api down'))

    await expect(syncDisputeFromStripe(stripeDispute(), 'acct_club')).rejects.toThrow(/dp_1.*api down/)
    expect(db.updates('orders')).toHaveLength(0)
  })
})

describe('refundShow', () => {
  const showOrders = [
    { id: 'order_1', status: 'paid', stripe_payment_intent_id: 'pi_1', refunded_at: null },
    { id: 'order_2', status: 'cancelled', stripe_payment_intent_id: 'pi_2', refunded_at: null },
  ]

  it('refunds paid and awaiting orders and reports open disputes as failures', async () => {
    db.queue('orders:select', { data: showOrders, error: null })
    db.queue('orders:select', { data: paidOrder(), error: null })
    db.queue('orders:select', {
      data: paidOrder({ id: 'order_2', status: 'cancelled', cancellation_reason: 'sold_out', dispute_status: 'needs_response' }),
      error: null,
    })
    stripeMock.refunds.create.mockResolvedValue({ id: 're_1', amount: 50_000, status: 'succeeded' })
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    const result = await refundShow('show_1')

    expect(result).toEqual({
      total: 2,
      refunded: 1,
      failed: 1,
      errors: [`Order order_2: ${DISPUTE_OPEN_MESSAGE}`],
      remaining: 0,
    })
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1)
    expect(stripeMock.refunds.create.mock.calls[0][0]).toMatchObject({ metadata: { refund_reason: 'show_cancelled' } })
  })

  it('stops starting new refunds after the deadline and reports what is left', async () => {
    db.queue('orders:select', { data: showOrders, error: null })

    await expect(refundShow('show_1', { deadline: Date.now() - 1 })).resolves.toEqual({
      total: 2,
      refunded: 0,
      failed: 0,
      errors: [],
      remaining: 2,
    })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })
})

describe('processRefundQueue', () => {
  const queueRow = (id: string) => ({ id, stripe_connected_account_id: 'acct_club', refund_attempts: 0, dispute_status: null })

  it('refunds orders paid without a ticket and counts the outcome', async () => {
    db.queue('orders:select', { data: [queueRow('order_1'), queueRow('order_2')], error: null })
    db.queue('orders:select', { data: paidOrder({ status: 'cancelled', cancellation_reason: 'sold_out' }), error: null })
    db.queue('orders:select', {
      data: paidOrder({ id: 'order_2', status: 'cancelled', cancellation_reason: 'sales_closed' }),
      error: null,
    })
    stripeMock.refunds.create
      .mockResolvedValueOnce({ id: 're_1', amount: 50_000, status: 'succeeded' })
      .mockRejectedValueOnce(stripeError({ type: 'StripeAPIError', message: 'Internal error' }))
    stripeMock.applicationFees.retrieve.mockResolvedValue({ amount_refunded: 5_000 })

    await expect(processRefundQueue({ minAgeMinutes: 10, limit: 20 })).resolves.toEqual({
      processed: 2,
      refunded: 1,
      failed: 1,
      deferred: 0,
    })

    const [queueQuery] = db.queries
    expect(queueQuery.calls).toEqual(
      expect.arrayContaining([
        ['eq', 'status', 'cancelled'],
        ['not', 'stripe_payment_intent_id', 'is', null],
        ['not', 'stripe_connected_account_id', 'is', null],
        ['is', 'refunded_at', null],
        ['lt', 'refund_attempts', 5],
        ['or', 'dispute_status.is.null,dispute_status.in.(won,lost,warning_closed,prevented)'],
        ['order', 'last_refund_attempt_at', { ascending: true, nullsFirst: true }],
        ['limit', 20],
      ]),
    )
    // Sist forsøkt for lengst siden først, deretter eldst.
    const orderCalls = queueQuery.calls.filter(([name]) => name === 'order')
    expect(orderCalls.map(([, column]) => column)).toEqual(['last_refund_attempt_at', 'created_at'])

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(2)
    // Den feilede ordren får forsøket registrert, så neste kjøring får ny nøkkel.
    const failedAttempt = db.updates('orders').find((update) => (update.payload as { refund_attempts?: number }).refund_attempts === 1)
    expect(failedAttempt?.calls).toContainEqual(['eq', 'id', 'order_2'])
  })

  it('skips rows the query should have excluded', async () => {
    db.queue('orders:select', {
      data: [
        { ...queueRow('order_1'), refund_attempts: 5 },
        { ...queueRow('order_2'), stripe_connected_account_id: null },
        { ...queueRow('order_3'), dispute_status: 'needs_response' },
      ],
      error: null,
    })

    await expect(processRefundQueue()).resolves.toEqual({ processed: 0, refunded: 0, failed: 0, deferred: 0 })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('defers the rest of the queue after the deadline', async () => {
    db.queue('orders:select', { data: [queueRow('order_1'), queueRow('order_2')], error: null })

    await expect(processRefundQueue({ deadline: Date.now() - 1 })).resolves.toEqual({
      processed: 0,
      refunded: 0,
      failed: 0,
      deferred: 2,
    })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  it('alerts about orders the queue has given up on', async () => {
    db.queue('orders:select', { data: [], error: null })
    db.queue('orders:select', { data: null, error: null, count: 3 })

    await processRefundQueue()

    const abandoned = db.selects('orders')[1]
    expect(abandoned.calls).toContainEqual(['gte', 'refund_attempts', 5])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('3 paid orders without tickets'))
  })

  it('throws when the queue cannot be read', async () => {
    db.queue('orders:select', { data: null, error: { message: 'down' } })
    await expect(processRefundQueue()).rejects.toThrow(/refund queue: down/)
  })
})

describe('checkout charge facts', () => {
  describe('applicationFeeFromMetadata', () => {
    it('reads the commission stored on the session', () => {
      expect(applicationFeeFromMetadata({ application_fee_amount: '5000' })).toBe(5_000)
      expect(applicationFeeFromMetadata({ application_fee_amount: '0' })).toBe(0)
    })

    it.each([undefined, '', ' ', '-1', '12.5', 'abc', '5000abc'])('ignores %s', (value) => {
      expect(applicationFeeFromMetadata(value === undefined ? {} : { application_fee_amount: value })).toBeNull()
    })

    it('handles a session without metadata', () => {
      expect(applicationFeeFromMetadata(null)).toBeNull()
    })
  })

  describe('chargeFactsRepair', () => {
    const facts = {
      chargeId: 'ch_1',
      applicationFeeId: 'fee_1',
      applicationFeeAmount: 5_000,
      paymentMethodType: 'card',
    }
    const brokenOrder = (overrides: Record<string, unknown> = {}) => ({
      amount_total: 50_000,
      gross_amount: 50_000,
      cancellation_reason: null,
      stripe_charge_id: null,
      stripe_application_fee_id: null,
      platform_fee_amount: null,
      club_net_amount: null,
      payment_method_type: null,
      stripe_fee_status: 'not_applicable',
      ...overrides,
    })

    it('fills in the charge, the commission and the club’s share of an order with tickets', () => {
      expect(chargeFactsRepair(brokenOrder() as never, facts)).toEqual({
        stripe_charge_id: 'ch_1',
        stripe_application_fee_id: 'fee_1',
        payment_method_type: 'card',
        platform_fee_amount: 5_000,
        club_net_amount: 45_000,
        stripe_fee_status: 'pending',
      })
    })

    it('uses the commission already on the order', () => {
      expect(
        chargeFactsRepair(brokenOrder({ platform_fee_amount: 4_000, stripe_fee_status: 'pending' }) as never, facts),
      ).toEqual({
        stripe_charge_id: 'ch_1',
        stripe_application_fee_id: 'fee_1',
        payment_method_type: 'card',
        club_net_amount: 46_000,
      })
    })

    it('gives an order without tickets no club share', () => {
      const update = chargeFactsRepair(brokenOrder({ cancellation_reason: 'sold_out' }) as never, facts)
      expect(update).toMatchObject({ stripe_charge_id: 'ch_1', platform_fee_amount: 5_000 })
      expect(update).not.toHaveProperty('club_net_amount')
    })

    it('never overwrites what the order already has, and leaves reconciled fees alone', () => {
      expect(
        chargeFactsRepair(
          brokenOrder({
            stripe_charge_id: 'ch_1',
            stripe_application_fee_id: 'fee_1',
            platform_fee_amount: 5_000,
            club_net_amount: 45_000,
            payment_method_type: 'card',
            stripe_fee_status: 'reconciled',
          }) as never,
          { ...facts, chargeId: 'ch_other', applicationFeeAmount: 1 },
        ),
      ).toBeNull()
    })
  })

  describe('repairMissingChargeFacts', () => {
    const repairRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'order_1',
      status: 'paid',
      stripe_payment_intent_id: 'pi_1',
      stripe_connected_account_id: 'acct_club',
      amount_total: 50_000,
      gross_amount: 50_000,
      cancellation_reason: null,
      stripe_charge_id: null,
      stripe_application_fee_id: null,
      platform_fee_amount: null,
      club_net_amount: null,
      payment_method_type: null,
      stripe_fee_status: 'pending',
      ...overrides,
    })

    it('reads the payment on the club account and fills in the order', async () => {
      db.queue('orders:select', { data: [repairRow()], error: null })
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        application_fee_amount: 5_000,
        latest_charge: {
          id: 'ch_1',
          application_fee: 'fee_1',
          application_fee_amount: 5_000,
          payment_method_details: { type: 'klarna' },
        },
      })

      await expect(repairMissingChargeFacts({ limit: 10 })).resolves.toEqual({ checked: 1, repaired: 1, failed: 0 })

      expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith(
        'pi_1',
        { expand: ['latest_charge'] },
        { stripeAccount: 'acct_club' },
      )
      const [select] = db.selects('orders')
      expect(select.calls).toEqual(
        expect.arrayContaining([
          ['in', 'status', ['paid', 'cancelled', 'refunded']],
          ['not', 'stripe_connected_account_id', 'is', null],
          ['or', 'stripe_charge_id.is.null,platform_fee_amount.is.null'],
          ['limit', 10],
        ]),
      )
      const [update] = db.updates('orders')
      expect(update.payload).toEqual({
        stripe_charge_id: 'ch_1',
        stripe_application_fee_id: 'fee_1',
        payment_method_type: 'klarna',
        platform_fee_amount: 5_000,
        club_net_amount: 45_000,
      })
      expect(update.calls).toEqual(
        expect.arrayContaining([
          ['is', 'stripe_charge_id', null],
          ['is', 'platform_fee_amount', null],
        ]),
      )
    })

    it('counts orders it cannot repair and moves on', async () => {
      db.queue('orders:select', { data: [repairRow(), repairRow({ id: 'order_2', stripe_payment_intent_id: 'pi_2' })], error: null })
      stripeMock.paymentIntents.retrieve
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValueOnce({ latest_charge: null })

      await expect(repairMissingChargeFacts()).resolves.toEqual({ checked: 2, repaired: 0, failed: 2 })
      expect(db.updates('orders')).toHaveLength(0)
    })

    it('stops at the deadline', async () => {
      db.queue('orders:select', { data: [repairRow()], error: null })
      await expect(repairMissingChargeFacts({ deadline: Date.now() - 1 })).resolves.toEqual({
        checked: 0,
        repaired: 0,
        failed: 0,
      })
      expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled()
    })
  })
})
