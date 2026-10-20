'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
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
import { startCheckoutAction, unlockTicketTypesAction } from '@/app/events/actions'
import { formatAmount } from '@/lib/public-show-format'
import { type PublicTicketSalesState, ticketSalesButtonLabel } from '@/lib/ticket-sales-display'
import { DEFAULT_TICKET_TYPE_NAME, type PublicTicketType, formatDiscount } from '@/lib/ticket-types'
import { MAX_TICKETS_PER_ORDER } from '@/lib/tickets'
import { cn } from '@/lib/utils'

export const MARKETING_OPT_IN_LABEL = 'Yes, I want to receive emails so that I don’t miss upcoming shows.'

const FIELD_CLASS =
  'h-12 w-full bg-[var(--ev-card)] px-4 text-[16px] text-[var(--ev-text)] outline-none placeholder:text-[var(--ev-faint)] focus:ring-2 focus:ring-[var(--ev-accent-fill)] sm:h-11 sm:text-[15px]'

/**
 * Kjøpet: antall per billettype.
 *
 * Hver type har sin egen stepper, med prisen kjøperen betaler (og den fulle,
 * overstreket, når typen har rabatt). Typer som krever kode vises ikke før
 * kjøperen har tastet inn koden — serveren sender dem først da
 * (`unlockTicketTypesAction`), så koden aldri ligger i siden.
 *
 * Navnet på billettene kommer fra betalingen (Stripe), så det spørres ikke
 * om her. En kurv med bare gratis typer har ingen betaling å hente det fra:
 * da spør arket om navn og e-post selv og sender billettene direkte
 * (`lib/checkout/free.ts`). En kurv med både gratis og betalte typer går
 * gjennom Stripe, og de gratis billettene følger med.
 *
 * Kapasiteten begrenser antallene her, men avgjøres til slutt i oppgjøret
 * (`complete_checkout_order`): siden kan være minutter gammel når betalingen
 * kommer inn.
 *
 * Salgsstatusen kommer ferdig utregnet fra serveren. Er salget ikke åpent,
 * står det på knappen hvorfor — ingen skal velge billetter for så å få nei i
 * checkout. Checkout sjekker uansett på nytt når kjøperen trykker.
 *
 * På mobil er dette et ark fra bunnen: knappen som åpnet det ligger i
 * bunnlinja, og arket kommer opp der tommelen allerede er. Fra `sm` er det en
 * vanlig dialog midt på skjermen.
 *
 * Summen står på knappen. Prisen per billett er ikke det kjøperen betaler
 * når hun har valgt tre — og Stripe skal ikke være første sted hun ser tallet.
 */
