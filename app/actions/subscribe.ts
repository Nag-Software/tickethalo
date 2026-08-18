'use server'

import { createAdminClient } from '@/lib/supabase/admin'

/** Bevisst enkel — vi avviser åpenbart søppel, resten tar e-postleveransen. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function subscribeToCityAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const rawCity = String(formData.get('city') ?? '').trim()
  const city = rawCity && rawCity !== 'Alle' ? rawCity : 'alle'

  if (!EMAIL.test(email)) throw new Error('Skriv inn en gyldig e-postadresse.')
  if (email.length > 254) throw new Error('E-postadressen er for lang.')

  const db = createAdminClient()
  const { error } = await db
    .from('city_subscribers')
    .upsert({ email, city, source: 'forside' }, { onConflict: 'email,city', ignoreDuplicates: true })

  if (error) {
    console.error('city_subscribers upsert failed', error)
    throw new Error('Kunne ikke registrere deg akkurat nå. Prøv igjen.')
  }
}
