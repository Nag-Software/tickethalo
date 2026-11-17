'use client'

import * as React from 'react'
import { Undo2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
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
import { moveShowToPlanningAction } from '../actions'

/**
 * «Back to planning» på Overview: stopper bookingen så bookeren kan endre
 * lineupen i ro. Det trekker tilbud som er ute, så det spørres først.
 */
export function MoveToPlanningButton({ showId }: { showId: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  function confirm() {
    const fd = new FormData()
    fd.set('show_id', showId)
    startTransition(async () => {
      const result = await moveShowToPlanningAction(fd)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.withdrawn > 0
        ? `Back to planning. ${result.withdrawn} offer${result.withdrawn === 1 ? '' : 's'} withdrawn.`
        : 'Back to planning.')
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <Undo2 data-icon="inline-start" />
          Back to planning
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move the show back to planning?</DialogTitle>
          <DialogDescription>Auto-booking stops until you start booking again.</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Offers waiting for an answer are withdrawn, and the comedians get an email.</li>
          <li>Comedians who are booked keep their spot.</li>
          <li>When you start booking again, it starts from day one.</li>
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>Cancel</Button>
          </DialogClose>
          <Button onClick={confirm} disabled={pending}>
            {pending ? 'Moving…' : 'Back to planning'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
