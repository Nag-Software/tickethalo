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
import { MAX_TICKETS_PER_ORDER } from '@/lib/tickets'
import { cn } from '@/lib/utils'

/**
 * Kjøpet: antall billetter, og et navn på hver av dem.
 *
 * Navnet står på billetten og i døra, så en gruppe slipper å samles rundt én
 * telefon. Feltene er valgfrie — mangler et navn, får billetten kjøperens
 * eget, som er bedre enn en tom linje foran en dørvakt.
 *
 * Kapasiteten begrenser antallet her, men avgjøres til slutt i oppgjøret
 * (migrasjon 036): siden kan være minutter gammel når betalingen kommer inn.
 */
export function TicketOrder({
  showId,
  slug,
  price,
  soldOut,
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
  const [names, setNames] = useState<string[]>([''])

  function setCount(next: number) {
    const clamped = Math.max(1, Math.min(limit, next))
    setQuantity(clamped)
    setNames((current) => {
      const copy = current.slice(0, clamped)
      while (copy.length < clamped) copy.push('')
      return copy
    })
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

  if (soldOut) {
    return (
      <button type="button" disabled className={buttonClass} style={{ borderRadius: 'var(--ev-r-chip)' }}>
        <Ticket className="size-4" /> Sold out
      </button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={buttonClass} style={{ borderRadius: 'var(--ev-r-chip)' }}>
        <Ticket className="size-4" /> {triggerLabel}
      </DialogTrigger>

      {/* Ti navnefelter er høyere enn en telefonskjerm. Navnelista får derfor
          et tak og ruller for seg, slik at antallet og «Continue to payment»
          står stille mens man fyller ut.
          Taket er en max-høyde og ikke `flex-1`: i en flex-kolonne uten egen
          høyde har `flex-1` basis 0, og lista kollapser til ingenting. */}
      <DialogContent
        className="ev-surface max-h-[85dvh] max-w-md gap-5 overflow-hidden bg-[var(--ev-bg)] text-[var(--ev-text)]"
        data-tone="light"
      >
        <DialogHeader>
          <DialogTitle className="text-[22px] font-semibold">How many tickets?</DialogTitle>
          <DialogDescription className="text-[var(--ev-faint)]">
            {price} per ticket. Put a name on each one — it is the name we check at the door.
          </DialogDescription>
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

        <ToastActionForm action={startCheckoutAction} className="flex min-h-0 flex-col gap-3">
          <input type="hidden" name="show_id" value={showId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="quantity" value={quantity} />

          <div className="-mr-1 flex max-h-[42dvh] flex-col gap-2 overflow-y-auto pr-1">
            {names.map((name, index) => (
              <label key={index} className="flex flex-col gap-1">
                <span className="text-[12px] text-[var(--ev-faint)]">
                  {quantity === 1 ? 'Name on the ticket' : `Ticket ${index + 1}`}
                </span>
                <input
                  name="holder_name"
                  value={name}
                  onChange={(event) =>
                    setNames((current) => current.map((value, position) => (position === index ? event.target.value : value)))
                  }
                  placeholder={index === 0 ? 'Your name' : 'Name of guest'}
                  maxLength={120}
                  autoComplete={index === 0 ? 'name' : 'off'}
                  className="h-11 w-full bg-[var(--ev-card)] px-4 text-[15px] text-[var(--ev-text)] outline-none placeholder:text-[var(--ev-faint)] focus:ring-2 focus:ring-[var(--ev-accent-fill)]"
                  style={{ borderRadius: 'var(--ev-r-card)' }}
                />
              </label>
            ))}
          </div>

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
