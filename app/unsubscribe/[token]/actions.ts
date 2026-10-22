'use server'

import { revalidatePath } from 'next/cache'
import { isUnsubscribeToken } from '@/lib/marketing/unsubscribe'
import { setUnsubscribed, withdrawAdsConsent } from '@/lib/marketing/unsubscribe-db'

/**
 * Knappene på avmeldingssiden: meld av alt, stopp bare annonsene, og
 * angreknappen etter avmelding. Angrer man, kommer e-postene tilbake, men
 * ikke annonsene — de krever et nytt ja.
 */
export async function setSubscriptionAction(formData: FormData) {
  const token = String(formData.get('token') ?? '')
  if (!isUnsubscribeToken(token)) return
  const mode = formData.get('mode')
  if (mode === 'stop_ads') await withdrawAdsConsent(token)
  else await setUnsubscribed(token, mode !== 'resubscribe')
  revalidatePath(`/unsubscribe/${token}`)
}
