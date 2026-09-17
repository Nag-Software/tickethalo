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
import { isNextControlFlowError, useShowSalesAction } from '@/components/admin/show-sales-action'
import { DESTRUCTIVE_BOX, WARNING_BOX } from '@/components/admin/show-sales-styles'
import { refundAllShowTicketsAction } from '@/app/admin-app/(protected)/shows/actions'
import { formatMinorAmount } from '@/lib/show-sales-shared'

/** Vern mot en løkke som aldri blir ferdig. 250 runder à 8 sekunder er over en halvtime. */
const MAX_REFUND_ROUNDS = 250

type RefundProgress = { refunded: number; total: number }

type RefundOutcome = {
  /** Summen over alle rundene. */
  refunded: number
  total: number
  failed: number
  errors: string[]
  /** Ordrer som ikke ble forsøkt. Over 0 bare når løkken stoppet før den var ferdig. */
  remaining: number
  /** Feilen som stoppet løkken, når en runde ikke kom tilbake med tall. */
  error: string | null
}

/**
 * Refunderer alle billetter på showet.
 *
 * Det farligste i admin: pengene går rett tilbake fra klubbens Stripe-saldo
 * og kan ikke hentes igjen. Bookeren må derfor skrive showets tittel — et
 * klikk i feil rad i feil fane skal ikke kunne refundere et helt show.
 * Serveren sjekker tittelen og at salget er stengt på nytt.
 *
 * Handlingen refunderer så mange den rekker innenfor et tidsbudsjett og sier
 * hvor mange som gjenstår. Dialogen kaller den igjen til alt er forsøkt, så
 * et stort show ikke treffer tidsgrensen på serveren.
 *
 * En ordre som feiler stopper ikke løkken så lenge andre blir refundert. En
 * betaling i åpen disputt feiler i hver runde, og ett slikt kjøp skulle ikke
 * tvinge bookeren til å trykke på nytt hvert førtiende sekund. Feilede ordrer
 * forsøkes igjen i neste runde, så tallene fra siste runde er de som fortsatt
 * feiler. Løkken stopper når en runde ikke refunderer noe.
 */
export function RefundShowDialog({
  showId,
  showTitle,
  currency,
  paidOrders,
  paidAmount,
  awaitingRefundOrders,
  awaitingRefundAmount,
  openDisputeOrders,
  disabledReason,
}: {
  showId: string
  showTitle: string
  currency: string
  paidOrders: number
  paidAmount: number
  awaitingRefundOrders: number
  awaitingRefundAmount: number
  openDisputeOrders: number
  /** Satt når knappen ikke kan brukes, med forklaringen som vises ved hover. */
  disabledReason: string | null
}) {
  const [open, setOpen] = useState(false)
  const [typedTitle, setTypedTitle] = useState('')
  const [progress, setProgress] = useState<RefundProgress | null>(null)
  const { isPending, run } = useShowSalesAction()
  const inputId = useId()

  const confirmed = typedTitle.trim() === showTitle.trim()

  async function refundInRounds(title: string): Promise<RefundOutcome> {
    const formData = new FormData()
    formData.set('show_id', showId)
    formData.set('confirm_title', title)

    // `total` for en runde er det som gjensto da runden startet, så summen
    // for hele showet er det som alt er refundert pluss rundens total.
    const outcome: RefundOutcome = { refunded: 0, total: 0, failed: 0, errors: [], remaining: 0, error: null }
    setProgress({ refunded: 0, total: paidOrders + awaitingRefundOrders })

    for (let round = 0; round < MAX_REFUND_ROUNDS; round += 1) {
      let result: Awaited<ReturnType<typeof refundAllShowTicketsAction>>
      try {
        result = await refundAllShowTicketsAction(formData)
      } catch (error) {
        if (isNextControlFlowError(error)) throw error
        outcome.error =
          error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.'
        return outcome
      }

      if ('error' in result) {
        outcome.error = result.error
        return outcome
      }

      outcome.total = outcome.refunded + result.total
      outcome.refunded += result.refunded
      // Ikke summert: en ordre som feilet forsøkes igjen i neste runde.
      outcome.failed = result.failed
      outcome.errors = result.errors
      outcome.remaining = result.remaining
      setProgress({ refunded: outcome.refunded, total: outcome.total })

      // Alt er forsøkt, eller runden kom ingen vei — da er det noe bookeren
      // må se på, og et nytt kall ville bare gjentatt det samme.
      if (result.remaining === 0 || result.refunded === 0) return outcome
    }

    return outcome
  }

  function submit() {
    const title = typedTitle

    run(
      () => refundInRounds(title),
      (outcome) => {
        setProgress(null)

        const done = `Refunded ${outcome.refunded} of ${outcome.total} ${outcome.total === 1 ? 'order' : 'orders'}.`

        if (outcome.error) {
          if (outcome.refunded > 0) {
            toast.error(`${done} Then it stopped.`, {
              description: `${outcome.error}\nThe orders already refunded stay refunded. Try again to continue.`,
              duration: 15000,
            })
          } else {
            toast.error(outcome.error)
          }
          return
        }

        if (outcome.failed > 0) {
          const notTried = outcome.remaining > 0 ? ` ${outcome.remaining} not tried yet.` : ''
          toast.error(`${done} ${outcome.failed} failed.${notTried}`, {
            description: [...outcome.errors.slice(0, 3), 'Check the orders list and try again.'].join('\n'),
            duration: 15000,
          })
        } else if (outcome.remaining > 0) {
          toast.warning(`${done} ${outcome.remaining} still to go.`, {
            description: 'Refunding paused before it was finished. Try again to continue.',
            duration: 15000,
          })
        } else if (outcome.total === 0) {
          toast.success('There was nothing left to refund.')
        } else {
          toast.success(`Refunded all ${outcome.refunded} ${outcome.refunded === 1 ? 'order' : 'orders'}.`)
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

        {openDisputeOrders > 0 && (
          <p className={WARNING_BOX}>
            {openDisputeOrders === 1 ? '1 payment is' : `${openDisputeOrders} payments are`} disputed in Stripe. Stripe
            doesn&apos;t allow a refund while a dispute is open, so {openDisputeOrders === 1 ? 'it' : 'they'} will
            fail until the {openDisputeOrders === 1 ? 'dispute closes' : 'disputes close'}.
          </p>
        )}

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
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {progress && progress.total > 0
              ? `Refunded ${progress.refunded} of ${progress.total}… `
              : 'Refunding… '}
            This can take a few minutes for a large show — keep this window open.
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
