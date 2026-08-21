'use client'

import { useRef, useState } from 'react'
import { Undo2 } from 'lucide-react'

/**
 * Refusjon er ikke reversibel og går rett på klubbens Stripe-saldo, så
 * årsaken velges bevisst og handlingen bekreftes. Årsaken havner på ordren
 * og skiller avlysning fra enkeltrefusjon i avregningen.
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
        aria-label="Årsak til refusjon"
        className="rounded border bg-background px-1.5 py-1 text-xs text-muted-foreground"
      >
        <option value="customer_request">Kundeønske</option>
        <option value="show_cancelled">Avlyst show</option>
        <option value="duplicate">Dobbeltkjøp</option>
        <option value="other">Annet</option>
      </select>
      <button
        type="button"
        onClick={() => {
          const confirmed = window.confirm(
            `Refunder ${amountLabel} til kjøperen?\n\n` +
              'Kunden får hele beløpet tilbake, og Tickethalo tilbakefører formidlingsprovisjonen. ' +
              'Handlingen kan ikke angres.',
          )
          if (confirmed) formRef.current?.requestSubmit()
        }}
        className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <Undo2 className="size-3.5" />
        Refunder
      </button>
    </form>
  )
}
