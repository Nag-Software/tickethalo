'use client'

import { useRef, useState } from 'react'
import { Undo2 } from 'lucide-react'

/**
 * A refund is not reversible and hits the club's Stripe balance directly, so
 * the reason is chosen deliberately and the action is confirmed. The reason is
 * stored on the order and separates a cancellation from a one-off refund in
 * the settlement.
 */
export function RefundOrderButton({
  action,
  orderId,
  amountLabel,
}: {
  action: (formData: FormData) => Promise<void>
  orderId: string
  amountLabel: string
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [reason, setReason] = useState('customer_request')

  return (
    <form ref={formRef} action={action} className="flex items-center gap-1.5">
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
        type="button"
        onClick={() => {
          const confirmed = window.confirm(
            `Refund ${amountLabel} to the buyer?\n\n` +
              'The customer gets the full amount back, and Tickethalo reverses the booking commission. ' +
              'This cannot be undone.',
          )
          if (confirmed) formRef.current?.requestSubmit()
        }}
        className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <Undo2 className="size-3.5" />
        Refund
      </button>
    </form>
  )
}
