'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, LoaderCircle, Rocket, X } from 'lucide-react'
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
import { publishShowAction } from '@/app/admin-app/(protected)/shows/actions'
import type { PublishReadinessItem } from '@/lib/publish-readiness'
import { cn } from '@/lib/utils'

const FIX_TAB: Record<PublishReadinessItem['key'], string> = {
  poster: 'marketing',
  description: 'overview',
  ticket_price: 'overview',
}

/**
 * Publiser-knappen. Showet publiserer seg ikke lenger selv når lineupen er
 * full — klubben gjør det her, etter å ha sett hva event-siden mangler.
 *
 * Sjekklisten sperrer ikke. Den er der fordi det var nettopp dette som gikk
 * ut uten at noen hadde sett det: ingen plakat, ingen tekst, ingen pris.
 */
export function PublishShowDialog({
  showId,
  showTitle,
  readiness,
  className,
}: {
  showId: string
  showTitle: string
  readiness: PublishReadinessItem[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const { isPending, run } = useShowSalesAction()
  const missing = readiness.filter((item) => !item.done)

  function submit() {
    const formData = new FormData()
    formData.set('show_id', showId)

    run(
      () => publishShowAction(formData),
      (result) => {
        if ('error' in result) {
          toast.error(result.error)
          return
        }
        toast.success('The show is published.')
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
      <DialogTrigger className={cn(buttonVariants({ size: 'sm' }), className)}>
        <Rocket aria-hidden />
        Publish show
      </DialogTrigger>

      <DialogContent lang="en">
        <DialogHeader>
          <DialogTitle>Publish “{showTitle}”?</DialogTitle>
          <DialogDescription>
            The event page goes live and ticket sales open as soon as the sales window allows.
            {missing.length > 0 && ' Some things are still missing — you can publish anyway, or fix them first.'}
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 text-sm">
          {readiness.map((item) => (
            <li key={item.key} className="flex items-center gap-2">
              {item.done
                ? <Check className="size-4 text-emerald-600" aria-hidden />
                : <X className="size-4 text-amber-600" aria-hidden />}
              <span className={item.done ? undefined : 'font-medium'}>{item.label}</span>
              {!item.done && (
                <Link
                  href={`/admin-app/shows/${showId}?tab=${FIX_TAB[item.key]}`}
                  className="ml-auto text-xs text-muted-foreground underline underline-offset-2"
                  onClick={() => setOpen(false)}
                >
                  Add it
                </Link>
              )}
            </li>
          ))}
        </ul>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              Not yet
            </Button>
          </DialogClose>
          <Button disabled={isPending} onClick={submit}>
            {isPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Rocket aria-hidden />}
            {isPending ? 'Publishing…' : missing.length > 0 ? 'Publish anyway' : 'Publish show'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
