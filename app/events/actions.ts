'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createCheckoutSession } from '@/lib/actions/checkout'

export async function startCheckoutAction(formData: FormData) {
  const showId = String(formData.get('show_id') ?? '')
  const slug = String(formData.get('slug') ?? '')
  const clubSlug = String(formData.get('club_slug') ?? '')
  const headerStore = await headers()
  const host = headerStore.get('host') ?? 'localhost:3000'
  const protocol = headerStore.get('x-forwarded-proto') ?? 'http'
  const sourcePath = clubSlug ? `/${clubSlug}/eventer/${slug}` : `/events/${slug}`
  const sourceUrl = `${protocol}://${host}${sourcePath}`

  // Check for external ticket URL — if set, redirect directly
  const db = createAdminClient()
  const { data: show } = await db.from('shows').select('ticket_url').eq('id', showId).single()
  if (show?.ticket_url) redirect(show.ticket_url)

  let checkoutUrl: string
  try {
    const session = await createCheckoutSession(showId, sourceUrl)
    checkoutUrl = session.url
  } catch (error) {
    const message = error instanceof Error ? error.message : 'checkout_failed'
    console.error('[Checkout] startCheckoutAction failed for show', showId, ':', message)
    if (message === 'Show is sold out') throw new Error('Dette showet er utsolgt.')
    if (message === 'Show is no longer available for purchase') throw new Error('Dette showet er ikke lenger tilgjengelig for kjøp.')
    if (message === 'Show is not available for purchase') throw new Error('Dette showet er ikke tilgjengelig for kjøp ennå.')
    if (message === 'No ticket price configured') throw new Error('Ingen billettpris er satt for dette showet.')
    throw new Error(`Checkout feilet: ${message}`)
  }

  redirect(checkoutUrl)
}
