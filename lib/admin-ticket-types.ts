/**
 * Billettypene slik admin redigerer dem: verdiene i skjemaet (tekst, i hele
 * kroner og prosent) og raden i databasen (minste enhet og basispunkter).
 *
 * Ren modul uten serveravhengigheter, så editoren og handlingene deler
 * oversettelsen.
 */

import { instantInZone, TICKET_SALES_TIME_ZONE } from '@/lib/ticket-sales'
import {
  type TicketSalesEndMode,
  type TicketTypeInput,
  normalizePromoCode,
  parseSalesEndOption,
  salesEndOptionValue,
} from '@/lib/ticket-types'

/** En type i editoren, med hvor mange som er solgt. */
export type AdminTicketType = {
  id: string
  name: string
  price: number
  discount_bps: number
  quantity: number | null
  promo_code: string | null
  sales_end_mode: TicketSalesEndMode
  sales_end_days: number | null
  sales_end_at: string | null
  position: number
  sold: number
}

/** Feltene i en rad, som de står i skjemaet. */
export type TicketTypeFormValues = {
  name: string
  /** Hele kroner, som bookeren skriver dem. */
  price: string
  /** Prosent. */
  discount: string
  /** Tom = ubegrenset (bare showets kapasitet). */
  quantity: string
  promo_code: string
  /** `event_start`, `days_before:14` … — se `SALES_END_OPTIONS`. */
  sales_end: string
  /** `YYYY-MM-DD` og `HH:MM`, norsk tid. Bare for `custom`. */
  sales_end_date: string
  sales_end_time: string
}

export const EMPTY_TICKET_TYPE_VALUES: TicketTypeFormValues = {
  name: '',
  price: '',
  discount: '',
  quantity: '',
  promo_code: '',
  sales_end: 'event_start',
  sales_end_date: '',
  sales_end_time: '23:59',
}

const OSLO_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: TICKET_SALES_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Et tidspunkt som norsk dato og klokkeslett. */
function osloDateTime(iso: string): { date: string; time: string } {
  const parts = OSLO_PARTS.formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` }
}

export function toFormValues(type: AdminTicketType): TicketTypeFormValues {
  const custom = type.sales_end_at ? osloDateTime(type.sales_end_at) : null
  return {
    name: type.name,
    price: String(type.price / 100),
    discount: type.discount_bps ? String(type.discount_bps / 100) : '',
    quantity: type.quantity === null ? '' : String(type.quantity),
    promo_code: type.promo_code ?? '',
    sales_end: salesEndOptionValue(type),
    sales_end_date: custom?.date ?? '',
    sales_end_time: custom?.time ?? '23:59',
  }
}

function numberOrNull(raw: string): number | null {
  const text = raw.trim().replace(',', '.')
  if (!text) return null
  const value = Number(text)
  return Number.isFinite(value) ? value : Number.NaN
}

/** Skjemaverdiene som kolonner. Ugyldige tall blir NaN, og `ticketTypeError` sier fra. */
export function fromFormValues(values: TicketTypeFormValues): TicketTypeInput {
  const price = numberOrNull(values.price)
  const discount = numberOrNull(values.discount)
  const quantity = numberOrNull(values.quantity)
  const { mode, days } = parseSalesEndOption(values.sales_end)
  const customAt =
    mode === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(values.sales_end_date)
      ? instantInZone(values.sales_end_date, values.sales_end_time || '23:59').toISOString()
      : null

  return {
    name: values.name.trim(),
    price: price === null ? null : Math.round(price * 100),
    discount_bps: discount === null ? 0 : Math.round(discount * 100),
    quantity: quantity === null ? null : quantity,
    promo_code: normalizePromoCode(values.promo_code),
    sales_end_mode: mode,
    sales_end_days: days,
    sales_end_at: customAt,
  }
}
