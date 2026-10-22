import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { CheckoutError, checkoutErrorForSalesState } from '@/lib/checkout/errors'
import { deliverTicketEmail } from '@/lib/checkout/finalize'
import { readAdsOptIn, recordAdsOptIn } from '@/lib/checkout/ads-opt-in'
import { resolveCheckoutLines } from '@/lib/checkout/lines'
import { ticketSalesState } from '@/lib/ticket-sales'
import { type OrderItemInput, type OrderLine, normalizePromoCode, parseOrderItems } from '@/lib/ticket-types'

/**
 * Gratisbilletter: samme billett, uten Stripe.
 *
 * En billettype med pris 0 utsteder ekte billetter — QR-kode, kapasitet,
 * innsjekk og gjesteliste — men ingen betaling finnes å vente på. En kurv
 * med bare gratis typer går derfor rett fra skjemaet til
 * `complete_checkout_order`; en kurv med minst én betalt type går gjennom
 * Stripe, og de gratis billettene følger med som linjer på 0. Bestillingen går
 * derfor rett fra skjemaet til `complete_checkout_order`, med beløp 0 og
 * uten noen Stripe-referanser. Ordren får `stripe_fee_status =
 * not_applicable` av seg selv (ingen payment intent), og alt som leter etter
 * betalinger å reparere, bokføre eller utbetale hopper over den.
 *
 * Sesjons-ID-en, som ellers er Stripes, lages av show og e-post. Det gir
 * én gratisordre per e-postadresse per show: et nytt forsøk fra samme
 * adresse får billettene som alt finnes (`duplicate`) og e-posten på nytt,
 * i stedet for enda en bunke. Uten betaling er det den eneste bremsen mot
 * at én person tømmer et show.
 */

export function freeOrderSessionId(showId: string, email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32)
  return `free_${showId}_${digest}`
}

/** Gratisordrer kjennes igjen på sesjons-ID-en: de har ingen betaling å slå opp. */
export function isFreeOrderSessionId(sessionId: string | null | undefined): boolean {
  return typeof sessionId === 'string' && sessionId.startsWith('free_')
}

export type FreeTicketInput = {
  items: OrderItemInput[]
  promoCode: string | null
  email: string
  name: string
  marketingOptIn: boolean
  /** Bare sammen med `marketingOptIn` — se `readAdsOptIn`. */
  adsOptIn: boolean
}

/**
 * Navn og e-post fra skjemaet. Begge må med: billetten sendes til adressen,
 * og navnet står på den — ingen betaling finnes å hente dem fra.
 */
export function parseFreeTicketInput(formData: FormData): { ok: true; value: FreeTicketInput } | { ok: false } {
  const email = String(formData.get('buyer_email') ?? '').trim().slice(0, 254)
  const name = String(formData.get('buyer_name') ?? '').trim().slice(0, 120)

  if (!name || !isPlausibleEmail(email)) return { ok: false }
  const marketingOptIn = formData.get('marketing_opt_in') === 'on' || formData.get('marketing_opt_in') === '1'
  return {
    ok: true,
    value: {
      items: parseOrderItems(formData.entries()),
      promoCode: normalizePromoCode(String(formData.get('promo_code') ?? '')),
      email,
      name,
      marketingOptIn,
      adsOptIn: readAdsOptIn(formData, marketingOptIn),
    },
  }
}

/** Nok til å stoppe tomme og åpenbart gale adresser; postkassen avgjør resten. */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}

export type FreeTicketClaim = {
  orderId: string
  ticketCodes: string[]
  /** `duplicate`: adressen hadde allerede billetter til showet; de er sendt på nytt. */
  result: 'created' | 'duplicate'
  emailSent: boolean
}

const SHOW_COLUMNS =
  'id, title, slug, date, start_time, end_time, currency, capacity, status, club_id, ticket_sales_closed_at, deleted_at'

/**
 * Utsteder gratisbilletter til showet. Kaster `CheckoutError` når det ikke
 * går, med samme koder som betalt kjøp — skjemaet viser dem likt.
 */
