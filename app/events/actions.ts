'use server'

import { headers } from 'next/headers'
import { recordError } from '@/lib/error-log'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createCheckoutSession } from '@/lib/actions/checkout'
import { claimFreeTickets, parseFreeTicketInput } from '@/lib/checkout/free'
import { appUrl } from '@/lib/app-url'
import { getUnlockedTicketTypes } from '@/lib/public-events'
import { type PublicTicketType, normalizePromoCode, parseOrderItems } from '@/lib/ticket-types'
import {
  CheckoutError,
  type CheckoutErrorCode,
  checkoutErrorForSalesState,
  checkoutErrorMessage,
  describeCheckoutError,
  toCheckoutError,
} from '@/lib/checkout/errors'
import { ticketSalesState } from '@/lib/ticket-sales'

export type CheckoutActionResult = {
  error: { code: CheckoutErrorCode; message: string }
}

export async function startCheckoutAction(formData: FormData): Promise<CheckoutActionResult | undefined> {
  const showId = String(formData.get('show_id') ?? '')
  const slug = String(formData.get('slug') ?? '')

  if (!showId) return await failure('show_not_found', 'missing show_id in form data', { slug })

  // Antall per type (`qty_<typeId>`), koden som låste opp en type, og om
  // kjøperen vil ha e-post om nye show. Navnet på billettene kommer fra
  // betalingen, eller fra skjemaet når kurven er gratis.
  const items = parseOrderItems(formData.entries())
  const promoCode = normalizePromoCode(String(formData.get('promo_code') ?? ''))
  const marketingOptIn = formData.get('marketing_opt_in') === 'on' || formData.get('marketing_opt_in') === '1'

  // Opprinnelsen havner i suksesslenken og i QR-koden på billetten. Den
  // skal være det faste domenet (`APP_URL`), ikke det kjøperen tilfeldigvis
  // kom inn på: vercel.app-aliaset og forhåndsvisninger svarer også, og en
  // QR-kode med en slik adresse peker et annet sted enn resten. Lokalt, uten
  // `APP_URL`, brukes forespørselen som før.
  const headerStore = await headers()
  const host = headerStore.get('host') ?? 'localhost:3000'
  const protocol = headerStore.get('x-forwarded-proto') ?? 'http'
  const canonical = appUrl()
  const origin = canonical.startsWith('https://') ? canonical : `${protocol}://${host}`
  const sourceUrl = `${origin}/events/${slug}`

  // Check for external ticket URL — if set, redirect directly
  const db = createAdminClient()
  const { data: show, error: showError } = await db
    .from('shows')
    .select('ticket_url, status, date, ticket_sales_closed_at, deleted_at')
    .eq('id', showId)
    .single()
  if (showError || !show) return await failure('show_not_found', showError?.message, { showId, slug })

  // En kurv med bare gratis typer: billettene utstedes her og nå, uten
  // Stripe. Skjemaet har spurt om navn og e-post i stedet for å la
  // betalingen hente dem. Prisene sjekkes på nytt i `claimFreeTickets`.
  if (!show.ticket_url && items.length > 0 && (await isFreeCart(db, showId, items.map((item) => item.typeId)))) {
    const input = parseFreeTicketInput(formData)
    // Kjøperens feil, ikke vår: logges som advarsel, som de andre salgsfeilene.
    if (!input.ok) return await checkoutFailure(new CheckoutError('buyer_details_missing'), { showId, slug })

    let orderId: string
    try {
      const claim = await claimFreeTickets(showId, origin, input.value)
      orderId = claim.orderId
    } catch (error) {
      return await checkoutFailure(toCheckoutError(error), { showId, slug })
    }

    redirect(`${origin}/checkout/success?order=${orderId}&s=${showId}`)
  }

  if (show.ticket_url) {
    // En ekstern billettside går utenom `createCheckoutSession`, og dermed
    // utenom salgsreglene. Uten sjekken her ville et stengt, passert eller
    // arkivert show fortsatt sendt kjøpere videre — og knappen på siden sier
    // noe annet enn det som skjer når man trykker.
    const salesError = checkoutErrorForSalesState(ticketSalesState(show), `status=${show.status} date=${show.date}`)
    if (salesError) return await checkoutFailure(salesError, { showId, slug })
    redirect(show.ticket_url)
  }

  let checkoutUrl: string
  try {
    const session = await createCheckoutSession(showId, sourceUrl, { items, promoCode, marketingOptIn })
    checkoutUrl = session.url
  } catch (error) {
    // Next redacts messages from thrown errors in production, so expected
    // errors are returned as values. The cause only exists here — log it before
    // it is gone, so the Stripe code never has to be guessed from a screenshot.
    return await checkoutFailure(toCheckoutError(error), { showId, slug })
  }

  redirect(checkoutUrl)
}

/**
 * Typene en kode låser opp. Ingen feil som sier om koden finnes et annet
 * sted: en tom liste er svaret på alt som ikke låser opp noe her.
 */
export async function unlockTicketTypesAction(showId: string, code: string): Promise<{ types: PublicTicketType[] }> {
  if (typeof showId !== 'string' || typeof code !== 'string') return { types: [] }
  try {
    return { types: await getUnlockedTicketTypes(showId, code.slice(0, 80)) }
  } catch (error) {
    await recordError('checkout', `Could not unlock ticket types: ${error instanceof Error ? error.message : String(error)}`, { showId })
    return { types: [] }
  }
}

/** Alle de valgte typene koster 0 nå. Ukjente typer gjør kurven betalt — checkout avviser dem. */
async function isFreeCart(db: ReturnType<typeof createAdminClient>, showId: string, typeIds: string[]): Promise<boolean> {
  const { data } = await db.from('show_ticket_types').select('id, unit_amount').eq('show_id', showId).in('id', typeIds)
  return (data ?? []).length === new Set(typeIds).size && (data ?? []).every((type) => type.unit_amount === 0)
}

/**
 * Every `CheckoutError` reaches the buyer the same way: as a returned value the
 * form shows as a toast. Stopped sales and sales that have not opened are the
 * buyer's news, not ours, so they are logged as warnings.
 */
async function checkoutFailure(
  checkoutError: CheckoutError,
  context: Record<string, string | undefined>,
): Promise<CheckoutActionResult> {
  const line = `[Checkout] ${describeCheckoutError(checkoutError, context)}`
  // Vår feil går til feilloggen, så noen ser at et kjøp stoppet. Kundens
  // egne svar (utsolgt, salget stengt) er ikke feil og logges bare.
  if (checkoutError.isOperatorFault) {
    await recordError('checkout', line, { code: checkoutError.code, detail: checkoutError.detail, ...context })
  } else {
    console.warn(line)
  }

  return { error: { code: checkoutError.code, message: checkoutError.message } }
}

async function failure(code: CheckoutErrorCode, detail: string | undefined, context: Record<string, string | undefined>) {
  await recordError('checkout', `[${code}] ${detail ?? ''}`.trim(), { code, ...context })

  return { error: { code, message: checkoutErrorMessage(code) } }
}
