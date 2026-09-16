'use client'

import { useState } from 'react'
import { TriangleAlert, Undo2 } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

/** Samme gjenkjenning som `ToastActionForm`: handlingen returnerer `{ error }`. */
function hasReturnedError(result: unknown) {
  if (typeof result !== 'object' || result === null || !('error' in result)) return false
  return Boolean((result as { error?: unknown }).error)
}

/**
 * Refusjon er ikke reversibel og går rett på klubbens Stripe-saldo, så
 * årsaken velges bevisst og handlingen bekreftes i en dialog som sier hva som
 * faktisk skjer. Årsaken havner på ordren og skiller avlysning fra
 * enkeltrefusjon i avregningen.
 *
 * Utfallet kommer som toast fra `ToastActionForm` — en refusjon som feiler
 * halvveis må sies med ord, ikke som en feilside.
 */
export function RefundOrderButton({
  action,
  orderId,
  amountLabel,
  awaitingRefund = false,
}: {
  action: (formData: FormData) => Promise<unknown>
  orderId: string
  /** Det som gjenstår å refundere, formatert. */
  amountLabel: string
  /**
   * Betalt hos Stripe, men ingen billett ble utstedt. Årsaken er da gitt, og
   * det finnes ingen billetter å ugyldiggjøre.
   */
  awaitingRefund?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [reason, setReason] = useState('customer_request')

  // Dialogen står til kallet er ferdig. Lukkes den underveis, ser det ut som
  // ingenting skjedde, og et nytt klikk blir et nytt forsøk. Ved feil blir
  // den stående, så bookeren ser toasten og kan avbryte selv.
  async function submit(formData: FormData) {
    setPending(true)
    try {
      const result = await action(formData)
      if (!hasReturnedError(result)) setOpen(false)
      return result
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next)
      }}
    >
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
        <Undo2 className="size-3.5" aria-hidden />
        Refund
      </DialogTrigger>

      {/* Dialogen portaleres til <body>, utenfor admin-appens lang="en". */}
      <DialogContent lang="en" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Refund {amountLabel} to the buyer?</DialogTitle>
          <DialogDescription>
            {awaitingRefund
              ? 'The buyer paid, but no ticket was issued because the show was sold out or no longer on sale. This is normally refunded automatically.'
              : 'The payment goes back to the buyer from the club’s Stripe balance.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2.5 rounded-lg bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          <TriangleAlert className="mt-px size-4 shrink-0" aria-hidden />
          <ul className="flex flex-col gap-1">
            <li>The buyer gets {amountLabel} back.</li>
            <li>
              {awaitingRefund
                ? 'No tickets were issued for this order.'
                : 'Every ticket on this order stops working immediately and can no longer be used at the door.'}
            </li>
            <li>Tickethalo’s commission is returned to the club.</li>
            <li className="font-medium">This cannot be undone.</li>
          </ul>
        </div>

        <ToastActionForm
          action={submit}
          successMessage={`Refunded ${amountLabel} to the buyer.`}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="order_id" value={orderId} />
          {awaitingRefund ? (
            <input type="hidden" name="reason" value="no_ticket_issued" />
          ) : (
            <label className="flex flex-col gap-1.5 text-xs font-medium">
              Reason
              <select
                name="reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm font-normal"
              >
                <option value="customer_request">Customer request</option>
                <option value="show_cancelled">Show cancelled</option>
                <option value="duplicate">Duplicate purchase</option>
                <option value="other">Other</option>
              </select>
            </label>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive">
              <Undo2 aria-hidden />
              {pending ? 'Refunding…' : `Refund ${amountLabel}`}
            </Button>
          </DialogFooter>
        </ToastActionForm>
      </DialogContent>
    </Dialog>
  )
}
