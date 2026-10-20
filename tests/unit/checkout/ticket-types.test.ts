import { describe, expect, it } from 'vitest'
import {
  decodeItemMetadata,
  effectiveUnitAmount,
  encodeItemMetadata,
  normalizePromoCode,
  parseCartParam,
  parseOrderItems,
  parseSalesEndOption,
  productName,
  resolveOrderLines,
  salesEndOptionValue,
  ticketTypeAvailability,
  ticketTypeError,
  ticketTypeSalesEndsAt,
  type TicketTypeInput,
  type TicketTypeRule,
} from '@/lib/ticket-types'
import { eventEndsAt, eventStartsAt, instantInZone } from '@/lib/ticket-sales'
import { fromFormValues, toFormValues } from '@/lib/admin-ticket-types'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

function type(overrides: Partial<TicketTypeRule> = {}): TicketTypeRule {
  return {
    id: A,
    name: 'Standard',
    price: 25_000,
    discount_bps: 0,
    quantity: null,
    promo_code: null,
    sales_end_mode: 'event_start',
    sales_end_days: null,
    sales_end_at: null,
    archived_at: null,
    ...overrides,
  }
}

// Fredag 18. desember 2026, 20:00–22:00 norsk tid (vintertid, UTC+1).
const show = { date: '2026-12-18', start_time: '20:00:00', end_time: '22:00:00' }

describe('effectiveUnitAmount', () => {
  it('takes the discount off the price and rounds to the nearest minor unit', () => {
    expect(effectiveUnitAmount(25_000, 0)).toBe(25_000)
    expect(effectiveUnitAmount(25_000, 2500)).toBe(18_750)
    expect(effectiveUnitAmount(19_999, 3333)).toBe(13_333)
    expect(effectiveUnitAmount(25_000, 10_000)).toBe(0)
  })
})

describe('normalizePromoCode', () => {
  it('trims and upper-cases, and treats empty as no code', () => {
    expect(normalizePromoCode('  friends ')).toBe('FRIENDS')
    expect(normalizePromoCode('')).toBeNull()
    expect(normalizePromoCode('   ')).toBeNull()
    expect(normalizePromoCode(null)).toBeNull()
  })
})

describe('event start and end', () => {
  it('reads the show times as Norwegian wall-clock time', () => {
    expect(eventStartsAt(show).toISOString()).toBe('2026-12-18T19:00:00.000Z')
    expect(eventEndsAt(show).toISOString()).toBe('2026-12-18T21:00:00.000Z')
  })

  it('uses summer time in summer', () => {
    expect(instantInZone('2026-06-12', '20:00').toISOString()).toBe('2026-06-12T18:00:00.000Z')
  })

  it('puts an end time before the start on the next day', () => {
    expect(eventEndsAt({ ...show, end_time: '01:00:00' }).toISOString()).toBe('2026-12-19T00:00:00.000Z')
  })

  it('without a start time, starts at midnight after the date — the rule from before ticket types', () => {
    expect(eventStartsAt({ date: '2026-12-18' }).toISOString()).toBe('2026-12-18T23:00:00.000Z')
    expect(eventEndsAt({ date: '2026-12-18' }).toISOString()).toBe('2026-12-18T23:00:00.000Z')
  })
})

describe('ticketTypeSalesEndsAt', () => {
  it('ends at the start of the show by default', () => {
    expect(ticketTypeSalesEndsAt(type(), show).toISOString()).toBe('2026-12-18T19:00:00.000Z')
  })

  it('can run until the show ends', () => {
    expect(ticketTypeSalesEndsAt(type({ sales_end_mode: 'event_end' }), show).toISOString()).toBe('2026-12-18T21:00:00.000Z')
  })

  it('can end a number of days before the start', () => {
    const early = type({ sales_end_mode: 'days_before', sales_end_days: 14 })
    expect(ticketTypeSalesEndsAt(early, show).toISOString()).toBe('2026-12-04T19:00:00.000Z')
  })

  it('takes a custom end, but never later than the end of the show', () => {
    const custom = type({ sales_end_mode: 'custom', sales_end_at: '2026-12-10T12:00:00.000Z' })
    expect(ticketTypeSalesEndsAt(custom, show).toISOString()).toBe('2026-12-10T12:00:00.000Z')

    const late = type({ sales_end_mode: 'custom', sales_end_at: '2027-01-10T12:00:00.000Z' })
    expect(ticketTypeSalesEndsAt(late, show).toISOString()).toBe('2026-12-18T21:00:00.000Z')
  })
})

