'use client'

import { useId, useState } from 'react'
import { toast } from 'sonner'
import { LoaderCircle, TriangleAlert, Undo2 } from 'lucide-react'
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
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useShowSalesAction } from '@/components/admin/show-sales-action'
import { DESTRUCTIVE_BOX } from '@/components/admin/show-sales-styles'
import { refundAllShowTicketsAction } from '@/app/admin-app/(protected)/shows/actions'
import { formatMinorAmount } from '@/lib/show-sales-shared'

/**
 * Refunderer alle billetter på showet.
 *
 * Det farligste i admin: pengene går rett tilbake fra klubbens Stripe-saldo
 * og kan ikke hentes igjen. Bookeren må derfor skrive showets tittel — et
 * klikk i feil rad i feil fane skal ikke kunne refundere et helt show.
 * Serveren sjekker tittelen og at salget er stengt på nytt.
 */
export function RefundShowDialog({
  showId,
  showTitle,
  currency,
  paidOrders,
  paidAmount,
  awaitingRefundOrders,
  awaitingRefundAmount,
  disabledReason,
}: {
  showId: string
  showTitle: string
  currency: string
  paidOrders: number
  paidAmount: number
  awaitingRefundOrders: number
  awaitingRefundAmount: number
  /** Satt når knappen ikke kan brukes, med forklaringen som vises ved hover. */
  disabledReason: string | null
}) {
  const [open, setOpen] = useState(false)
  const [typedTitle, setTypedTitle] = useState('')
  const { isPending, run } = useShowSalesAction()
  const inputId = useId()

  const confirmed = typedTitle.trim() === showTitle.trim()

  function submit() {
    const formData = new FormData()
    formData.set('show_id', showId)
    formData.set('confirm_title', typedTitle)

    run(
      () => refundAllShowTicketsAction(formData),
      (result) => {
        if ('error' in result) {
          toast.error(result.error)
          return
        }

        if (result.failed > 0) {
          toast.error(`Refunded ${result.refunded} of ${result.total} orders. ${result.failed} failed.`, {
            description: [...result.errors.slice(0, 3), 'Check the orders list and try again.'].join('\n'),
            duration: 15000,
          })
        } else if (result.total === 0) {
          toast.success('There was nothing left to refund.')
        } else {
          toast.success(`Refunded all ${result.refunded} ${result.refunded === 1 ? 'order' : 'orders'}.`)
        }

        setTypedTitle('')
        setOpen(false)
      },
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isPending) return
        setOpen(next)
        if (!next) setTypedTitle('')
      }}
    >
      <DialogTrigger
        disabled={disabledReason !== null}
        title={disabledReason ?? undefined}
        className={buttonVariants({ variant: 'destructive', size: 'sm' })}
      >
        <Undo2 aria-hidden />
        Refund all tickets
      </DialogTrigger>

      <DialogContent lang="en" className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
            Refund all tickets for “{showTitle}”?
          </DialogTitle>
          <DialogDescription>
            {paidOrders > 0 &&
              `${paidOrders} paid ${paidOrders === 1 ? 'order' : 'orders'} (${formatMinorAmount(paidAmount, currency)}) will be refunded.`}
            {paidOrders > 0 && awaitingRefundOrders > 0 && ' '}
            {awaitingRefundOrders > 0 &&
              `${awaitingRefundOrders} ${awaitingRefundOrders === 1 ? 'payment' : 'payments'} (${formatMinorAmount(awaitingRefundAmount, currency)}) that did not issue tickets will also be refunded.`}
          </DialogDescription>
        </DialogHeader>

        <div role="alert" className={DESTRUCTIVE_BOX}>
          <ul className="list-disc space-y-1 pl-4">
            <li>Every buyer gets a full refund to the card or account they paid with.</li>
            <li>All tickets for the show become invalid and can no longer be scanned at the door.</li>
            <li>Tickethalo&apos;s commission is returned to the club.</li>
            <li className="font-semibold">This cannot be undone.</li>
          </ul>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={inputId} className="block text-xs text-muted-foreground">
            Type <span className="font-semibold text-foreground">{showTitle}</span> to confirm
          </label>
          <Input
            id={inputId}
            value={typedTitle}
            onChange={(event) => setTypedTitle(event.target.value)}
            disabled={isPending}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={typedTitle.length > 0 && !confirmed}
          />
        </div>

        {isPending && (
          <p className="text-xs text-muted-foreground">
            Refunding one order at a time. This can take a minute for a large show — keep this window open.
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" disabled={!confirmed || isPending} onClick={submit}>
            {isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Undo2 aria-hidden />}
            {isPending ? 'Refunding…' : 'Refund all tickets'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
