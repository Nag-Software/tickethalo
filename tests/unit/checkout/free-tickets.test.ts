// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Gratisbilletter mot en falsk database. Det som testes er at ordren aldri
 * får et beløp eller en Stripe-referanse, at én adresse får én ordre per
 * show, og at et utsolgt show stoppes før noen ordre skrives.
 */

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  show: null as Row | null,
  soldTickets: 0,
  rpcResults: [] as Row[],
  rpcCalls: [] as Row[],
  deletedOrders: [] as Row[],
}))

const deliverTicketEmail = vi.hoisted(() => vi.fn())

vi.mock('@/lib/checkout/finalize', () => ({ deliverTicketEmail }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      const filters: Row = {}
      let deleting = false
      const builder = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters[column] = value
          return builder
        },
        in: () => builder,
        delete() {
          deleting = true
          return builder
        },
        single: async () => {
          if (table === 'shows') return { data: state.show, error: state.show ? null : { message: 'not found' } }
          throw new Error(`unexpected single() on ${table}`)
        },
        then(resolve: (value: unknown) => void) {
          if (table === 'tickets') return resolve({ count: state.soldTickets, error: null })
          if (table === 'orders' && deleting) {
            state.deletedOrders.push(filters)
            return resolve({ error: null })
          }
          throw new Error(`unexpected await on ${table}`)
        },
      }
      return builder
    },
    rpc(name: string, args: Row) {
      state.rpcCalls.push({ name, ...args })
      const next = state.rpcResults.shift() ?? { result: 'created', order_id: 'order_1', ticket_codes: ['T1'] }
      return { single: async () => ({ data: next, error: null }) }
    },
  }),
}))

import { CheckoutError } from '@/lib/checkout/errors'
import { claimFreeTickets, freeOrderSessionId, isFreeOrderSessionId, parseFreeTicketInput } from '@/lib/checkout/free'

function openShow(overrides: Row = {}): Row {
  const date = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return {
    id: 'show_1',
    title: 'Open Mic',
    slug: 'open-mic',
    date,
    start_time: '20:00:00',
    ticket_price: 0,
    currency: 'NOK',
    capacity: 50,
    status: 'published',
    club_id: 'club_1',
    ticket_sales_closed_at: null,
    deleted_at: null,
    ...overrides,
  }
}

const input = { quantity: 2, email: 'Ada@Example.com', name: 'Ada' }

async function checkoutError(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (reason: unknown) => reason)
  expect(error).toBeInstanceOf(CheckoutError)
  return error as CheckoutError
}

beforeEach(() => {
  state.show = openShow()
  state.soldTickets = 0
  state.rpcResults = []
  state.rpcCalls = []
  state.deletedOrders = []
  deliverTicketEmail.mockReset()
  deliverTicketEmail.mockResolvedValue({ emailSent: true })
})

