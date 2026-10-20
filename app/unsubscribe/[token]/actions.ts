'use server'

import { revalidatePath } from 'next/cache'
import { isUnsubscribeToken } from '@/lib/marketing/unsubscribe'
import { setUnsubscribed } from '@/lib/marketing/unsubscribe-db'

/** Knappen på avmeldingssiden — og angreknappen etterpå. */
export async function setSubscriptionAction(formData: FormData) {
  const token = String(formData.get('token') ?? '')
  if (!isUnsubscribeToken(token)) return
  await setUnsubscribed(token, formData.get('mode') !== 'resubscribe')
  revalidatePath(`/unsubscribe/${token}`)
}
