'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { stripe } from '@/lib/stripe'

/**
 * 6.8 Create Stripe Checkout Session
 */
export async function createCheckoutSession(showId: string, requestUrl: string) {
  const admin = createAdminClient()

  const { data: show, error } = await admin
    .from('shows')
    .select('id, title, slug, date, ticket_price, currency, stripe_price_id, capacity, status, club_id')
    .eq('id', showId)
    .single()

  if (error || !show) throw new Error('Show not found')
  if (show.status !== 'published') throw new Error('Show is not available for purchase')
  if (show.date < new Date().toISOString().slice(0, 10)) throw new Error('Show is no longer available for purchase')

  const isFree = !show.ticket_price || show.ticket_price === 0

  const clubSlug = show.club_id
    ? (await admin.from('clubs').select('slug').eq('id', show.club_id).single()).data?.slug ?? null
    : null

  // Check remaining capacity
  if (show.capacity !== null) {
    const { count: soldCount } = await admin
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('show_id', showId)
      .in('status', ['valid', 'used'])

    if ((soldCount ?? 0) >= show.capacity) {
      throw new Error('Show is sold out')
    }
  }

  // Use existing Stripe price or create a one-time price.
  // Free shows always use an inline price (not cached) so a later price change works correctly.
  let priceId = isFree ? null : show.stripe_price_id
  if (!priceId) {
    if (isFree) {
      // Free show: use inline price_data — no product needed, not cached
      const origin = new URL(requestUrl).origin

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: (show.currency ?? 'NOK').toLowerCase(),
            unit_amount: 0,
            product_data: { name: show.title },
          },
          quantity: 1,
        }],
        success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/checkout/cancel?event=${show.slug}${clubSlug ? `&club=${clubSlug}` : ''}`,
        metadata: {
          show_id: showId,
          show_title: show.title,
          show_date: show.date,
          event_slug: show.slug,
          club_slug: clubSlug ?? '',
          app_origin: origin,
        },
        payment_intent_data: {
          metadata: {
            show_id: showId,
            event_slug: show.slug,
            club_slug: clubSlug ?? '',
          },
        },
        allow_promotion_codes: false,
      })

      if (!session.url) throw new Error('Failed to create checkout URL')
      return { url: session.url, sessionId: session.id }
    }

    const product = await stripe.products.create({
      name: show.title,
      metadata: { show_id: showId, event_slug: show.slug },
    })

    const price = await stripe.prices.create({
      unit_amount: show.ticket_price,
      currency: show.currency.toLowerCase(),
      product: product?.id,
    })
    priceId = price.id

    // Persist for reuse
    await admin.from('shows').update({ stripe_price_id: priceId }).eq('id', showId)
  }

  const origin = new URL(requestUrl).origin

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout/cancel?event=${show.slug}${clubSlug ? `&club=${clubSlug}` : ''}`,
    metadata: {
      show_id: showId,
      show_title: show.title,
      show_date: show.date,
      event_slug: show.slug,
      club_slug: clubSlug ?? '',
      app_origin: origin,
    },
    payment_intent_data: {
      metadata: {
        show_id: showId,
        event_slug: show.slug,
        club_slug: clubSlug ?? '',
      },
    },
    allow_promotion_codes: true,
  })

  if (!session.url) throw new Error('Failed to create checkout URL')
  return { url: session.url, sessionId: session.id }
}