describe('claimFreeTickets', () => {
  it('writes an order with no amount and no Stripe reference, then emails the tickets', async () => {
    state.rpcResults = [{ result: 'created', order_id: 'order_1', ticket_codes: ['T1', 'T2'] }]

    const claim = await claimFreeTickets('show_1', 'https://tickethalo.com', input)

    expect(claim).toEqual({ orderId: 'order_1', ticketCodes: ['T1', 'T2'], result: 'created', emailSent: true })
    expect(state.rpcCalls).toHaveLength(1)
    expect(state.rpcCalls[0]).toMatchObject({
      name: 'complete_checkout_order',
      p_show_id: 'show_1',
      p_session_id: freeOrderSessionId('show_1', input.email),
      p_amount_total: 0,
      p_platform_fee_amount: 0,
      p_currency: 'NOK',
      p_buyer_email: 'Ada@Example.com',
      p_buyer_name: 'Ada',
      p_club_id: 'club_1',
      p_quantity: 2,
      p_ticket_names: [],
    })
    expect(state.rpcCalls[0]).not.toHaveProperty('p_payment_intent_id')
    expect(state.rpcCalls[0]).not.toHaveProperty('p_connected_account_id')

    expect(deliverTicketEmail).toHaveBeenCalledTimes(1)
    expect(deliverTicketEmail.mock.calls[0][0]).toMatchObject({
      orderId: 'order_1',
      result: 'created',
      showId: 'show_1',
      clubId: 'club_1',
      buyerEmail: 'Ada@Example.com',
      buyerName: 'Ada',
      ticketCodes: ['T1', 'T2'],
      origin: 'https://tickethalo.com',
      free: true,
    })
  })

  it('stops a sold-out show before any order is written', async () => {
    state.soldTickets = 49

    const error = await checkoutError(claimFreeTickets('show_1', 'https://tickethalo.com', input))

    expect(error.code).toBe('sold_out')
    expect(state.rpcCalls).toHaveLength(0)
    expect(deliverTicketEmail).not.toHaveBeenCalled()
  })

  it('lets an unlimited show through without counting against a capacity', async () => {
    state.show = openShow({ capacity: null })
    state.soldTickets = 10_000

    await expect(claimFreeTickets('show_1', 'https://tickethalo.com', input)).resolves.toMatchObject({ result: 'created' })
  })

  it('refuses a show that is not free', async () => {
    state.show = openShow({ ticket_price: 20_000 })

    const error = await checkoutError(claimFreeTickets('show_1', 'https://tickethalo.com', input))

    expect(error.code).toBe('unknown')
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('refuses a show whose sales are closed, like paid checkout does', async () => {
    state.show = openShow({ ticket_sales_closed_at: '2026-01-01T00:00:00Z' })

    const error = await checkoutError(claimFreeTickets('show_1', 'https://tickethalo.com', input))

    expect(error.code).toBe('sales_closed')
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('re-sends the tickets an address already has instead of issuing more', async () => {
    state.rpcResults = [{ result: 'duplicate', order_id: 'order_1', ticket_codes: ['T1', 'T2'] }]

    const claim = await claimFreeTickets('show_1', 'https://tickethalo.com', input)

    expect(claim).toMatchObject({ orderId: 'order_1', result: 'duplicate', ticketCodes: ['T1', 'T2'] })
    expect(state.rpcCalls).toHaveLength(1)
    expect(deliverTicketEmail.mock.calls[0][0]).toMatchObject({ result: 'duplicate' })
  })

  it('clears a cancelled free order from an earlier attempt and tries once more', async () => {
    state.rpcResults = [
      { result: 'duplicate', order_id: 'order_stale', ticket_codes: null, ticket_code: null },
      { result: 'created', order_id: 'order_2', ticket_codes: ['T9'] },
    ]

    const claim = await claimFreeTickets('show_1', 'https://tickethalo.com', input)

    expect(claim).toMatchObject({ orderId: 'order_2', result: 'created', ticketCodes: ['T9'] })
    expect(state.deletedOrders).toEqual([
      {
        id: 'order_stale',
        stripe_checkout_session_id: freeOrderSessionId('show_1', input.email),
        status: 'cancelled',
        amount_total: 0,
      },
    ])
    expect(state.rpcCalls).toHaveLength(2)
  })

  it('turns a sold-out answer from the database into the same error paid checkout gives', async () => {
    state.rpcResults = [{ result: 'sold_out', order_id: 'order_x', ticket_codes: null }]

    const error = await checkoutError(claimFreeTickets('show_1', 'https://tickethalo.com', input))

    expect(error.code).toBe('sold_out')
    expect(deliverTicketEmail).not.toHaveBeenCalled()
  })

  it('reports when the email could not be sent, without failing the reservation', async () => {
    deliverTicketEmail.mockResolvedValue({ emailSent: false, emailError: 'smtp down' })

    const claim = await claimFreeTickets('show_1', 'https://tickethalo.com', input)

    expect(claim.emailSent).toBe(false)
    expect(claim.ticketCodes).toEqual(['T1'])
  })
})

describe('freeOrderSessionId', () => {
  it('is the same for the same address regardless of case and spacing', () => {
    expect(freeOrderSessionId('show_1', 'Ada@Example.com')).toBe(freeOrderSessionId('show_1', '  ada@example.com '))
    expect(freeOrderSessionId('show_1', 'ada@example.com')).not.toBe(freeOrderSessionId('show_2', 'ada@example.com'))
    expect(freeOrderSessionId('show_1', 'ada@example.com')).not.toBe(freeOrderSessionId('show_1', 'bo@example.com'))
  })

  it('is recognisable as a free order, unlike a Stripe session', () => {
    expect(isFreeOrderSessionId(freeOrderSessionId('show_1', 'ada@example.com'))).toBe(true)
    expect(isFreeOrderSessionId('cs_test_123')).toBe(false)
    expect(isFreeOrderSessionId(null)).toBe(false)
  })
})

describe('parseFreeTicketInput', () => {
  function form(fields: Record<string, string>) {
    const data = new FormData()
    for (const [name, value] of Object.entries(fields)) data.set(name, value)
    return data
  }

  it('needs a name and a plausible email', () => {
    expect(parseFreeTicketInput(form({ quantity: '3', buyer_name: ' Ada ', buyer_email: ' ada@example.com ' }))).toEqual({
      ok: true,
      value: { quantity: 3, email: 'ada@example.com', name: 'Ada' },
    })
    expect(parseFreeTicketInput(form({ buyer_name: '', buyer_email: 'ada@example.com' }))).toEqual({ ok: false })
    expect(parseFreeTicketInput(form({ buyer_name: 'Ada', buyer_email: 'not-an-email' }))).toEqual({ ok: false })
    expect(parseFreeTicketInput(form({ buyer_name: 'Ada', buyer_email: 'ada@example' }))).toEqual({ ok: false })
  })

  it('keeps the quantity within one order', () => {
    expect(parseFreeTicketInput(form({ quantity: '99', buyer_name: 'Ada', buyer_email: 'ada@example.com' }))).toMatchObject({
      value: { quantity: 10 },
    })
    expect(parseFreeTicketInput(form({ quantity: '0', buyer_name: 'Ada', buyer_email: 'ada@example.com' }))).toMatchObject({
      value: { quantity: 1 },
    })
  })
})