describe('ticketTypeAvailability', () => {
  const before = new Date('2026-12-18T18:59:00.000Z')
  const after = new Date('2026-12-18T19:00:00.000Z')

  it('is on sale until the sales period ends, and not after', () => {
    expect(ticketTypeAvailability(type(), show, { type: 0, showRemaining: null }, before)).toEqual({ kind: 'on_sale', remaining: null })
    expect(ticketTypeAvailability(type(), show, { type: 0, showRemaining: null }, after)).toEqual({ kind: 'ended' })
  })

  it('counts the lower of what the type and the show have left', () => {
    const limited = type({ quantity: 20 })
    expect(ticketTypeAvailability(limited, show, { type: 15, showRemaining: 100 }, before)).toEqual({ kind: 'on_sale', remaining: 5 })
    expect(ticketTypeAvailability(limited, show, { type: 15, showRemaining: 3 }, before)).toEqual({ kind: 'on_sale', remaining: 3 })
    expect(ticketTypeAvailability(limited, show, { type: 20, showRemaining: 100 }, before)).toEqual({ kind: 'sold_out' })
    expect(ticketTypeAvailability(type(), show, { type: 0, showRemaining: 0 }, before)).toEqual({ kind: 'sold_out' })
  })

  it('never sells an archived type', () => {
    expect(ticketTypeAvailability(type({ archived_at: '2026-12-01T00:00:00Z' }), show, { type: 0, showRemaining: null }, before)).toEqual({
      kind: 'archived',
    })
  })
})

describe('ticketTypeError', () => {
  const valid: TicketTypeInput = {
    name: 'Student',
    price: 20_000,
    discount_bps: 0,
    quantity: null,
    promo_code: null,
    sales_end_mode: 'event_start',
    sales_end_days: null,
    sales_end_at: null,
  }

  it('accepts a normal type, and a free one', () => {
    expect(ticketTypeError(valid)).toBeNull()
    expect(ticketTypeError({ ...valid, price: 0 })).toBeNull()
    expect(ticketTypeError({ ...valid, discount_bps: 10_000 })).toBeNull()
  })

  it('applies the minimum price to what the buyer pays after the discount', () => {
    expect(ticketTypeError({ ...valid, price: 4_000 })).toContain('at least 50 NOK')
    expect(ticketTypeError({ ...valid, price: 6_000, discount_bps: 5000 })).toContain('after discount')
  })

  it('needs a name, a price, and a sensible discount and amount', () => {
    expect(ticketTypeError({ ...valid, name: '  ' })).toContain('name')
    expect(ticketTypeError({ ...valid, price: null })).toContain('price')
    expect(ticketTypeError({ ...valid, discount_bps: 12_000 })).toContain('discount')
    expect(ticketTypeError({ ...valid, quantity: Number.NaN })).toContain('amount')
  })

  it('needs a date for a custom end, no later than the end of the show', () => {
    expect(ticketTypeError({ ...valid, sales_end_mode: 'custom' })).toContain('Pick the date')
    expect(
      ticketTypeError({ ...valid, sales_end_mode: 'custom', sales_end_at: '2027-01-01T00:00:00Z' }, { show }),
    ).toContain('after the show has ended')
  })
})

