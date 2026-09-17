// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `createCheckoutSession` mot falske Stripe- og Supabase-klienter.
 *
 * Det som testes er pengene: at beløpet Stripe belaster alltid er showets pris
 * nå, at provisjonen regnes av det samme beløpet, og at klubber uten kjent
 * utbetalingsplan får den slått opp før klarheten avgjøres.
 */

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({
  show: null as Row | null,
  club: null as Row | null,
  soldTickets: 0,
  showUpdates: [] as Row[],
}))

const stripeMock = vi.hoisted(() => ({
  products: { create: vi.fn() },
  prices: { create: vi.fn() },
  checkout: { sessions: { create: vi.fn() } },
}))

const ensureKnown = vi.hoisted(() => vi.fn())

vi.mock('@/lib/stripe', () => ({ stripe: stripeMock }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from(table: string) {
      let update: Row | null = null
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        update(values: Row) {
          update = values
          return builder
        },
        single: async () => {
          if (table === 'shows') return { data: state.show, error: state.show ? null : { message: 'not found' } }
          if (table === 'clubs') return { data: state.club, error: null }
          throw new Error(`unexpected single() on ${table}`)
        },
        then(resolve: (value: unknown) => void) {
          if (table === 'tickets') return resolve({ count: state.soldTickets, error: null })
          if (table === 'shows' && update) {
            state.showUpdates.push(update)
            return resolve({ error: null })
          }
          throw new Error(`unexpected await on ${table}`)
        },
      }
      return builder
    },
  }),
}))

vi.mock('@/lib/stripe-connect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/stripe-connect')>()),
  ensureClubPayoutScheduleKnown: ensureKnown,
}))

import { createCheckoutSession } from '@/lib/actions/checkout'
import { CheckoutError } from '@/lib/checkout/errors'

const readyClub = (overrides: Row = {}): Row => ({
  id: 'club_1',
  name: 'Comedy Club',
  slug: 'comedy-club',
  currency: 'NOK',
  legal_name: 'Comedy AS',
  org_number: '123456789',
  support_email: 'club@example.com',
  invoice_email: null,
  stripe_account_id: 'acct_club',
  charges_enabled: true,
  payouts_enabled: true,
  onboarding_completed_at: '2026-01-01T00:00:00Z',
  platform_fee_bps: 1000,
  commission_vat_bps: 2500,
  payout_hold_days: 7,
  payout_schedule_interval: 'manual',
  ...overrides,
})

/** Et show innenfor salgsvinduet, uansett når testen kjøres. */
function openShow(overrides: Row = {}): Row {
  const date = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return {
    id: 'show_1',
    title: 'Friday Laughs',
    slug: 'friday-laughs',
    date,
    start_time: '20:00:00',
    ticket_price: 30_000,
    currency: 'NOK',
    stripe_product_id: 'prod_cached',
    // En gammel pris fra før endringen. Den skal aldri brukes igjen.
    stripe_price_id: 'price_stale_25000',
    capacity: 100,
    status: 'published',
    club_id: 'club_1',
    ticket_sales_closed_at: null,
    deleted_at: null,
    ...overrides,
  }
}

function sessionParams(call = 0) {
  return stripeMock.checkout.sessions.create.mock.calls[call][0]
}

async function checkoutError(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  )
  expect(error).toBeInstanceOf(CheckoutError)
  return error as CheckoutError
}

beforeEach(() => {
  vi.clearAllMocks()
  state.show = openShow()
  state.club = readyClub()
  state.soldTickets = 0
  state.showUpdates = []
  ensureKnown.mockImplementation(async (club: Row) => club)
  stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' })
  stripeMock.products.create.mockResolvedValue({ id: 'prod_new' })
})

