'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Ban, LoaderCircle } from 'lucide-react'
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
import { useShowSalesAction } from '@/components/admin/show-sales-action'
import { WARNING_BOX } from '@/components/admin/show-sales-styles'
import { stopTicketSalesAction } from '@/app/admin-app/(protected)/shows/actions'

/**
 * Stenger billettsalget. Showet står publisert — dette er knappen for en
 * avlysning eller en pause, ikke for å ta showet ned.
 *
 * Løftet i teksten holder fordi databasen håndhever det: en betaling som
 * fullføres etter stengingen gir ingen billett og refunderes automatisk. Å
 * avbryte kjøp som er i gang sparer kjøperen for trekk og refusjon, men er
 * ikke det som stopper salget.
 */
export function StopSalesDialog({ showId, showTitle }: { showId: string; showTitle: string }) {
  const [open, setOpen] = useState(false)
  const { isPending, run } = useShowSalesAction()

  function submit() {
    const formData = new FormData()
    formData.set('show_id', showId)

    run(
      () => stopTicketSalesAction(formData),
      (result) => {
        if ('error' in result) {
          toast.error(result.error)
          return
        }

        const cancelled = result.expiredCheckoutSessions
        toast.success(
          cancelled > 0
            ? `Ticket sales stopped. ${cancelled} ${cancelled === 1 ? 'purchase' : 'purchases'} in progress ${cancelled === 1 ? 'was' : 'were'} cancelled.`
            : 'Ticket sales stopped.',
        )
        if (result.warning) toast.warning(result.warning, { duration: 15000 })
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
      }}
    >
      <DialogTrigger className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        <Ban aria-hidden />
        Stop ticket sales
      </DialogTrigger>

      <DialogContent lang="en" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Stop ticket sales for “{showTitle}”?</DialogTitle>
          <DialogDescription>
            Use this when the show is cancelled or when you need to pause sales. The show stays published.
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>Buyers can no longer start a purchase. The event page shows that sales are closed.</li>
          <li>
            Purchases in progress are cancelled. If a payment still goes through, it is refunded automatically — no
            tickets are issued after you stop sales.
          </li>
          <li>Tickets already sold stay valid. Nobody who already has a ticket is refunded automatically.</li>
          <li>You can resume ticket sales later.</li>
        </ul>

        <p className={WARNING_BOX}>
          Cancelling the show? Stop ticket sales first, then refund all tickets. Only then can the show be deleted.
        </p>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" disabled={isPending} onClick={submit}>
            {isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Ban aria-hidden />}
            {isPending ? 'Stopping…' : 'Stop ticket sales'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
