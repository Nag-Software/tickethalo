'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { LoaderCircle, Ticket } from 'lucide-react'
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
import { resumeTicketSalesAction } from '@/app/admin-app/(protected)/shows/actions'

/**
 * Åpner salget igjen. `opensOn` er satt når showet ligger utenfor
 * salgsvinduet på 90 dager — da åpner ikke salget i dag, og det skal
 * bookeren vite før hen trykker.
 */
export function ResumeSalesDialog({
  showId,
  showTitle,
  opensOn,
}: {
  showId: string
  showTitle: string
  /** Formatert dato salget åpner, når det ikke åpner med en gang. */
  opensOn: string | null
}) {
  const [open, setOpen] = useState(false)
  const { isPending, run } = useShowSalesAction()

  function submit() {
    const formData = new FormData()
    formData.set('show_id', showId)

    run(
      () => resumeTicketSalesAction(formData),
      (result) => {
        if ('error' in result) {
          toast.error(result.error)
          return
        }
        toast.success(opensOn ? `Ticket sales will open ${opensOn}.` : 'Ticket sales are open again.')
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
        <Ticket aria-hidden />
        Resume ticket sales
      </DialogTrigger>

      <DialogContent lang="en">
        <DialogHeader>
          <DialogTitle>Resume ticket sales for “{showTitle}”?</DialogTitle>
          <DialogDescription>
            {opensOn
              ? `Sales stay closed until ${opensOn}, 90 days before the show. After that, buyers can buy tickets on the event page again.`
              : 'Buyers can buy tickets on the event page again right away.'}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button disabled={isPending} onClick={submit}>
            {isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Ticket aria-hidden />}
            {isPending ? 'Resuming…' : 'Resume ticket sales'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
