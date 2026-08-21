'use server'

import type Stripe from 'stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'
import { CheckoutError, isMissingStripeResource, toCheckoutError } from '@/lib/checkout/errors'

type ShowForCheckout = {
  id: string
  title: string
  slug: string
  date: string
  ticket_price: number | null
  currency: string
  stripe_price_id: string | null
}

/**
 * 6.8 Create Stripe Checkout Session
 *
 * Always throws `CheckoutError` — the caller turns the code into a message.
 */
export async function createCheckoutSession(showId: string, requestUrl: string) {
  const admin = createAdminClient()

  const { data: show, error } = await admin
    .from('shows')
    .select('id, title, slug, date, ticket_price, currency, stripe_price_id, capacity, status')
    .eq('id', showId)
    .single()

  if (error || !show) throw new CheckoutError('show_not_found', { detail: error?.message, cause: error })
  if (show.status !== 'published') throw new CheckoutError('show_not_published', { detail: `status=${show.status}` })
  if (show.date < new Date().toISOString().slice(0, 10)) throw new CheckoutError('show_past', { detail: `date=${show.date}` })
  if (!show.ticket_price) throw new CheckoutError('price_missing')

  // Check remaining capacity
  if (show.capacity !== null) {
    const { count: soldCount } = await admin
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('show_id', showId)
      .in('status', ['valid', 'used'])

    if ((soldCount ?? 0) >= show.capacity) {
      throw new CheckoutError('sold_out', { detail: `sold=${soldCount}/${show.capacity}` })
    }
  }

  const origin = new URL(requestUrl).origin
  const cachedPriceId = show.stripe_price_id
  const priceId = cachedPriceId ?? (await createPrice(show))

  let session: Stripe.Checkout.Session
  try {
    session = await createSession(show, priceId, origin)
  } catch (sessionError) {
    // Cached price IDs do not survive a change of Stripe account, and an archived
    // price disappears the same way. Recreate the price once before giving up —
    // the alternative is cleaning up every show by hand in the database.
    if (!cachedPriceId || !isMissingStripeResource(sessionError, priceId)) {
      throw toCheckoutError(sessionError)
    }

    console.warn(`[Checkout] Price ${priceId} for show ${show.id} is unknown to Stripe — creating a replacement`)
    try {
      session = await createSession(show, await createPrice(show), origin)
    } catch (retryError) {
      throw toCheckoutError(retryError)
    }
  }

  if (!session.url) throw new CheckoutError('unknown', { detail: `session ${session.id} has no url` })
  return { url: session.url, sessionId: session.id }
}

/** Creates a product + one-off price in Stripe and caches the price ID on the show. */
async function createPrice(show: ShowForCheckout) {
  const admin = createAdminClient()

  try {
    const product = await stripe.products.create({
      name: show.title,
      metadata: { show_id: show.id, event_slug: show.slug },
    })

    const price = await stripe.prices.create({
      unit_amount: show.ticket_price!,
      currency: show.currency.toLowerCase(),
      product: product.id,
    })

    // Persist for reuse
    await admin.from('shows').update({ stripe_price_id: price.id }).eq('id', show.id)

    return price.id
  } catch (error) {
    throw toCheckoutError(error)
  }
}

function createSession(show: ShowForCheckout, priceId: string, origin: string) {
  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout/cancel?event=${show.slug}`,
    metadata: {
      show_id: show.id,
      show_title: show.title,
      show_date: show.date,
      event_slug: show.slug,
      app_origin: origin,
    },
    payment_intent_data: {
      metadata: {
        show_id: show.id,
        event_slug: show.slug,
      },
    },
    allow_promotion_codes: true,
  })
}
