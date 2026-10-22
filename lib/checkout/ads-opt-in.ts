import { recordError } from '@/lib/error-log'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Annonsekrysset fra checkout, satt på ordren etter `complete_checkout_order`.
 *
 * Egen oppdatering i stedet for et nytt parameter til RPC-en: den er
 * betalingskritisk, og et nytt parameter ville betydd å definere hele på
 * nytt. Triggeren `orders_sync_club_contact_ads` (migrasjon 090) tar det
 * videre til kontakten.
 *
 * Bare på en ordre med e-postkryss — annonsesamtykket er et tillegg til
 * e-postlista. Idempotent: webhooken og suksessiden kan begge kalle den.
 *
 * Kaster aldri. Feiler den, mister vi heller samtykket enn at kjøperen
 * mister billetten eller e-posten med den.
 */
export async function recordAdsOptIn(orderId: string | null | undefined): Promise<void> {
  if (!orderId) return
  try {
    const { error } = await createAdminClient()
      .from('orders')
      .update({ ads_opt_in: true, ads_opt_in_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('marketing_opt_in', true)
      .eq('ads_opt_in', false)
    if (error) throw error
  } catch (error) {
    await recordError('checkout', error, { action: 'record_ads_opt_in', order_id: orderId }).catch(() => undefined)
  }
}

/** Skjemaverdien, og bare sammen med e-postkrysset — det samme som checkout viser. */
export function readAdsOptIn(formData: FormData, marketingOptIn: boolean): boolean {
  const value = formData.get('ads_opt_in')
  return marketingOptIn && (value === 'on' || value === '1')
}