describe('createCheckoutSession — amount and commission', () => {
  it('charges the current ticket price with an inline price and never reuses a cached price', async () => {
    const result = await createCheckoutSession('show_1', 'https://tickethalo.no/events/friday-laughs', {
      quantity: 3,
      holderNames: ['Ada', '', 'Bo'],
    })

    expect(result).toEqual({ url: 'https://checkout.stripe.com/cs_1', sessionId: 'cs_1' })
    expect(stripeMock.prices.create).not.toHaveBeenCalled()
    expect(stripeMock.products.create).not.toHaveBeenCalled()

    const [params, options] = stripeMock.checkout.sessions.create.mock.calls[0]
    expect(options).toEqual({ stripeAccount: 'acct_club' })
    expect(params.line_items).toEqual([
      { quantity: 3, price_data: { currency: 'nok', unit_amount: 30_000, product: 'prod_cached' } },
    ])
    expect(JSON.stringify(params)).not.toContain('price_stale_25000')

    // 10 % av 300 kr, ganger tre billetter — av samme beløp som belastes.
    expect(params.payment_intent_data.application_fee_amount).toBe(9_000)
    expect(params.metadata).toMatchObject({
      application_fee_amount: '9000',
      quantity: '3',
      ticket_name_1: 'Ada',
      ticket_name_3: 'Bo',
    })
    expect(params.metadata).not.toHaveProperty('ticket_name_2')
    expect(state.showUpdates).toEqual([])
  })

  it('follows a changed currency on the show', async () => {
    state.show = openShow({ ticket_price: 4_500, currency: 'SEK' })
    await createCheckoutSession('show_1', 'https://tickethalo.no/events/x')

    expect(sessionParams().line_items[0].price_data).toMatchObject({ currency: 'sek', unit_amount: 4_500 })
    expect(sessionParams().payment_intent_data.application_fee_amount).toBe(450)
  })

  it('gives the session more than 30 minutes, with room for SDK retries', async () => {
    const before = Math.floor(Date.now() / 1000)
    await createCheckoutSession('show_1', 'https://tickethalo.no/events/x')
    const after = Math.floor(Date.now() / 1000)

    const ttl = sessionParams().expires_at
    expect(ttl).toBeGreaterThanOrEqual(before + 35 * 60)
    expect(ttl).toBeLessThanOrEqual(after + 35 * 60)
  })
})

describe('createCheckoutSession — product on the club account', () => {
  it('creates and remembers a product when the show has none', async () => {
    state.show = openShow({ stripe_product_id: null })
    await createCheckoutSession('show_1', 'https://tickethalo.no/events/x')

    expect(stripeMock.products.create).toHaveBeenCalledWith(
      { name: 'Friday Laughs', metadata: { show_id: 'show_1', event_slug: 'friday-laughs' } },
      { stripeAccount: 'acct_club' },
    )
    expect(sessionParams().line_items[0].price_data.product).toBe('prod_new')
    expect(state.showUpdates).toEqual([{ stripe_product_id: 'prod_new' }])
  })

  it('replaces a cached product the club account does not know, once', async () => {
    stripeMock.checkout.sessions.create
      .mockRejectedValueOnce({
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        message: "No such product: 'prod_cached'",
      })
      .mockResolvedValueOnce({ id: 'cs_2', url: 'https://checkout.stripe.com/cs_2' })

    const result = await createCheckoutSession('show_1', 'https://tickethalo.no/events/x')

    expect(result.sessionId).toBe('cs_2')
    expect(stripeMock.products.create).toHaveBeenCalledTimes(1)
    expect(sessionParams(1).line_items[0].price_data.product).toBe('prod_new')
    expect(state.showUpdates).toEqual([{ stripe_product_id: 'prod_new' }])
  })

  it('does not retry other Stripe errors', async () => {
    stripeMock.checkout.sessions.create.mockRejectedValueOnce({
      type: 'StripeInvalidRequestError',
      code: 'parameter_invalid',
      message: 'Something else',
    })

    const error = await checkoutError(createCheckoutSession('show_1', 'https://tickethalo.no/events/x'))
    expect(error.code).toBe('stripe_config')
    expect(stripeMock.products.create).not.toHaveBeenCalled()
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })
})

describe('createCheckoutSession — club readiness', () => {
  it('looks up an unknown payout schedule before deciding, so older clubs can sell', async () => {
    state.club = readyClub({ payout_schedule_interval: null })
    ensureKnown.mockImplementation(async (club: Row) => ({ ...club, payout_schedule_interval: 'manual' }))

    await createCheckoutSession('show_1', 'https://tickethalo.no/events/x')

    expect(ensureKnown).toHaveBeenCalledWith(expect.objectContaining({ id: 'club_1', payout_schedule_interval: null }))
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })

  it('refuses when Stripe confirms a schedule that is not manual', async () => {
    state.club = readyClub({ payout_schedule_interval: null })
    ensureKnown.mockImplementation(async (club: Row) => ({ ...club, payout_schedule_interval: 'daily' }))

    const error = await checkoutError(createCheckoutSession('show_1', 'https://tickethalo.no/events/x'))
    expect(error.code).toBe('club_not_payable')
    expect(error.detail).toContain('schedule=daily')
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('refuses a show without a price before touching Stripe', async () => {
    state.show = openShow({ ticket_price: 0 })

    const error = await checkoutError(createCheckoutSession('show_1', 'https://tickethalo.no/events/x'))
    expect(error.code).toBe('price_missing')
    expect(ensureKnown).not.toHaveBeenCalled()
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('refuses an order that does not fit in the remaining capacity', async () => {
    state.soldTickets = 99

    const error = await checkoutError(
      createCheckoutSession('show_1', 'https://tickethalo.no/events/x', { quantity: 2, holderNames: [] }),
    )
    expect(error.code).toBe('sold_out')
  })
})