describe('the sales period dropdown', () => {
  it('round-trips between the option and the columns', () => {
    expect(parseSalesEndOption('days_before:21')).toEqual({ mode: 'days_before', days: 21 })
    expect(parseSalesEndOption('event_end')).toEqual({ mode: 'event_end', days: null })
    expect(parseSalesEndOption('nonsense')).toEqual({ mode: 'event_start', days: null })
    expect(salesEndOptionValue({ sales_end_mode: 'days_before', sales_end_days: 7 })).toBe('days_before:7')
  })

  it('stores a custom end as Norwegian time and shows it back the same way', () => {
    const values = {
      name: 'Early bird',
      price: '199',
      discount: '10',
      quantity: '50',
      promo_code: ' early ',
      sales_end: 'custom',
      sales_end_date: '2026-12-01',
      sales_end_time: '23:59',
    }
    const input = fromFormValues(values)
    expect(input).toEqual({
      name: 'Early bird',
      price: 19_900,
      discount_bps: 1000,
      quantity: 50,
      promo_code: 'EARLY',
      sales_end_mode: 'custom',
      sales_end_days: null,
      sales_end_at: '2026-12-01T22:59:00.000Z',
    })

    const back = toFormValues({
      id: A,
      ...input,
      price: input.price as number,
      position: 0,
      sold: 0,
    })
    expect(back).toMatchObject({ sales_end: 'custom', sales_end_date: '2026-12-01', sales_end_time: '23:59', promo_code: 'EARLY' })
  })
})

describe('the cart', () => {
  it('reads one quantity per type and keeps the order within ten tickets', () => {
    const items = parseOrderItems([
      [`qty_${A}`, '7'],
      [`qty_${B}`, '6'],
      ['qty_not-a-uuid', '2'],
      ['show_id', 'x'],
      [`qty_${A}`, '0'],
    ])
    expect(items).toEqual([
      { typeId: A, quantity: 7 },
      { typeId: B, quantity: 3 },
    ])
  })

  it('round-trips through the Stripe metadata, one key per line', () => {
    const metadata = encodeItemMetadata([
      { typeId: A, quantity: 2, unitAmount: 25_000, platformFeeAmount: 5_000 },
      { typeId: B, quantity: 1, unitAmount: 0, platformFeeAmount: 0 },
    ])
    expect(metadata).toEqual({ item_1: `${A}:2:25000:5000`, item_2: `${B}:1:0:0` })
    expect(decodeItemMetadata({ ...metadata, show_id: 'x' })).toEqual([
      { type_id: A, quantity: 2, unit_amount: 25_000, platform_fee_amount: 5_000 },
      { type_id: B, quantity: 1, unit_amount: 0, platform_fee_amount: 0 },
    ])
    expect(decodeItemMetadata({ quantity: '2' })).toBeNull()
  })

  it('reads the cart back from the cancel link', () => {
    expect(parseCartParam(`${A}:2,${B}:1,bad:3,${A}:x`)).toEqual({ [A]: 2, [B]: 1 })
    expect(parseCartParam(undefined)).toEqual({})
  })

  it('knows a cart of only free types is free', () => {
    const now = new Date('2026-12-01T12:00:00Z')
    const result = resolveOrderLines({
      items: [{ typeId: A, quantity: 2 }],
      types: [type({ price: 0 })],
      show: { ...show, capacity: null },
      soldByType: new Map(),
      showSold: 0,
      promoCode: null,
      now,
    })
    expect(result).toMatchObject({ ok: true, free: true, quantity: 2 })

    const mixed = resolveOrderLines({
      items: [
        { typeId: A, quantity: 1 },
        { typeId: B, quantity: 1 },
      ],
      types: [type({ price: 0 }), type({ id: B, name: 'Student', price: 15_000 })],
      show: { ...show, capacity: null },
      soldByType: new Map(),
      showSold: 0,
      promoCode: null,
      now,
    })
    expect(mixed).toMatchObject({ ok: true, free: false })
  })
})

describe('productName', () => {
  it('is the show alone with a single standard type, and show · type otherwise', () => {
    expect(productName('Friday Laughs', 'Standard', 1)).toBe('Friday Laughs')
    expect(productName('Friday Laughs', 'Standard', 2)).toBe('Friday Laughs · Standard')
    expect(productName('Friday Laughs', 'Student', 1)).toBe('Friday Laughs · Student')
  })
})
