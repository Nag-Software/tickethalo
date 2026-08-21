'use server'

import { revalidatePath } from 'next/cache'
import { assertOrderAccess } from '@/lib/club-auth'
import { refundOrder, type RefundReason } from '@/lib/refunds'

/**
 * Klubbadmin refunderer én ordre fra ordrelisten.
 *
 * Alt som eksporteres fra en `'use server'`-modul er et kallbart endepunkt,
 * så tilgangssjekken må stå her — selve refusjonslogikken ligger i
 * `lib/refunds.ts` og er ikke eksponert.
 */
export async function refundOrderAction(formData: FormData) {
  const orderId = String(formData.get('order_id') ?? '')
  const reason = (String(formData.get('reason') ?? 'customer_request') || 'customer_request') as RefundReason

  await assertOrderAccess(orderId)
  const result = await refundOrder(orderId, reason)

  if (!result.ok) throw new Error(result.error)

  revalidatePath('/admin-app/orders')
  revalidatePath('/admin-app/okonomi')
}
