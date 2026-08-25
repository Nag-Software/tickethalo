'use server'

import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'
import {
  CLUB_CONNECT_FIELDS,
  type ConnectClub,
  commissionFor,
  isClubPayoutReady,
} from '@/lib/stripe-connect'
import { CheckoutError, isMissingStripeResource, toCheckoutError } from '@/lib/checkout/errors'
import { MAX_TICKETS_PER_ORDER } from '@/lib/tickets'

type ShowForCheckout = {
  id: string
  title: string
  slug: string
  date: string
  ticket_price: number | null
  currency: string
  stripe_price_id: string | null
}

export type TicketOrderInput = {
  quantity: number
  /** Navn per billett, i samme rekkefølge. Kortere enn `quantity` er lov. */
  holderNames: string[]
}

/**
 * 6.8 Create Stripe Checkout Session
 *
 * Betalingen opprettes PÅ klubbens Connect-konto (direct charge): klubben er
 * selger av billetten, og pengene er klubbens fra betalingsøyeblikket.
 * Tickethalo tar formidlingsprovisjonen som `application_fee_amount` og rører
 * aldri resten. Se `lib/stripe-connect.ts`.
 *
 * Always throws `CheckoutError` — the caller turns the code into a message.
 */
export async function createCheckoutSession(
  showId: string,
  requestUrl: string,
  order: TicketOrderInput = { quantity: 1, holderNames: [] },
) {
  const admin = createAdminClient()
  const quantity = Math.min(Math.max(1, Math.floor(order.quantity || 1)), MAX_TICKETS_PER_ORDER)

  const { data: show, error } = await admin
    .from('shows')
    .select('id, title, slug, date, ticket_price, currency, stripe_price_id, capacity, status, club_id')
    .eq('id', showId)
    .single()

  if (error || !show) throw new CheckoutError('show_not_found', { detail: error?.message, cause: error })
  if (show.status !== 'published') throw new CheckoutError('show_not_published', { detail: `status=${show.status}` })
  if (show.date < new Date().toISOString().slice(0, 10)) throw new CheckoutError('show_past', { detail: `date=${show.date}` })
  if (!show.ticket_price) throw new CheckoutError('price_missing')

  const club = await loadClub(show.club_id)
  const clubDetail = club
    ? `club=${club.id} charges=${club.charges_enabled} payouts=${club.payouts_enabled} org=${Boolean(club.org_number)}`
    : `show ${show.id} has no club`

  if (!isClubPayoutReady(club)) {
    throw new CheckoutError('club_not_payable', { detail: clubDetail })
  }

  // Garantert av `isClubPayoutReady` — kontoen er en del av det den sjekker.
  const account = club.stripe_account_id as string

  // Check remaining capacity
  if (show.capacity !== null) {
    const { count: soldCount } = await admin
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('show_id', showId)
      .in('status', ['valid', 'used'])

    // Hele bestillingen må få plass — den samme regelen som oppgjøret
    // håndhever når betalingen kommer tilbake (migrasjon 036).
    if ((soldCount ?? 0) + quantity > show.capacity) {
      throw new CheckoutError('sold_out', { detail: `sold=${soldCount}/${show.capacity} wanted=${quantity}` })
    }
  }

  const origin = new URL(requestUrl).origin
  const cachedPriceId = show.stripe_price_id
  const priceId = cachedPriceId ?? (await createPrice(show, account))

  let session: Stripe.Checkout.Session
  try {
    session = await createSession(show, club, priceId, origin, quantity, order.holderNames)
  } catch (sessionError) {
    // Pris-ID-er hører til én Stripe-konto. Etter overgangen til Connect ligger
    // gamle ID-er på plattformkontoen og er ukjente for klubbens konto — samme
    // symptom som en arkivert pris. Lag prisen på nytt én gang før vi gir opp.
    if (!cachedPriceId || !isMissingStripeResource(sessionError, priceId)) {
      throw toCheckoutError(sessionError)
    }

    console.warn(`[Checkout] Price ${priceId} for show ${show.id} is unknown to ${account} — creating a replacement`)
    try {
      session = await createSession(show, club, await createPrice(show, account), origin, quantity, order.holderNames)
    } catch (retryError) {
      throw toCheckoutError(retryError)
    }
  }

  if (!session.url) throw new CheckoutError('unknown', { detail: `session ${session.id} has no url` })
  return { url: session.url, sessionId: session.id }
}

async function loadClub(clubId: string | null): Promise<ConnectClub | null> {
  if (!clubId) return null
  const admin = createAdminClient()
  const { data } = await admin.from('clubs').select(CLUB_CONNECT_FIELDS).eq('id', clubId).single()
  return (data as unknown as ConnectClub | null) ?? null
}

/** Creates a product + one-off price on the club's account and caches the IDs on the show. */
async function createPrice(show: ShowForCheckout, account: string) {
  const admin = createAdminClient()

  try {
    const product = await stripe.products.create(
      {
        name: show.title,
        metadata: { show_id: show.id, event_slug: show.slug },
      },
      { stripeAccount: account },
    )

    const price = await stripe.prices.create(
      {
        unit_amount: show.ticket_price!,
        currency: show.currency.toLowerCase(),
        product: product.id,
      },
      { stripeAccount: account },
    )

    // Persist for reuse
    await admin
      .from('shows')
      .update({ stripe_price_id: price.id, stripe_product_id: product.id })
      .eq('id', show.id)

    return price.id
  } catch (error) {
    throw toCheckoutError(error)
  }
}

function createSession(
  show: ShowForCheckout,
  club: ConnectClub,
  priceId: string,
  origin: string,
  quantity: number,
  holderNames: string[],
) {
  // Provisjonen er per billett, så den skal ganges opp med antallet.
  const commission = commissionFor(show.ticket_price!, club) * quantity

  return stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [{ price: priceId, quantity }],
      // `s` lar suksesssiden finne fram til riktig Connect-konto. Sesjonen
      // finnes bare på klubbens konto, så uten den kan den ikke hentes.
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&s=${show.id}`,
      cancel_url: `${origin}/checkout/cancel?event=${show.slug}`,
      metadata: {
        show_id: show.id,
        show_title: show.title,
        show_date: show.date,
        event_slug: show.slug,
        app_origin: origin,
        club_id: club.id,
        connected_account_id: club.stripe_account_id ?? '',
        quantity: String(quantity),
        // Ett navn per nøkkel framfor én JSON-streng: Stripe tåler 50 nøkler
        // à 500 tegn, men en samlet streng ville sprengt grensen på lange navn.
        ...ticketNameMetadata(holderNames, quantity),
      },
      payment_intent_data: {
        // Formidlingsprovisjonen. Resten blir stående på klubbens konto.
        application_fee_amount: commission,
        metadata: {
          show_id: show.id,
          event_slug: show.slug,
          club_id: club.id,
        },
      },
      allow_promotion_codes: true,
    },
    { stripeAccount: club.stripe_account_id! },
  )
}

/** `ticket_name_1` … `ticket_name_n`, tomme navn utelatt. */
function ticketNameMetadata(holderNames: string[], quantity: number) {
  const entries: Record<string, string> = {}

  for (let index = 0; index < quantity; index += 1) {
    const name = holderNames[index]?.trim().slice(0, 120)
    if (name) entries[`ticket_name_${index + 1}`] = name
  }

  return entries
}
