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
    .select('id, title, slug, date, ticket_price, currency, capacity, status, club_id')
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

  const origin = new URL(requestUrl).origin

  // Always price from the show's CURRENT ticket_price using an inline price_data
  // line item. Stripe Price objects are immutable, so caching a price id (the old
  // behaviour) kept charging the original amount after an admin edited the price.
  // payment_intent_data is only valid for paid sessions — a 0-amount (free) session
  // creates no PaymentIntent, so we omit it there.
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: (show.currency ?? 'NOK').toLowerCase(),
        unit_amount: isFree ? 0 : show.ticket_price!,
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
    allow_promotion_codes: !isFree,
    ...(isFree ? {} : {
      payment_intent_data: {
        metadata: {
          show_id: showId,
          event_slug: show.slug,
          club_slug: clubSlug ?? '',
        },
      },
    }),
  })

  if (!session.url) throw new Error('Failed to create checkout URL')
  return { url: session.url, sessionId: session.id }
}