export function TicketOrder({
  showId,
  slug,
  title,
  summary,
  currency,
  ticketTypes,
  hasLockedTypes = false,
  external,
  soldOut,
  salesState,
  remaining,
  maxPerOrder = MAX_TICKETS_PER_ORDER,
  full,
  className,
  triggerClassName,
  triggerLabel = 'Buy tickets',
  initialQuantities,
  autoOpen,
}: {
  showId: string
  slug: string
  /** Showets navn — overskriften i arket, så kjøperen ser hva hun kjøper. */
  title?: string
  /** Én linje med dato, tid og sted under overskriften. */
  summary?: string
  currency: string
  /** Fra `PublicShow.ticketTypes`: de offentlige typene, uten koder. */
  ticketTypes: PublicTicketType[]
  /** Showet har typer som låses opp med kode. Da vises kodefeltet. */
  hasLockedTypes?: boolean
  /**
   * Showet selges på en ekstern billettside (`shows.ticket_url`). Da finnes
   * det ingenting å velge her — antallene ville blitt kastet idet kjøperen
   * sendes videre — så knappen går rett til checkout-handlingen.
   */
  external?: boolean
  soldOut: boolean
  /** Fra `PublicShow.salesState`. Alt annet enn `open` gir en deaktivert knapp. */
  salesState: PublicTicketSalesState
  /** Ledige plasser i hele showet, når showet har en kapasitet. */
  remaining: number | null
  maxPerOrder?: number
  full?: boolean
  className?: string
  /** Replaces the default trigger styling — the cards use their own size. */
  triggerClassName?: string
  triggerLabel?: string
  /** Antallene arket starter på — kjøperen som avbrøt betalingen får sine tilbake. */
  initialQuantities?: Record<string, number>
  /**
   * Åpner arket når siden lastes. Showsiden har to knapper — kjøpsblokka på
   * desktop og bunnlinja på mobil — og bare den som faktisk vises skal åpne.
   */
  autoOpen?: boolean
}) {
  const orderLimit = Math.max(1, Math.min(maxPerOrder, remaining ?? maxPerOrder))
  const [open, setOpen] = useState(false)
  const [unlocked, setUnlocked] = useState<PublicTicketType[]>([])
  const [promoCode, setPromoCode] = useState<string | null>(null)
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    startingQuantities(ticketTypes, initialQuantities, orderLimit),
  )
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // `getClientRects` og ikke `offsetParent`: bunnlinja er `position: fixed`,
    // og da er `offsetParent` null også når knappen er synlig.
    if (autoOpen && triggerRef.current?.getClientRects().length) setOpen(true)
  }, [autoOpen])

  const types = useMemo(() => {
    const ids = new Set(ticketTypes.map((type) => type.id))
    return [...ticketTypes, ...unlocked.filter((type) => !ids.has(type.id))]
  }, [ticketTypes, unlocked])

  const selected = types.filter((type) => (quantities[type.id] ?? 0) > 0)
  const quantity = selected.reduce((sum, type) => sum + (quantities[type.id] ?? 0), 0)
  const amount = selected.reduce((sum, type) => sum + type.unitAmount * (quantities[type.id] ?? 0), 0)
  const free = quantity > 0 && amount === 0
  const total = formatAmount(amount, currency)
  const allFree = types.length > 0 && types.every((type) => type.unitAmount === 0)
  const label = allFree && triggerLabel === 'Buy tickets' ? 'Reserve tickets' : triggerLabel
  const single = types.length === 1 && types[0].name === DEFAULT_TICKET_TYPE_NAME

  function setCount(type: PublicTicketType, next: number) {
    setQuantities((previous) => {
      const others = quantity - (previous[type.id] ?? 0)
      const cap = Math.min(type.remaining ?? orderLimit, orderLimit - others)
      return { ...previous, [type.id]: Math.max(0, Math.min(cap, next)) }
    })
  }

  function addUnlocked(found: PublicTicketType[], code: string) {
    setUnlocked(found)
    setPromoCode(code)
    // Den første som kan kjøpes, får én billett — det er derfor koden ble tastet.
    const first = found.find((type) => type.available)
    if (first && quantity < orderLimit) {
      setQuantities((previous) => ({ ...previous, [first.id]: Math.max(previous[first.id] ?? 0, 1) }))
    }
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
          {label}
        </button>
      </ToastActionForm>
    )
  }

  const onlyPrice = single ? formatAmount(types[0].unitAmount, currency) : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger ref={triggerRef} className={buttonClass} style={{ borderRadius: 'var(--ev-r-chip)' }}>
        <Ticket className="size-4" /> {label}
      </DialogTrigger>

      <DialogContent
        className={cn(
          'ev-surface max-w-md gap-5 bg-[var(--ev-bg)] text-[var(--ev-text)]',
          // Under `sm`: et ark i full bredde fra bunnen i stedet for en boks
          // midt på skjermen. Mange typer kan gjøre det høyt, så det ruller.
          'max-h-[92svh] overflow-y-auto',
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
            {summary ?? (allFree ? 'Free tickets — sent to your email.' : onlyPrice ? `${onlyPrice} per ticket.` : 'Pick your tickets.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {types.map((type) => (
            <TicketTypeRow
              key={type.id}
              type={type}
              currency={currency}
              label={single ? 'Tickets' : type.name}
              count={quantities[type.id] ?? 0}
              canAdd={quantity < orderLimit && (type.remaining === null || (quantities[type.id] ?? 0) < type.remaining)}
              onChange={(next) => setCount(type, next)}
            />
          ))}
        </div>

        {quantity >= orderLimit && (
          <p className="-mt-2 text-[13px] text-[var(--ev-faint)]">
            {remaining !== null && remaining <= maxPerOrder
              ? `Only ${remaining} ${remaining === 1 ? 'ticket' : 'tickets'} left for this show.`
              : `${maxPerOrder} tickets per order. Contact the club for larger groups.`}
          </p>
        )}

        {hasLockedTypes && !promoCode && <PromoCodeField showId={showId} onUnlocked={addUnlocked} />}

        <ToastActionForm action={startCheckoutAction} className="group flex flex-col gap-5">
          <input type="hidden" name="show_id" value={showId} />
          <input type="hidden" name="slug" value={slug} />
          {selected.map((type) => (
            <input key={type.id} type="hidden" name={`qty_${type.id}`} value={quantities[type.id]} />
          ))}
          {promoCode && <input type="hidden" name="promo_code" value={promoCode} />}

          {free && (
            <>
              {/* Ingen betaling å hente navn og adresse fra: begge må inn her.
                  Navnet står på alle billettene i ordren. */}
              <label className="flex flex-col gap-1.5">
                <span className="text-[14px] text-[var(--ev-muted)] sm:text-[13px]">
                  {quantity === 1 ? 'Name on the ticket' : 'Name on the tickets'}
                </span>
                <input
                  name="buyer_name"
                  placeholder="Your name"
                  maxLength={120}
                  autoComplete="name"
                  required
                  className={FIELD_CLASS}
                  style={{ borderRadius: 'var(--ev-r-card)' }}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[14px] text-[var(--ev-muted)] sm:text-[13px]">Email</span>
                <input
                  name="buyer_email"
                  type="email"
                  placeholder="you@example.com"
                  maxLength={254}
                  autoComplete="email"
                  inputMode="email"
                  required
                  className={FIELD_CLASS}
                  style={{ borderRadius: 'var(--ev-r-card)' }}
                />
                <span className="text-[13px] text-[var(--ev-faint)]">
                  The tickets are sent here. One reservation per email address.
                </span>
              </label>
            </>
          )}

          {/* Av som standard: samtykket skal være kjøperens eget valg. */}
          <label className="flex items-start gap-3 text-[14px] leading-snug text-[var(--ev-muted)] sm:text-[13px]">
            <input
              type="checkbox"
              name="marketing_opt_in"
              className="mt-0.5 size-5 shrink-0 accent-[var(--ev-accent-fill)] sm:size-4"
            />
            <span>{MARKETING_OPT_IN_LABEL}</span>
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
              disabled={quantity === 0}
              className={cn(defaultTrigger, 'h-14 w-full sm:h-12')}
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              <span className="group-data-[pending]:hidden">
                {quantity === 0
                  ? 'Pick your tickets'
                  : free
                    ? `Get ${quantity === 1 ? 'the ticket' : `${quantity} tickets`}`
                    : `Continue to payment · ${total}`}
              </span>
              <span className="hidden items-center gap-2 group-data-[pending]:inline-flex">
                <Loader2 className="size-4 animate-spin" aria-hidden /> {free ? 'Reserving…' : 'Opening checkout…'}
              </span>
            </button>
            <p className="text-center text-[13px] text-[var(--ev-faint)] sm:text-[12px]">
              {free ? 'Free · no payment needed' : 'Secure checkout · pay by card'}
            </p>
          </div>
        </ToastActionForm>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Antallene arket starter på: det kjøperen hadde (avbrutt betaling), ellers
 * én billett av den første typen som kan kjøpes — som før typene.
 */
function startingQuantities(
  types: PublicTicketType[],
  initial: Record<string, number> | undefined,
  limit: number,
): Record<string, number> {
  const result: Record<string, number> = {}
  let left = limit
  for (const type of types) {
    const wanted = Math.floor(initial?.[type.id] ?? 0)
    if (!type.available || wanted <= 0 || left <= 0) continue
    const take = Math.min(wanted, left, type.remaining ?? left)
    if (take > 0) {
      result[type.id] = take
      left -= take
    }
  }
  if (Object.keys(result).length > 0) return result

  const first = types.find((type) => type.available)
  return first ? { [first.id]: 1 } : {}
}

function TicketTypeRow({
  type,
  currency,
  label,
  count,
  canAdd,
  onChange,
}: {
  type: PublicTicketType
  currency: string
  label: string
  count: number
  canAdd: boolean
  onChange: (next: number) => void
}) {
  const price = formatAmount(type.unitAmount, currency)
  const note = type.soldOut
    ? 'Sold out'
    : !type.available
      ? 'Not on sale'
      : type.remaining !== null && type.remaining <= 10
        ? `${type.remaining} left`
        : null

  return (
    <div className={cn('flex items-center justify-between gap-4', !type.available && 'opacity-60')}>
      <div className="min-w-0">
        <div className="text-[17px] font-semibold sm:text-[15px]">{label}</div>
        <div className="flex flex-wrap items-baseline gap-x-2 text-[14px] text-[var(--ev-muted)] sm:text-[13px]">
          {type.discountBps > 0 && type.unitAmount !== type.price && (
            <s className="text-[var(--ev-faint)]">{formatAmount(type.price, currency)}</s>
          )}
          <span>{type.unitAmount === 0 ? 'Free' : `${price} each`}</span>
          {type.discountBps > 0 && <span>{formatDiscount(type.discountBps)} off</span>}
          {note && <span className="text-[var(--ev-faint)]">· {note}</span>}
        </div>
      </div>
      <div
        className="flex shrink-0 items-center gap-1 bg-[var(--ev-card)] p-1"
        style={{ borderRadius: 'var(--ev-r-chip)' }}
      >
        <StepButton label={`One fewer ${label}`} onClick={() => onChange(count - 1)} disabled={count <= 0}>
          <Minus className="size-4" />
        </StepButton>
        <span aria-live="polite" className="w-10 text-center text-[19px] font-semibold tabular-nums sm:text-[17px]">
          {count}
        </span>
        <StepButton
          label={`One more ${label}`}
          onClick={() => onChange(count + 1)}
          disabled={!type.available || !canAdd}
        >
          <Plus className="size-4" />
        </StepButton>
      </div>
    </div>
  )
}

/**
 * Kodefeltet. Ligger utenfor bestillingsskjemaet, så Enter her låser opp i
 * stedet for å sende kjøperen til betaling.
 */
function PromoCodeField({
  showId,
  onUnlocked,
}: {
  showId: string
  onUnlocked: (types: PublicTicketType[], code: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="-mt-1 self-start text-[14px] font-medium text-[var(--ev-muted)] underline underline-offset-4 hover:text-[var(--ev-text)] sm:text-[13px]"
      >
        Have a promo code?
      </button>
    )
  }

  function apply() {
    const value = code.trim()
    if (!value) return
    setError(null)
    startTransition(async () => {
      const result = await unlockTicketTypesAction(showId, value)
      if (result.types.length === 0) {
        setError('That code does not unlock any tickets for this show.')
        return
      }
      onUnlocked(result.types, value.toUpperCase())
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[14px] text-[var(--ev-muted)] sm:text-[13px]">Promo code</span>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              apply()
            }
          }}
          maxLength={40}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          className={cn(FIELD_CLASS, 'uppercase')}
          style={{ borderRadius: 'var(--ev-r-card)' }}
        />
        <button
          type="button"
          onClick={apply}
          disabled={pending || !code.trim()}
          className="inline-flex h-12 shrink-0 items-center gap-2 bg-[var(--ev-text)] px-5 text-[15px] font-semibold text-[var(--ev-bg)] disabled:opacity-50 sm:h-11 sm:text-[14px]"
          style={{ borderRadius: 'var(--ev-r-chip)' }}
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />} Apply
        </button>
      </div>
      {error && <span className="text-[13px] text-[var(--ev-accent)]">{error}</span>}
    </div>
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
