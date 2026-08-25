'use client'

import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'

/**
 * Refusjon er ikke reversibel og går rett på klubbens Stripe-saldo, så
 * årsaken velges bevisst og handlingen bekreftes. Årsaken havner på ordren
 * og skiller avlysning fra enkeltrefusjon i avregningen.
 *
 * Utfallet kommer som toast fra `ToastActionForm` — en refusjon som feiler
 * halvveis må sies med ord, ikke som en feilside.
 */
export function RefundOrderButton({
  action,
  orderId,
  amountLabel,
}: {
  action: (formData: FormData) => Promise<unknown>
  orderId: string
  amountLabel: string
}) {
  const [reason, setReason] = useState('customer_request')

  return (
    <ToastActionForm
      action={action}
      successMessage={`Refunded ${amountLabel} to the buyer.`}
      className="flex items-center gap-1.5"
    >
      <input type="hidden" name="order_id" value={orderId} />
      <select
        name="reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        aria-label="Reason for refund"
        className="rounded border bg-background px-1.5 py-1 text-xs text-muted-foreground"
      >
        <option value="customer_request">Customer request</option>
        <option value="show_cancelled">Show cancelled</option>
        <option value="duplicate">Duplicate purchase</option>
        <option value="other">Other</option>
      </select>
      <button
        type="submit"
        // Bekreftelsen ligger på klikket, ikke på en ref: `ToastActionForm`
        // setter sin egen ref på skjemaet, så en utenfra ville vært null.
        onClick={(event) => {
          const confirmed = window.confirm(
            `Refund ${amountLabel} to the buyer?\n\n` +
              'The customer gets the full amount back and Tickethalo returns its agency ' +
              'commission. This cannot be undone.',
          )
          if (!confirmed) event.preventDefault()
        }}
        className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <Undo2 className="size-3.5" aria-hidden />
        Refund
      </button>
    </ToastActionForm>
  )
}
