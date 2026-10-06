'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Minus, Plus, Ticket } from 'lucide-react'
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
import { formatTicketPrice } from '@/lib/public-show-format'
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
 *
 * På mobil er dette et ark fra bunnen: knappen som åpnet det ligger i
 * bunnlinja, og arket kommer opp der tommelen allerede er. Fra `sm` er det en
 * vanlig dialog midt på skjermen.
 *
 * Summen står på knappen. «250 kr per billett» er ikke det kjøperen betaler
 * når hun har valgt tre — og Stripe skal ikke være første sted hun ser tallet.
 */
export function TicketOrder({
  showId,
  slug,
  title,
  summary,
  ticketPrice,
  currency,
  external,
  soldOut,
  salesState,
  remaining,
  maxPerOrder = MAX_TICKETS_PER_ORDER,
  full,
  className,
  triggerClassName,
  triggerLabel = 'Buy tickets',
  initialQuantity = 1,
  autoOpen,
}: {
  showId: string
  slug: string
  /** Showets navn — overskriften i arket, så kjøperen ser hva hun kjøper. */
  title?: string
  /** Én linje med dato, tid og sted under overskriften. */
  summary?: string
  /** Pris per billett i minste valutaenhet, som `shows.ticket_price`. */
  ticketPrice: number | null
  currency: string
  /**
   * Showet selges på en ekstern billettside (`shows.ticket_url`). Da finnes
   * det ingenting å velge her — antall og navn ville blitt kastet idet
   * kjøperen sendes videre — så knappen går rett til checkout-handlingen.
   */
  external?: boolean
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
  /** Antallet arket starter på — kjøperen som avbrøt betalingen får sitt tilbake. */
  initialQuantity?: number
  /**
   * Åpner arket når siden lastes. Showsiden har to knapper — kjøpsblokka på
   * desktop og bunnlinja på mobil — og bare den som faktisk vises skal åpne.
   */
  autoOpen?: boolean
}) {
  const limit = Math.max(1, Math.min(maxPerOrder, remaining ?? maxPerOrder))
  const [open, setOpen] = useState(false)
  const [quantity, setQuantity] = useState(() => Math.max(1, Math.min(limit, Math.floor(initialQuantity) || 1)))
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // `getClientRects` og ikke `offsetParent`: bunnlinja er `position: fixed`,
    // og da er `offsetParent` null også når knappen er synlig.
    if (autoOpen && triggerRef.current?.getClientRects().length) setOpen(true)
  }, [autoOpen])

  const price = formatTicketPrice({ ticket_price: ticketPrice, currency })
  const total = formatTicketPrice({ ticket_price: (ticketPrice ?? 0) * quantity, currency })

  function setCount(next: number) {
    setQuantity(Math.max(1, Math.min(limit, next)))
  }

  const defaultTrigger = cn(
    'inline-flex h-12 items-center justify-center gap-2 px-7 text-[16px] font-semibold transition-colors lg:text-[14px]',
    full && 'w-full',
    // Oransje, fordi kjøpet er det eneste på siden som skal trekke blikket.
    'bg-[var(--ev-accent-fill)] text-[var(--ev-accent-ink)]',
    'hover:bg-[var(--ev-text)] hover:text-[var(--ev-bg)]',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-text)]',
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

  if (external) {
    return (
      <ToastActionForm action={startCheckoutAction} className={cn('group', full && 'w-full')}>
        <input type="hidden" name="show_id" value={showId} />
        <input type="hidden" name="slug" value={slug} />
        <button type="submit" className={cn(buttonClass, 'whitespace-nowrap')} style={{ borderRadius: 'var(--ev-r-chip)' }}>
          <Ticket className="size-4 group-data-[pending]:hidden" />
          <Loader2 className="hidden size-4 animate-spin group-data-[pending]:block" aria-hidden />
          {triggerLabel}
        </button>
      </ToastActionForm>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger ref={triggerRef} className={buttonClass} style={{ borderRadius: 'var(--ev-r-chip)' }}>
        <Ticket className="size-4" /> {triggerLabel}
      </DialogTrigger>

      <DialogContent
        className={cn(
          'ev-surface max-w-md gap-5 bg-[var(--ev-bg)] text-[var(--ev-text)]',
          // Under `sm`: et ark i full bredde fra bunnen i stedet for en boks
          // midt på skjermen.
          'max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0',
          'max-sm:rounded-b-none max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]',
          'max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=open]:slide-in-from-bottom-10',
          'max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=closed]:slide-out-to-bottom-10',
        )}
        data-tone="light"
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="text-balance text-[22px] font-semibold leading-tight">
            {title ?? 'How many tickets?'}
          </DialogTitle>
          <DialogDescription className="text-[15px] text-[var(--ev-muted)] sm:text-[14px]">
            {summary ?? `${price} per ticket.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[17px] font-semibold sm:text-[15px]">Tickets</div>
            <div className="text-[14px] text-[var(--ev-muted)] sm:text-[13px]">{price} each</div>
          </div>
          <div
            className="flex items-center gap-1 bg-[var(--ev-card)] p-1"
            style={{ borderRadius: 'var(--ev-r-chip)' }}
          >
            <StepButton label="One fewer" onClick={() => setCount(quantity - 1)} disabled={quantity <= 1}>
              <Minus className="size-4" />
            </StepButton>
            <span aria-live="polite" className="w-10 text-center text-[19px] font-semibold tabular-nums sm:text-[17px]">
              {quantity}
            </span>
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

        <ToastActionForm action={startCheckoutAction} className="group flex flex-col gap-5">
          <input type="hidden" name="show_id" value={showId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="quantity" value={quantity} />

          {/* Ett navn for hele ordren — serveren setter det på alle billettene. */}
          {/* «Optional» står på feltet: uten det ser navnet påkrevd ut, og
              kjøperen stopper for å finne ut hva som skal stå der. */}
          <label className="flex flex-col gap-1.5">
            <span className="flex justify-between gap-3 text-[14px] text-[var(--ev-muted)] sm:text-[13px]">
              <span>{quantity === 1 ? 'Name on the ticket' : 'Name on the tickets'}</span>
              <span>Optional</span>
            </span>
            <input
              name="holder_name"
              placeholder="Your name"
              maxLength={120}
              autoComplete="name"
              className="h-12 w-full bg-[var(--ev-card)] px-4 text-[16px] text-[var(--ev-text)] outline-none placeholder:text-[var(--ev-faint)] focus:ring-2 focus:ring-[var(--ev-accent-fill)] sm:h-11 sm:text-[15px]"
              style={{ borderRadius: 'var(--ev-r-card)' }}
            />
            <span className="text-[13px] text-[var(--ev-faint)]">
              Leave it empty and we use the name from your payment.
            </span>
          </label>

          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4 border-t border-[var(--ev-line)] pt-4">
              <span className="text-[15px] text-[var(--ev-muted)] sm:text-[14px]">Total</span>
              <span className="text-[20px] font-semibold tabular-nums">{total}</span>
            </div>

            {/* Sesjonen hos Stripe tar et sekund eller to å lage. Uten en synlig
                tilstand ser knappen død ut, og kjøperen trykker en gang til. */}
            <button
              type="submit"
              className={cn(defaultTrigger, 'h-14 w-full sm:h-12')}
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              <span className="group-data-[pending]:hidden">Continue to payment · {total}</span>
              <span className="hidden items-center gap-2 group-data-[pending]:inline-flex">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Opening checkout…
              </span>
            </button>
            <p className="text-center text-[13px] text-[var(--ev-faint)] sm:text-[12px]">
              Secure checkout · pay by card
            </p>
          </div>
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
      className="flex size-11 items-center sm:size-9 justify-center rounded-full text-[var(--ev-text)] transition-colors hover:bg-[var(--ev-card-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
