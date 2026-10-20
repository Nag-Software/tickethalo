// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `createCheckoutSession` mot falske Stripe- og Supabase-klienter.
 *
 * Det som testes er pengene: at beløpet Stripe belaster alltid er prisen på
 * billettypen nå (etter rabatt), at provisjonen regnes av det samme beløpet,
 * og at klubber uten kjent utbetalingsplan får den slått opp før klarheten
 * avgjøres.
 */

type Row = Record<string, unknown>

const STANDARD = '11111111-1111-4111-8111-111111111111'
const STUDENT = '22222222-2222-4222-8222-222222222222'
const VIP = '33333333-3333-4333-8333-333333333333'
const FREE = '44444444-4444-4444-8444-444444444444'

const state = vi.hoisted(() => ({
  show: null as Row | null,
  club: null as Row | null,
  types: [] as Row[],
  soldTickets: 0,
  soldByType: [] as Row[],
  typeUpdates: [] as Array<{ values: Row; id: unknown }>,
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
      let updateId: unknown = null
      const builder = {
        select: () => builder,
        in: () => builder,
        eq(column: string, value: unknown) {
          if (column === 'id') updateId = value
          return builder
        },
        update(values: Row) {
          update = values
          return builder
        },
        single: async () => {
          if (table === 'shows') return { data: state.show, error: state.show ? null : { message: 'not found' } }
          if (table === 'clubs') return { data: state.club, error: null }
          throw new Error(`unexpected single() on ${table}`)
        },
        maybeSingle: async () => {
          if (table === 'show_ticket_counts') return { data: { sold_tickets: state.soldTickets }, error: null }
          throw new Error(`unexpected maybeSingle() on ${table}`)
        },
        then(resolve: (value: unknown) => void) {
          if (table === 'show_ticket_types' && update) {
            state.typeUpdates.push({ values: update, id: updateId })
            return resolve({ error: null })
          }
          if (table === 'show_ticket_types') return resolve({ data: state.types, error: null })
          if (table === 'ticket_type_counts') return resolve({ data: state.soldByType, error: null })
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
    end_time: '22:00:00',
    currency: 'NOK',
    capacity: 100,
    status: 'published',
    club_id: 'club_1',
    ticket_sales_closed_at: null,
    deleted_at: null,
    ...overrides,
  }
}

function ticketType(overrides: Row = {}): Row {
  return {
    id: STANDARD,
    name: 'Standard',
    price: 30_000,
    discount_bps: 0,
    quantity: null,
    promo_code: null,
    sales_end_mode: 'event_start',
    sales_end_days: null,
    sales_end_at: null,
    archived_at: null,
    position: 0,
    created_at: '2026-01-01T00:00:00Z',
    stripe_product_id: 'prod_cached',
    ...overrides,
  }
}

const url = 'https://tickethalo.no/events/friday-laughs'
const one = (typeId = STANDARD, quantity = 1) => ({ items: [{ typeId, quantity }] })

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
  state.types = [ticketType()]
  state.soldTickets = 0
  state.soldByType = []
  state.typeUpdates = []
  ensureKnown.mockImplementation(async (club: Row) => club)
  stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' })
  stripeMock.products.create.mockResolvedValue({ id: 'prod_new' })
})

describe('createCheckoutSession — amount and commission', () => {
  it('charges the current price of the type with an inline price, and never a cached price', async () => {
    const result = await createCheckoutSession('show_1', url, { items: [{ typeId: STANDARD, quantity: 3 }] })

    expect(result).toEqual({ url: 'https://checkout.stripe.com/cs_1', sessionId: 'cs_1' })
    expect(stripeMock.prices.create).not.toHaveBeenCalled()
    expect(stripeMock.products.create).not.toHaveBeenCalled()

    const [params, options] = stripeMock.checkout.sessions.create.mock.calls[0]
    expect(options).toEqual({ stripeAccount: 'acct_club' })
    expect(params.line_items).toEqual([
      { quantity: 3, price_data: { currency: 'nok', unit_amount: 30_000, product: 'prod_cached' } },
    ])

    // 10 % av 300 kr, ganger tre billetter — av samme beløp som belastes.
    expect(params.payment_intent_data.application_fee_amount).toBe(9_000)
    expect(params.metadata).toMatchObject({
      application_fee_amount: '9000',
      quantity: '3',
      item_1: `${STANDARD}:3:30000:9000`,
      marketing_opt_in: '0',
    })
    expect(state.typeUpdates).toEqual([])
  })

  it('takes the commission on the price after the type discount, line by line', async () => {
    state.types = [
      ticketType(),
      ticketType({ id: STUDENT, name: 'Student', price: 30_000, discount_bps: 2500, stripe_product_id: 'prod_student', position: 1 }),
    ]

    await createCheckoutSession('show_1', url, {
      items: [
        { typeId: STANDARD, quantity: 1 },
        { typeId: STUDENT, quantity: 2 },
      ],
    })

    const params = sessionParams()
    expect(params.line_items).toEqual([
      { quantity: 1, price_data: { currency: 'nok', unit_amount: 30_000, product: 'prod_cached' } },
      { quantity: 2, price_data: { currency: 'nok', unit_amount: 22_500, product: 'prod_student' } },
    ])
    // 3 000 + 2 × 2 250
    expect(params.payment_intent_data.application_fee_amount).toBe(7_500)
    expect(params.metadata).toMatchObject({
      application_fee_amount: '7500',
      quantity: '3',
      item_1: `${STANDARD}:1:30000:3000`,
      item_2: `${STUDENT}:2:22500:4500`,
    })
  })

  it('lets a free type ride along as a zero line in a paid cart', async () => {
    state.types = [ticketType(), ticketType({ id: FREE, name: 'Guest list', price: 0, stripe_product_id: 'prod_free', position: 1 })]

    await createCheckoutSession('show_1', url, {
      items: [
        { typeId: STANDARD, quantity: 1 },
        { typeId: FREE, quantity: 1 },
      ],
    })

    expect(sessionParams().line_items[1]).toEqual({
      quantity: 1,
      price_data: { currency: 'nok', unit_amount: 0, product: 'prod_free' },
    })
    expect(sessionParams().payment_intent_data.application_fee_amount).toBe(3_000)
  })

  it('collects the phone number and passes the opt-in on', async () => {
    await createCheckoutSession('show_1', url, { ...one(), marketingOptIn: true })

    expect(sessionParams().phone_number_collection).toEqual({ enabled: true })
    expect(sessionParams().metadata.marketing_opt_in).toBe('1')
    expect(sessionParams().allow_promotion_codes).toBe(false)
  })

  it('sends the cart to the cancel page', async () => {
    await createCheckoutSession('show_1', url, one(STANDARD, 2))
    expect(sessionParams().cancel_url).toBe(
      `https://tickethalo.no/checkout/cancel?event=friday-laughs&items=${encodeURIComponent(`${STANDARD}:2`)}`,
    )
  })

  it('follows a changed currency on the show', async () => {
    state.show = openShow({ currency: 'SEK' })
    state.types = [ticketType({ price: 5_500 })]
    await createCheckoutSession('show_1', url, one())

    expect(sessionParams().line_items[0].price_data).toMatchObject({ currency: 'sek', unit_amount: 5_500 })
    expect(sessionParams().payment_intent_data.application_fee_amount).toBe(550)
  })

  it('gives the session more than 30 minutes, with room for SDK retries', async () => {
    const before = Math.floor(Date.now() / 1000)
    await createCheckoutSession('show_1', url, one())
    const after = Math.floor(Date.now() / 1000)

    const ttl = sessionParams().expires_at
    expect(ttl).toBeGreaterThanOrEqual(before + 35 * 60)
    expect(ttl).toBeLessThanOrEqual(after + 35 * 60)
  })
})

describe('createCheckoutSession — the cart', () => {
  it('refuses an empty cart', async () => {
    const error = await checkoutError(createCheckoutSession('show_1', url, { items: [] }))
    expect(error.code).toBe('no_tickets_selected')
  })

  it('refuses a locked type without its code, and sells it with the code', async () => {
    state.types = [ticketType({ id: VIP, name: 'VIP', promo_code: 'FRIENDS' })]

    const refused = await checkoutError(createCheckoutSession('show_1', url, one(VIP)))
    expect(refused.code).toBe('promo_code_invalid')

    await createCheckoutSession('show_1', url, { ...one(VIP), promoCode: ' friends ' })
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })

  it('refuses a type whose sales period is over', async () => {
    state.types = [ticketType({ sales_end_mode: 'days_before', sales_end_days: 30 })]
    const error = await checkoutError(createCheckoutSession('show_1', url, one()))
    expect(error.code).toBe('ticket_type_unavailable')
  })

  it('refuses more than the type has left', async () => {
    state.types = [ticketType({ quantity: 10 })]
    state.soldByType = [{ ticket_type_id: STANDARD, sold_tickets: 9 }]

    const error = await checkoutError(createCheckoutSession('show_1', url, one(STANDARD, 2)))
    expect(error.code).toBe('ticket_type_sold_out')
  })

  it('refuses an order that does not fit in the remaining capacity of the show', async () => {
    state.soldTickets = 99

    const error = await checkoutError(createCheckoutSession('show_1', url, one(STANDARD, 2)))
    expect(error.code).toBe('sold_out')
  })

  it('refuses a free cart — that goes around Stripe', async () => {
    state.types = [ticketType({ price: 0 })]
    const error = await checkoutError(createCheckoutSession('show_1', url, one()))
    expect(error.code).toBe('unknown')
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
  })
})

describe('createCheckoutSession — product on the club account', () => {
  it('creates and remembers a product per type that has none', async () => {
    state.types = [ticketType({ stripe_product_id: null })]
    await createCheckoutSession('show_1', url, one())

    expect(stripeMock.products.create).toHaveBeenCalledWith(
      { name: 'Friday Laughs', metadata: { show_id: 'show_1', event_slug: 'friday-laughs', ticket_type_id: STANDARD } },
      { stripeAccount: 'acct_club' },
    )
    expect(sessionParams().line_items[0].price_data.product).toBe('prod_new')
    expect(state.typeUpdates).toEqual([{ values: { stripe_product_id: 'prod_new' }, id: STANDARD }])
  })

  it('names the product after the type when there is more than one', async () => {
    state.types = [ticketType(), ticketType({ id: STUDENT, name: 'Student', stripe_product_id: null, position: 1 })]
    await createCheckoutSession('show_1', url, one(STUDENT))

    expect(stripeMock.products.create.mock.calls[0][0].name).toBe('Friday Laughs · Student')
  })

  it('replaces cached products the club account does not know, once', async () => {
    stripeMock.checkout.sessions.create
      .mockRejectedValueOnce({
        type: 'StripeInvalidRequestError',
        code: 'resource_missing',
        message: "No such product: 'prod_cached'",
      })
      .mockResolvedValueOnce({ id: 'cs_2', url: 'https://checkout.stripe.com/cs_2' })

    const result = await createCheckoutSession('show_1', url, one())

    expect(result.sessionId).toBe('cs_2')
    expect(stripeMock.products.create).toHaveBeenCalledTimes(1)
    expect(sessionParams(1).line_items[0].price_data.product).toBe('prod_new')
    expect(state.typeUpdates).toEqual([{ values: { stripe_product_id: 'prod_new' }, id: STANDARD }])
  })

  it('does not retry other Stripe errors', async () => {
    stripeMock.checkout.sessions.create.mockRejectedValueOnce({
      type: 'StripeInvalidRequestError',
      code: 'parameter_invalid',
      message: 'Something else',
    })

    const error = await checkoutError(createCheckoutSession('show_1', url, one()))
    expect(error.code).toBe('stripe_config')
    expect(stripeMock.products.create).not.toHaveBeenCalled()
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })
})

describe('createCheckoutSession — club readiness', () => {
  it('looks up an unknown payout schedule before deciding, so older clubs can sell', async () => {
    state.club = readyClub({ payout_schedule_interval: null })
    ensureKnown.mockImplementation(async (club: Row) => ({ ...club, payout_schedule_interval: 'manual' }))

    await createCheckoutSession('show_1', url, one())

    expect(ensureKnown).toHaveBeenCalledWith(expect.objectContaining({ id: 'club_1', payout_schedule_interval: null }))
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1)
  })

  it('refuses when Stripe confirms a schedule that is not manual', async () => {
    state.club = readyClub({ payout_schedule_interval: null })
    ensureKnown.mockImplementation(async (club: Row) => ({ ...club, payout_schedule_interval: 'daily' }))

    const error = await checkoutError(createCheckoutSession('show_1', url, one()))
    expect(error.code).toBe('club_not_payable')
    expect(error.detail).toContain('schedule=daily')
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('refuses a show without ticket types before touching Stripe', async () => {
    state.types = []

    const error = await checkoutError(createCheckoutSession('show_1', url, one()))
    expect(error.code).toBe('price_missing')
    expect(ensureKnown).not.toHaveBeenCalled()
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
  })

  it('refuses a price below the minimum before touching Stripe', async () => {
    state.types = [ticketType({ price: 200 })]

    const error = await checkoutError(createCheckoutSession('show_1', url, one()))
    expect(error.code).toBe('price_missing')
    expect(error.detail).toContain('below the minimum')
    expect(ensureKnown).not.toHaveBeenCalled()
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
  })
})