export async function claimFreeTickets(showId: string, origin: string, input: FreeTicketInput): Promise<FreeTicketClaim> {
  const admin = createAdminClient()

  const { data: show, error } = await admin.from('shows').select(SHOW_COLUMNS).eq('id', showId).single()
  if (error || !show) throw new CheckoutError('show_not_found', { detail: error?.message, cause: error })

  const salesError = checkoutErrorForSalesState(ticketSalesState(show), `status=${show.status} date=${show.date}`)
  if (salesError) throw salesError

  // Typene, antallet og plassen sjekkes mot det som står nå. En pris kan ha
  // blitt satt mellom sidevisningen og klikket — da er det et betalt kjøp, og
  // det skal ikke snike seg gjennom her. Kapasiteten sjekkes endelig i
  // `complete_checkout_order`, men et utsolgt show skal helst stoppes før
  // ordren finnes: en kansellert gratisordre ville ellers stått i veien for
  // adressen til noen ryddet den bort.
  const { lines, free } = await resolveCheckoutLines(show, input)
  if (!free) throw new CheckoutError('unknown', { detail: `show ${show.id}: the cart is not free` })

  const sessionId = freeOrderSessionId(show.id, input.email)
  let completion = await completeFreeOrder(show, sessionId, input, lines)

  // En kansellert gratisordre fra et tidligere forsøk (utsolgt i kappløpet,
  // salget stengt en stund) ligger på samme sesjons-ID og gir «duplicate»
  // uten billetter. Den har ingen penger i seg, så den ryddes og forsøket
  // gjøres én gang til.
  if (completion.result === 'duplicate' && completion.ticketCodes.length === 0 && completion.orderId) {
    const { error: cleanupError } = await admin
      .from('orders')
      .delete()
      .eq('id', completion.orderId)
      .eq('stripe_checkout_session_id', sessionId)
      .eq('status', 'cancelled')
      .eq('amount_total', 0)
    if (cleanupError) {
      throw new CheckoutError('unknown', { detail: `could not clear stale free order ${completion.orderId}: ${cleanupError.message}` })
    }
    completion = await completeFreeOrder(show, sessionId, input, lines)
  }

  switch (completion.result) {
    case 'sold_out':
      throw new CheckoutError('sold_out', { detail: `order=${completion.orderId}` })
    case 'sales_closed':
      throw new CheckoutError('sales_closed', { detail: `order=${completion.orderId}` })
    case 'invalid_show':
      throw new CheckoutError('show_not_published', { detail: `order=${completion.orderId}` })
    case 'duplicate':
      if (completion.ticketCodes.length === 0) {
        throw new CheckoutError('unknown', { detail: `free order ${completion.orderId} is a duplicate without tickets` })
      }
      break
    case 'created':
      break
  }

  if (input.marketingOptIn && input.adsOptIn) await recordAdsOptIn(completion.orderId)

  const { emailSent } = await deliverTicketEmail({
    orderId: completion.orderId,
    result: completion.result,
    showId: show.id,
    clubId: show.club_id,
    buyerEmail: input.email,
    buyerName: input.name,
    ticketCodes: completion.ticketCodes,
    origin,
    fallbackTitle: show.title,
    fallbackDate: show.date,
    reference: `free order ${completion.orderId ?? sessionId}`,
    free: true,
  })

  return { orderId: completion.orderId as string, ticketCodes: completion.ticketCodes, result: completion.result, emailSent }
}

type Completion = {
  result: 'created' | 'duplicate' | 'sold_out' | 'invalid_show' | 'sales_closed'
  orderId: string | null
  ticketCodes: string[]
}

async function completeFreeOrder(
  show: { id: string; currency: string; club_id: string | null },
  sessionId: string,
  input: FreeTicketInput,
  lines: OrderLine[],
): Promise<Completion> {
  const { data, error } = await createAdminClient()
    .rpc('complete_checkout_order', {
      p_show_id: show.id,
      p_session_id: sessionId,
      p_amount_total: 0,
      p_currency: show.currency.toUpperCase(),
      p_buyer_email: input.email,
      p_buyer_name: input.name,
      p_club_id: show.club_id,
      // 0, ikke null: da får ordren klubbandel 0 i stedet for en tom verdi
      // som ser ut som en betaling ingen har lest ennå.
      p_platform_fee_amount: 0,
      p_quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
      // Navnet på billettene er kjøperens eget — RPC-en faller tilbake på det.
      p_ticket_names: [],
      p_items: lines.map((line) => ({
        type_id: line.typeId,
        quantity: line.quantity,
        unit_amount: 0,
        platform_fee_amount: 0,
      })),
      p_marketing_opt_in: input.marketingOptIn,
    })
    .single()

  if (error || !data) {
    throw new CheckoutError('unknown', { detail: `complete_checkout_order failed: ${error?.message ?? 'no row'}`, cause: error })
  }

  const ticketCodes = data.ticket_codes?.length ? data.ticket_codes : data.ticket_code ? [data.ticket_code] : []
  return { result: data.result, orderId: data.order_id, ticketCodes }
}
