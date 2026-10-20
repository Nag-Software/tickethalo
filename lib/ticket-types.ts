/**
 * Billettypene på et show: pris, rabatt, eget antall, kode og salgsperiode.
 *
 * Modulen er ren — ingen database, ingen Stripe — så den kan brukes av
 * checkout på serveren, bestillingsarket i nettleseren og testene likt.
 * Databasen har de samme reglene i migrasjon 073: `unit_amount` er en
 * generert kolonne og `ticket_type_sales_end` regner salgsslutten. Endres
 * regningen her, må den endres der.
 */

import { eventEndsAt, eventStartsAt, type ShowTimes } from '@/lib/ticket-sales'
import { MAX_TICKETS_PER_ORDER, MIN_TICKET_PRICE_MINOR } from '@/lib/tickets'

export const DEFAULT_TICKET_TYPE_NAME = 'Standard'
export const MAX_TICKET_TYPE_NAME_LENGTH = 60
export const MAX_PROMO_CODE_LENGTH = 40

export type TicketSalesEndMode = 'event_start' | 'event_end' | 'days_before' | 'custom'

/** Dagene bookeren kan velge i nedtrekkslisten. */
export const SALES_END_DAY_OPTIONS = [7, 14, 21, 30] as const

export const SALES_END_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'event_start', label: 'Until event start' },
  { value: 'event_end', label: 'Until event ends' },
  ...SALES_END_DAY_OPTIONS.map((days) => ({ value: `days_before:${days}`, label: `Until ${days} days before event start` })),
  { value: 'custom', label: 'Custom end date' },
]

/** Det reglene trenger fra en rad i `show_ticket_types`. */
export type TicketTypeRule = {
  id: string
  name: string
  price: number
  discount_bps: number
  quantity: number | null
  promo_code: string | null
  sales_end_mode: TicketSalesEndMode
  sales_end_days: number | null
  sales_end_at: string | null
  archived_at: string | null
  position?: number
}

/**
 * Prisen kjøperen betaler: full pris minus rabatten, rundet til nærmeste
 * minste enhet. Samme som den genererte kolonnen `unit_amount`.
 */
export function effectiveUnitAmount(price: number, discountBps: number): number {
  const bps = Math.min(10000, Math.max(0, Math.round(discountBps)))
  return Math.round((price * (10000 - bps)) / 10000)
}

/** Koden slik den lagres og sammenlignes: uten mellomrom rundt, store bokstaver. */
export function normalizePromoCode(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().toUpperCase()
  return value ? value.slice(0, MAX_PROMO_CODE_LENGTH) : null
}

/** Når typen slutter å selges. Speiler `ticket_type_sales_end` i migrasjon 073. */
export function ticketTypeSalesEndsAt(
  type: Pick<TicketTypeRule, 'sales_end_mode' | 'sales_end_days' | 'sales_end_at'>,
  show: ShowTimes,
): Date {
  const start = eventStartsAt(show)
  const end = eventEndsAt(show)

  switch (type.sales_end_mode) {
    case 'event_end':
      return end
    case 'days_before':
      return new Date(start.getTime() - (type.sales_end_days ?? 0) * 24 * 60 * 60 * 1000)
    case 'custom': {
      const custom = type.sales_end_at ? new Date(type.sales_end_at) : start
      const at = Number.isNaN(custom.getTime()) ? start : custom
      return at.getTime() < end.getTime() ? at : end
    }
    default:
      return start
  }
}

export type TicketTypeAvailability =
  | { kind: 'on_sale'; remaining: number | null }
  | { kind: 'sold_out' }
  | { kind: 'ended' }
  | { kind: 'archived' }

/**
 * Om typen kan kjøpes nå, uten å se på showets salgsvindu — det sjekkes for
 * seg (`ticketSalesState`). `showRemaining` er ledige plasser i hele showet.
 */
export function ticketTypeAvailability(
  type: TicketTypeRule,
  show: ShowTimes,
  sold: { type: number; showRemaining: number | null },
  now: Date = new Date(),
): TicketTypeAvailability {
  if (type.archived_at) return { kind: 'archived' }
  if (now.getTime() >= ticketTypeSalesEndsAt(type, show).getTime()) return { kind: 'ended' }

  const typeRemaining = type.quantity === null ? null : Math.max(0, type.quantity - sold.type)
  const remaining =
    typeRemaining === null ? sold.showRemaining : sold.showRemaining === null ? typeRemaining : Math.min(typeRemaining, sold.showRemaining)

  if (remaining !== null && remaining <= 0) return { kind: 'sold_out' }
  return { kind: 'on_sale', remaining }
}

