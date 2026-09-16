'use server'

import { revalidatePath } from 'next/cache'
import { assertOrderAccess } from '@/lib/club-auth'
import { refundOrder, type RefundReason } from '@/lib/refunds'

// Skjemaet kommer fra nettleseren og kan inneholde hva som helst. Årsaken
// havner på ordren og i Stripe-metadata, så bare kjente verdier slipper gjennom.
const REFUND_REASONS: readonly RefundReason[] = [
  'customer_request',
  'show_cancelled',
  'duplicate',
  'other',
  'no_ticket_issued',
]

function parseRefundReason(value: FormDataEntryValue | null): RefundReason | null {
  const reason = String(value ?? '').trim() || 'customer_request'
  return (REFUND_REASONS as readonly string[]).includes(reason) ? (reason as RefundReason) : null
}

/**
 * Klubbadmin refunderer én ordre fra ordrelisten.
 *
 * Alt som eksporteres fra en `'use server'`-modul er et kallbart endepunkt,
 * så tilgangssjekken må stå her — selve refusjonslogikken ligger i
 * `lib/refunds.ts` og er ikke eksponert.
 */
export async function refundOrderAction(formData: FormData): Promise<{ error: string } | undefined> {
  const orderId = String(formData.get('order_id') ?? '')
  const reason = parseRefundReason(formData.get('reason'))

  if (!reason) {
    return { error: 'Choose a reason for the refund.' }
  }

  try {
    await assertOrderAccess(orderId)
    const result = await refundOrder(orderId, reason)

    if (!result.ok) {
      console.error(`[Refund] Order ${orderId}: ${result.error}`)
      return { error: result.error }
    }

    revalidatePath('/admin-app/orders')
    revalidatePath('/admin-app/finances')
  } catch (error) {
    // Refusjonen kan ha rukket å gå gjennom hos Stripe før det smalt. En
    // feilside ville skjult hvilken ordre det gjaldt — meldingen sier hva
    // som må sjekkes.
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[Refund] Order ${orderId} failed: ${message}`)
    return { error: `${message} Check the order in Stripe before trying again.` }
  }
}
