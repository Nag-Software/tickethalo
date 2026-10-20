import { createAdminClient } from '@/lib/supabase/admin'
import { CheckoutError } from '@/lib/checkout/errors'
import {
  type OrderItemInput,
  type OrderLine,
  type TicketTypeRule,
  resolveOrderLines,
  sortTicketTypes,
} from '@/lib/ticket-types'

/** En type slik checkout leser den: reglene, pluss Stripe-produktet. */
export type TypeForCheckout = TicketTypeRule & { stripe_product_id: string | null }

/** Kolonnene checkout leser fra `show_ticket_types`. */
export const CHECKOUT_TYPE_COLUMNS =
  'id, name, price, discount_bps, quantity, promo_code, sales_end_mode, sales_end_days, sales_end_at, archived_at, position, created_at, stripe_product_id' as const

/**
 * Kurven mot typene slik de står nå. Kaster `CheckoutError` med koden
 * kjøperen skal få se. Brukes også av gratisflyten.
 */
export async function resolveCheckoutLines(
  show: { id: string; date: string; start_time: string | null; end_time: string | null; capacity: number | null },
  order: { items: OrderItemInput[]; promoCode?: string | null },
): Promise<{ lines: OrderLine[]; types: TypeForCheckout[]; free: boolean }> {
  const admin = createAdminClient()
  const [{ data: types, error: typesError }, { data: typeCounts }, { data: showCount }] = await Promise.all([
    admin.from('show_ticket_types').select(CHECKOUT_TYPE_COLUMNS).eq('show_id', show.id),
    admin.from('ticket_type_counts').select('ticket_type_id, sold_tickets').eq('show_id', show.id),
    admin.from('show_ticket_counts').select('sold_tickets').eq('show_id', show.id).maybeSingle(),
  ])
  if (typesError) throw new CheckoutError('unknown', { detail: `could not read ticket types: ${typesError.message}`, cause: typesError })

  const sorted = sortTicketTypes((types ?? []) as TypeForCheckout[])
  if (sorted.length === 0) throw new CheckoutError('price_missing', { detail: `show ${show.id} has no ticket types` })

  // Kapasiteten sjekkes endelig i `complete_checkout_order` (under låsen),
  // men et utsolgt show skal helst stoppes før betalingen.
  const result = resolveOrderLines({
    items: order.items,
    types: sorted,
    show,
    soldByType: new Map((typeCounts ?? []).map((row) => [row.ticket_type_id, row.sold_tickets])),
    showSold: showCount?.sold_tickets ?? 0,
    promoCode: order.promoCode ?? null,
  })
  if (!result.ok) throw new CheckoutError(result.code, { detail: result.detail })

  return { lines: result.lines, types: sorted, free: result.free }
}