// ─────────────────────────────────────────────────────────────
// Det bookeren lagrer
// ─────────────────────────────────────────────────────────────

export type TicketTypeInput = {
  name: string
  price: number | null
  discount_bps: number
  quantity: number | null
  promo_code: string | null
  sales_end_mode: TicketSalesEndMode
  sales_end_days: number | null
  sales_end_at: string | null
}

/**
 * Hva som er galt med typen, eller null. Minsteprisen gjelder prisen
 * kjøperen betaler etter rabatt: en rabatt som tar en betalt billett under
 * 50 kr ville gitt Tickethalo tap på Stripe-gebyret. 0 er gratis og lov.
 */
export function ticketTypeError(
  input: TicketTypeInput,
  options: { currency?: string | null; show?: ShowTimes; now?: Date } = {},
): string | null {
  const currency = options.currency?.trim() || 'NOK'
  if (!input.name.trim()) return 'Give the ticket type a name.'
  if (input.name.trim().length > MAX_TICKET_TYPE_NAME_LENGTH) {
    return `The name can be at most ${MAX_TICKET_TYPE_NAME_LENGTH} characters.`
  }
  if (input.price === null || !Number.isInteger(input.price) || input.price < 0) return 'Set a price, or 0 for free tickets.'
  if (!Number.isInteger(input.discount_bps) || input.discount_bps < 0 || input.discount_bps > 10000) {
    return 'The discount must be between 0 and 100 %.'
  }

  const unit = effectiveUnitAmount(input.price, input.discount_bps)
  if (unit !== 0 && unit < MIN_TICKET_PRICE_MINOR) {
    return input.discount_bps > 0
      ? `The price after discount must be at least ${MIN_TICKET_PRICE_MINOR / 100} ${currency}, or 0 for free tickets.`
      : `The ticket price must be at least ${MIN_TICKET_PRICE_MINOR / 100} ${currency}.`
  }

  if (input.quantity !== null && (!Number.isInteger(input.quantity) || input.quantity < 0)) {
    return 'The amount of tickets must be a whole number.'
  }
  if (input.promo_code && input.promo_code.length > MAX_PROMO_CODE_LENGTH) {
    return `The promo code can be at most ${MAX_PROMO_CODE_LENGTH} characters.`
  }

  if (input.sales_end_mode === 'days_before') {
    if (!input.sales_end_days || input.sales_end_days < 1 || input.sales_end_days > 365) return 'Pick when ticket sales end.'
  }
  if (input.sales_end_mode === 'custom') {
    const at = input.sales_end_at ? new Date(input.sales_end_at) : null
    if (!at || Number.isNaN(at.getTime())) return 'Pick the date and time ticket sales end.'
    if (options.show && at.getTime() > eventEndsAt(options.show).getTime()) {
      return 'Ticket sales cannot end after the show has ended.'
    }
  }

  return null
}

/** `event_start`, `days_before:14`, `custom` ↔ kolonnene. */
export function salesEndOptionValue(type: Pick<TicketTypeRule, 'sales_end_mode' | 'sales_end_days'>): string {
  return type.sales_end_mode === 'days_before' ? `days_before:${type.sales_end_days}` : type.sales_end_mode
}

export function parseSalesEndOption(value: string): { mode: TicketSalesEndMode; days: number | null } {
  const [mode, days] = value.split(':')
  if (mode === 'days_before') {
    const parsed = Number(days)
    return { mode: 'days_before', days: Number.isInteger(parsed) && parsed > 0 ? parsed : 7 }
  }
  if (mode === 'event_end' || mode === 'custom') return { mode, days: null }
  return { mode: 'event_start', days: null }
}

// ─────────────────────────────────────────────────────────────
// Kurven
// ─────────────────────────────────────────────────────────────

