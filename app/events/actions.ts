'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createCheckoutSession } from '@/lib/actions/checkout'
import { MAX_TICKETS_PER_ORDER } from '@/lib/tickets'
import {
  type CheckoutErrorCode,
  checkoutErrorMessage,
  describeCheckoutError,
  toCheckoutError,
} from '@/lib/checkout/errors'

export type CheckoutActionResult = {
  error: { code: CheckoutErrorCode; message: string }
}

export async function startCheckoutAction(formData: FormData): Promise<CheckoutActionResult | undefined> {
  const showId = String(formData.get('show_id') ?? '')
  const slug = String(formData.get('slug') ?? '')

  if (!showId) return failure('show_not_found', 'missing show_id in form data', { slug })

  // Antall og navn kommer fra bestillingsskjemaet. Kortet i lista sender
  // ingen av delene, og får da én billett uten navn — som før.
  const quantity = Math.min(
    Math.max(1, Number(formData.get('quantity') ?? 1) || 1),
    MAX_TICKETS_PER_ORDER,
  )
  const holderNames = formData
    .getAll('holder_name')
    .slice(0, quantity)
    .map((value) => String(value).trim().slice(0, 120))

  const headerStore = await headers()
  const host = headerStore.get('host') ?? 'localhost:3000'
  const protocol = headerStore.get('x-forwarded-proto') ?? 'http'
  const sourceUrl = `${protocol}://${host}/events/${slug}`

  // Check for external ticket URL — if set, redirect directly
  const db = createAdminClient()
  const { data: show, error: showError } = await db.from('shows').select('ticket_url').eq('id', showId).single()
  if (showError || !show) return failure('show_not_found', showError?.message, { showId, slug })
  if (show.ticket_url) redirect(show.ticket_url)

  let checkoutUrl: string
  try {
    const session = await createCheckoutSession(showId, sourceUrl, { quantity, holderNames })
    checkoutUrl = session.url
  } catch (error) {
    // Next redacts messages from thrown errors in production, so expected
    // errors are returned as values. The cause only exists here — log it before
    // it is gone, so the Stripe code never has to be guessed from a screenshot.
    const checkoutError = toCheckoutError(error)
    const line = `[Checkout] ${describeCheckoutError(checkoutError, { showId, slug })}`
    if (checkoutError.isOperatorFault) console.error(line)
    else console.warn(line)

    return { error: { code: checkoutError.code, message: checkoutError.message } }
  }

  redirect(checkoutUrl)
}

function failure(code: CheckoutErrorCode, detail: string | undefined, context: Record<string, string | undefined>) {
  const parts = Object.entries(context)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
  console.error(`[Checkout] [${code}]`, ...parts, detail ?? '')

  return { error: { code, message: checkoutErrorMessage(code) } }
}
