'use client'

import { useState } from 'react'
import { Minus, Plus, Ticket } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { startCheckoutAction } from '@/app/events/actions'
import { type PublicTicketSalesState, ticketSalesButtonLabel } from '@/lib/ticket-sales-display'
import { MAX_TICKETS_PER_ORDER } from '@/lib/tickets'
import { cn } from '@/lib/utils'

/**
 * Kjøpet: antall billetter og ett navn.
 *
 * Det var ett navnefelt per billett, men de fleste kjøper to eller tre og
 * stoppet opp ved et skjema som ba om navnet på alle. Nå er det ett felt:
 * navnet står på alle billettene i ordren, og gruppa finner seg selv i
 * gjestelista under det. Feltet er valgfritt — står det tomt, får billettene
 * kjøperens eget navn fra betalingen (`complete_checkout_order`).
 *
 * Kapasiteten begrenser antallet her, men avgjøres til slutt i oppgjøret
 * (migrasjon 036): siden kan være minutter gammel når betalingen kommer inn.
 *
 * Salgsstatusen kommer ferdig utregnet fra serveren. Er salget ikke åpent,
 * står det på knappen hvorfor — ingen skal fylle ut navn for så å få nei i
 * checkout. Det gjelder også show uten pris og klubber som ikke er klare for
 * salg: de får «Not on sale» (`isPubliclySellable`). Checkout sjekker uansett
 * på nytt når kjøperen trykker.
 */
export function TicketOrder({
  showId,
  slug,
  price,
  soldOut,
  salesState,
  remaining,
  maxPerOrder = MAX_TICKETS_PER_ORDER,
  full,
  className,
  triggerClassName,
  triggerLabel = 'Buy ticket',
}: {
  showId: string
  slug: string
  /** Ferdig formatert pris per billett, f.eks. «250 kr». */
  price: string
  soldOut: boolean
  /** Fra `PublicShow.salesState`. Alt annet enn `open` gir en deaktivert knapp. */
  salesState: PublicTicketSalesState
  /** Ledige plasser, når showet har en kapasitet. */
  remaining: number | null
  maxPerOrder?: number
  full?: boolean
  className?: string
  /** Replaces the default trigger styling — the cards use their own size. */
  triggerClassName?: string
  triggerLabel?: string
}) {
  const limit = Math.max(1, Math.min(maxPerOrder, remaining ?? maxPerOrder))
  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState(1)

  function setCount(next: number) {
    setQuantity(Math.max(1, Math.min(limit, next)))
  }

  const defaultTrigger = cn(
    'inline-flex h-12 items-center justify-center gap-2 px-7 text-[16px] font-semibold transition-colors lg:text-[14px]',
    full && 'w-full',
    'bg-[var(--ev-text)] text-[var(--ev-bg)]',
    'hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
    'disabled:cursor-not-allowed disabled:bg-[var(--ev-card-hover)] disabled:text-[var(--ev-faint)] disabled:hover:bg-[var(--ev-card-hover)]',
    className,
  )
  const buttonClass = triggerClassName ?? defaultTrigger

  // Salgsstatusen går foran «Sold out», i samme rekkefølge som checkout sjekker:
  // at showet er passert eller salget stengt, er det kjøperen trenger å vite.
  const blockedLabel = ticketSalesButtonLabel(salesState) ?? (soldOut ? 'Sold out' : null)

  if (blockedLabel) {
    return (
      <button
        type="button"
        disabled
        className={cn(buttonClass, 'whitespace-nowrap')}
        style={{ borderRadius: 'var(--ev-r-chip)' }}
      >
        <Ticket className="size-4" /> {blockedLabel}
      </button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonClass} style={{ borderRadius: 'var(--ev-r-chip)' }}>
        <Ticket className="size-4" /> {triggerLabel}
      </DialogTrigger>

      <DialogContent
        className="ev-surface max-w-md gap-5 bg-[var(--ev-bg)] text-[var(--ev-text)]"
        data-tone="light"
      >
        <DialogHeader>
          <DialogTitle className="text-[22px] font-semibold">How many tickets?</DialogTitle>
          <DialogDescription className="text-[var(--ev-faint)]">{price} per ticket.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4">
          <span className="text-[15px] font-medium">Tickets</span>
          <div
            className="flex items-center gap-1 bg-[var(--ev-card)] p-1"
            style={{ borderRadius: 'var(--ev-r-chip)' }}
          >
            <StepButton label="One fewer" onClick={() => setCount(quantity - 1)} disabled={quantity <= 1}>
              <Minus className="size-4" />
            </StepButton>
            <span className="w-10 text-center text-[17px] font-semibold tabular-nums">{quantity}</span>
            <StepButton label="One more" onClick={() => setCount(quantity + 1)} disabled={quantity >= limit}>
              <Plus className="size-4" />
            </StepButton>
          </div>
        </div>

        {quantity >= limit && (
          <p className="-mt-2 text-[13px] text-[var(--ev-faint)]">
            {remaining !== null && remaining <= maxPerOrder
              ? `Only ${remaining} ${remaining === 1 ? 'ticket' : 'tickets'} left for this show.`
              : `${maxPerOrder} tickets per order. Contact the club for larger groups.`}
          </p>
        )}

        <ToastActionForm action={startCheckoutAction} className="flex flex-col gap-3">
          <input type="hidden" name="show_id" value={showId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="quantity" value={quantity} />

          {/* Ett navn for hele ordren — serveren setter det på alle billettene. */}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-[var(--ev-faint)]">
              {quantity === 1 ? 'Name on the ticket' : 'Name on the tickets'}
            </span>
            <input
              name="holder_name"
              placeholder="Your name"
              maxLength={120}
              autoComplete="name"
              className="h-11 w-full bg-[var(--ev-card)] px-4 text-[15px] text-[var(--ev-text)] outline-none placeholder:text-[var(--ev-faint)] focus:ring-2 focus:ring-[var(--ev-accent-fill)]"
              style={{ borderRadius: 'var(--ev-r-card)' }}
            />
          </label>

          <button
            type="submit"
            className={cn(defaultTrigger, 'w-full')}
            style={{ borderRadius: 'var(--ev-r-chip)' }}
          >
            Continue to payment
          </button>
          <p className="text-center text-[12px] text-[var(--ev-faint)]">Payment opens in secure checkout.</p>
        </ToastActionForm>
      </DialogContent>
    </Dialog>
  )
}

function StepButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-full text-[var(--ev-text)] transition-colors hover:bg-[var(--ev-card-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