export type OrderItemInput = { typeId: string; quantity: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Antallene fra bestillingsarket: ett felt `qty_<typeId>` per type. Tomme og
 * ugyldige faller bort, og hele bestillingen holdes under
 * `MAX_TICKETS_PER_ORDER` — det er gruppesalg over det.
 */
export function parseOrderItems(entries: Iterable<[string, unknown]>): OrderItemInput[] {
  const byType = new Map<string, number>()
  for (const [key, raw] of entries) {
    if (!key.startsWith('qty_')) continue
    const typeId = key.slice(4)
    if (!UUID.test(typeId)) continue
    const quantity = Math.floor(Number(raw))
    if (!Number.isFinite(quantity) || quantity <= 0) continue
    byType.set(typeId, (byType.get(typeId) ?? 0) + quantity)
  }

  const items: OrderItemInput[] = []
  let left = MAX_TICKETS_PER_ORDER
  for (const [typeId, quantity] of byType) {
    if (left <= 0) break
    const take = Math.min(quantity, left)
    items.push({ typeId, quantity: take })
    left -= take
  }
  return items
}

export type OrderLine = {
  typeId: string
  name: string
  quantity: number
  /** Det kjøperen betaler per billett, etter rabatt. */
  unitAmount: number
}

export type ResolveOrderResult =
  | { ok: true; lines: OrderLine[]; free: boolean; quantity: number }
  | { ok: false; code: 'no_tickets_selected' | 'ticket_type_unavailable' | 'ticket_type_sold_out' | 'sold_out' | 'promo_code_invalid'; detail: string }

/**
 * Gjør kurven om til ordrelinjer med prisene som gjelder nå, og sjekker alt
 * som kan sjekkes før betalingen: at typen finnes og selges, at koden låser
 * opp typene som krever det, og at både typen og showet har plass.
 * `complete_checkout_order` sjekker det samme på nytt under låsen.
 */
export function resolveOrderLines(params: {
  items: OrderItemInput[]
  types: TicketTypeRule[]
  show: ShowTimes & { capacity: number | null }
  soldByType: Map<string, number>
  showSold: number
  promoCode: string | null
  now?: Date
}): ResolveOrderResult {
  const now = params.now ?? new Date()
  const items = params.items.filter((item) => item.quantity > 0)
  if (items.length === 0) return { ok: false, code: 'no_tickets_selected', detail: 'empty cart' }

  const quantity = items.reduce((sum, item) => sum + item.quantity, 0)
  const showRemaining = params.show.capacity === null ? null : Math.max(0, params.show.capacity - params.showSold)
  if (showRemaining !== null && quantity > showRemaining) {
    return { ok: false, code: 'sold_out', detail: `sold=${params.showSold}/${params.show.capacity} wanted=${quantity}` }
  }

  const typeMap = new Map(params.types.map((type) => [type.id, type]))
  const promo = normalizePromoCode(params.promoCode)
  const lines: OrderLine[] = []

  for (const item of items) {
    const type = typeMap.get(item.typeId)
    if (!type) return { ok: false, code: 'ticket_type_unavailable', detail: `type ${item.typeId} not on this show` }
    if (type.promo_code && type.promo_code !== promo) {
      return { ok: false, code: 'promo_code_invalid', detail: `type ${type.id} needs a code` }
    }

    const availability = ticketTypeAvailability(
      type,
      params.show,
      { type: params.soldByType.get(type.id) ?? 0, showRemaining },
      now,
    )
    if (availability.kind === 'archived' || availability.kind === 'ended') {
      return { ok: false, code: 'ticket_type_unavailable', detail: `type ${type.id} is ${availability.kind}` }
    }
    if (availability.kind === 'sold_out' || (availability.remaining !== null && item.quantity > availability.remaining)) {
      return { ok: false, code: 'ticket_type_sold_out', detail: `type ${type.id} wanted=${item.quantity}` }
    }

    lines.push({
      typeId: type.id,
      name: type.name,
      quantity: item.quantity,
      unitAmount: effectiveUnitAmount(type.price, type.discount_bps),
    })
  }

  return { ok: true, lines, free: lines.every((line) => line.unitAmount === 0), quantity }
}

// ─────────────────────────────────────────────────────────────
// Linjene på Stripe-sesjonen
//
// Én nøkkel per linje (`item_1`, `item_2` …) og ikke én JSON-streng: Stripe
// tåler 50 nøkler à 500 tegn. Formen er `typeId:antall:enhetspris:provisjon`,
// der provisjonen gjelder hele linjen.
// ─────────────────────────────────────────────────────────────

export type MetadataLine = { typeId: string; quantity: number; unitAmount: number; platformFeeAmount: number }

export function encodeItemMetadata(lines: MetadataLine[]): Record<string, string> {
  const entries: Record<string, string> = {}
  lines.forEach((line, index) => {
    entries[`item_${index + 1}`] = `${line.typeId}:${line.quantity}:${line.unitAmount}:${line.platformFeeAmount}`
  })
  return entries
}

/** `p_items` til `complete_checkout_order`, eller null for sesjoner fra før billettypene. */
export function decodeItemMetadata(
  metadata: Record<string, string> | null | undefined,
): Array<{ type_id: string; quantity: number; unit_amount: number; platform_fee_amount: number | null }> | null {
  if (!metadata) return null
  const items = []
  for (let index = 1; index <= 50; index += 1) {
    const raw = metadata[`item_${index}`]
    if (!raw) break
    const [typeId, quantity, unitAmount, fee] = raw.split(':')
    if (!UUID.test(typeId ?? '')) continue
    const q = Number(quantity)
    const unit = Number(unitAmount)
    if (!Number.isInteger(q) || q <= 0 || !Number.isInteger(unit) || unit < 0) continue
    const parsedFee = Number(fee)
    items.push({
      type_id: typeId,
      quantity: q,
      unit_amount: unit,
      platform_fee_amount: Number.isInteger(parsedFee) && parsedFee >= 0 ? parsedFee : null,
    })
  }
  return items.length > 0 ? items : null
}

// ─────────────────────────────────────────────────────────────
// Det kjøperen ser
// ─────────────────────────────────────────────────────────────

/**
 * En type slik bestillingsarket får den. Koden er ikke med: en låst type
 * sendes bare til den som har oppgitt riktig kode.
 */
export type PublicTicketType = {
  id: string
  name: string
  /** Full pris før rabatt. */
  price: number
  discountBps: number
  /** Det kjøperen betaler. */
  unitAmount: number
  /** Ledige av typen, også begrenset av showets kapasitet. Null = ubegrenset. */
  remaining: number | null
  available: boolean
  soldOut: boolean
  /** Låst opp med en kode. */
  locked: boolean
}

export function toPublicTicketType(
  type: TicketTypeRule,
  availability: TicketTypeAvailability,
  options: { payable: boolean },
): PublicTicketType {
  const unitAmount = effectiveUnitAmount(type.price, type.discount_bps)
  // En betalt type krever en klubb som kan ta betalt; gratis går utenom Stripe.
  const payable = unitAmount === 0 || options.payable
  return {
    id: type.id,
    name: type.name,
    price: type.price,
    discountBps: type.discount_bps,
    unitAmount,
    remaining: availability.kind === 'on_sale' ? availability.remaining : 0,
    available: availability.kind === 'on_sale' && payable,
    soldOut: availability.kind === 'sold_out',
    locked: Boolean(type.promo_code),
  }
}

/** Typene i den rekkefølgen bookeren satte dem. */
export function sortTicketTypes<T extends { position?: number; created_at?: string }>(types: T[]): T[] {
  return [...types].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.created_at ?? '').localeCompare(b.created_at ?? ''),
  )
}

/** Rabatten som tekst: 2500 → «25 %». */
export function formatDiscount(discountBps: number): string {
  const percent = discountBps / 100
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)} %`
}

/** Navnet på betalingssiden: showet, og typen når det er noe å skille mellom. */
export function productName(showTitle: string, typeName: string, typeCount: number) {
  if (typeCount <= 1 && typeName === DEFAULT_TICKET_TYPE_NAME) return showTitle
  return `${showTitle} · ${typeName}`
}

/**
 * Kurven i lenken fra avbruddssiden: `typeId:antall,typeId:antall`. Ugyldige
 * deler faller bort; tom kurv er et tomt objekt.
 */
export function parseCartParam(raw: string | null | undefined): Record<string, number> {
  const cart: Record<string, number> = {}
  for (const part of (raw ?? '').split(',')) {
    const [typeId, quantity] = part.split(':')
    const count = Math.floor(Number(quantity))
    if (!UUID.test(typeId ?? '') || !Number.isFinite(count) || count <= 0) continue
    cart[typeId] = Math.min(MAX_TICKETS_PER_ORDER, (cart[typeId] ?? 0) + count)
  }
  return cart
}
