'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { ALL_CITIES } from '@/lib/event-filters'

/** Deliberately simple — we reject obvious junk, the email delivery handles the rest. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export type SubscribeResult = { error: string }

export async function subscribeToCityAction(formData: FormData): Promise<SubscribeResult | undefined> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const rawCity = String(formData.get('city') ?? '').trim()
  // 'alle' and 'forside' are stored values, not UI copy — existing rows use them,
  // so they stay as they are even though the interface is now English.
  const city = rawCity && rawCity !== ALL_CITIES ? rawCity : 'alle'

  // Returned, not thrown: Next redacts thrown server action messages in
  // production, which would leave the user with a generic failure toast.
  if (!EMAIL.test(email)) return { error: 'Enter a valid email address.' }
  if (email.length > 254) return { error: 'That email address is too long.' }

  const db = createAdminClient()
  const { error } = await db
    .from('city_subscribers')
    .upsert({ email, city, source: 'forside' }, { onConflict: 'email,city', ignoreDuplicates: true })

  if (error) {
    console.error('city_subscribers upsert failed', error)
    return { error: 'We could not sign you up right now. Please try again.' }
  }
}
