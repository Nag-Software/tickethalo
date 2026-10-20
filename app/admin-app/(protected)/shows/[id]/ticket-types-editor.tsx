'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, LoaderCircle, Plus, Trash2, TriangleAlert } from 'lucide-react'
import {
  FIELD_ADDON_CLASS,
  FIELD_GROUP_CLASS,
  FIELD_HINT_CLASS,
  FIELD_INPUT_CLASS,
  FIELD_TRIGGER_CLASS,
  NUMBER_INPUT_CLASS,
  TIME_INPUT_CLASS,
} from '@/components/admin/form-fields'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  type AdminTicketType,
  EMPTY_TICKET_TYPE_VALUES,
  type TicketTypeFormValues,
  fromFormValues,
  toFormValues,
} from '@/lib/admin-ticket-types'
import { DEFAULT_TICKET_TYPE_NAME, SALES_END_OPTIONS, effectiveUnitAmount } from '@/lib/ticket-types'
import { MIN_TICKET_PRICE_MINOR } from '@/lib/tickets'
import { cn } from '@/lib/utils'
import { removeTicketTypeAction, saveTicketTypeAction } from '../ticket-type-actions'

/** Som detaljskjemaet: lagres når bookeren slutter å skrive, eller forlater feltet. */
const AUTOSAVE_DELAY_MS = 800

const VALUE_KEYS = Object.keys(EMPTY_TICKET_TYPE_VALUES) as Array<keyof TicketTypeFormValues>

function sameValues(left: TicketTypeFormValues, right: TicketTypeFormValues | null) {
  return right !== null && VALUE_KEYS.every((key) => left[key] === right[key])
}

/** Navn og pris må stå før en ny type kan lagres. */
function readyToSave(values: TicketTypeFormValues) {
  return Boolean(values.name.trim() && values.price.trim())
}

type Row = { key: string; type: AdminTicketType | null }

/**
 * Billettypene på showet: én boks per type, og «Add new ticket type» under.
 *
 * Hver boks lagrer seg selv, som resten av detaljskjemaet. Den står inne i
 * skjemaet visuelt, men er ikke et skjema selv — skjemaer kan ikke ligge i
 * hverandre.
 */
export function TicketTypesEditor({
  showId,
  currency,
  initialTypes,
}: {
  showId: string
  currency: string
  initialTypes: AdminTicketType[]
}) {
  const [rows, setRows] = useState<Row[]>(() => initialTypes.map((type) => ({ key: type.id, type })))
  const counter = useRef(0)

  function addRow() {
    counter.current += 1
    setRows((previous) => [...previous, { key: `new-${counter.current}`, type: null }])
  }

  return (
    <div className="col-span-12 flex flex-col gap-3">
      {rows.map((row, index) => (
        <TicketTypeCard
          key={row.key}
          showId={showId}
          currency={currency}
          initial={row.type}
          defaultName={rows.length === 1 && !row.type ? DEFAULT_TICKET_TYPE_NAME : ''}
          canRemove={rows.length > 1 || !row.type}
          index={index}
          onRemoved={() => setRows((previous) => previous.filter((candidate) => candidate.key !== row.key))}
        />
      ))}

      {rows.length === 0 && (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          No ticket types yet. Add one to put the show on sale.
        </p>
      )}

      <Button type="button" variant="outline" size="sm" onClick={addRow} className="self-start">
        <Plus className="size-4" /> Add new ticket type
      </Button>
    </div>
  )
}

function TicketTypeCard({
  showId,
  currency,
  initial,
  defaultName,
  canRemove,
  index,
  onRemoved,
}: {
  showId: string
  currency: string
  initial: AdminTicketType | null
  defaultName: string
  canRemove: boolean
  index: number
  onRemoved: () => void
}) {
  const router = useRouter()
  const startValues = initial ? toFormValues(initial) : { ...EMPTY_TICKET_TYPE_VALUES, name: defaultName }
  const [values, setValues] = useState<TicketTypeFormValues>(startValues)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [sold, setSold] = useState(initial?.sold ?? 0)
  const [saved, setSaved] = useState(Boolean(initial))
  const [removing, startRemoving] = useTransition()

  const idRef = useRef<string | null>(initial?.id ?? null)
  const savedRef = useRef<TicketTypeFormValues | null>(initial ? startValues : null)
  const valuesRef = useRef(values)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Én lagring om gangen: en ny type som lagres to ganger samtidig ville
  // blitt to rader.
  const inFlightRef = useRef(false)
  const againRef = useRef(false)

  useEffect(() => {
    valuesRef.current = values
  }, [values])

  // Lagringen ligger i en ref: den kaller seg selv når en endring kom mens
  // forrige lagring pågikk, og tidtakeren skal alltid treffe den nyeste.
  const persistRef = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    persistRef.current = async () => {
      const next = valuesRef.current
      if (sameValues(next, savedRef.current) || !readyToSave(next)) return
      if (inFlightRef.current) {
        againRef.current = true
        return
      }

      inFlightRef.current = true
      setStatus('saving')
      try {
        const result = await saveTicketTypeAction(showId, idRef.current, next)
        if ('error' in result) {
          setStatus('error')
          setError(result.error)
          // Samme verdier skal ikke prøves igjen før bookeren endrer noe.
          savedRef.current = next
          return
        }
        idRef.current = result.type.id
        savedRef.current = next
        setSaved(true)
        setSold(result.type.sold)
        setError(null)
        setStatus('saved')
        router.refresh()
      } catch {
        setStatus('error')
        setError('Could not save the ticket type. Try again.')
      } finally {
        inFlightRef.current = false
        if (againRef.current) {
          againRef.current = false
          void persistRef.current()
        }
      }
    }
  }, [router, showId])

  useEffect(() => {
    if (sameValues(values, savedRef.current) || !readyToSave(values)) return
    timerRef.current = setTimeout(() => void persistRef.current(), AUTOSAVE_DELAY_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [values])

  function flush() {
    if (timerRef.current) clearTimeout(timerRef.current)
    void persistRef.current()
  }

  function update(key: keyof TicketTypeFormValues, value: string) {
    setValues((previous) => ({ ...previous, [key]: value }))
  }

  function remove() {
    if (timerRef.current) clearTimeout(timerRef.current)
    const id = idRef.current
    if (!id) {
      onRemoved()
      return
    }
    startRemoving(async () => {
      try {
        const result = await removeTicketTypeAction(showId, id)
        if ('error' in result) {
          toast.error(result.error)
          return
        }
        toast.success(
          result.removed === 'archived'
            ? 'Ticket type removed. Tickets already sold are still valid.'
            : 'Ticket type removed.',
        )
        onRemoved()
        router.refresh()
      } catch {
        toast.error('Could not remove the ticket type. Try again.')
      }
    })
  }

  const input = fromFormValues(values)
  const unit = input.price !== null && Number.isFinite(input.price) ? effectiveUnitAmount(input.price, input.discount_bps || 0) : null
  const discounted = unit !== null && input.discount_bps > 0 && Number.isFinite(input.discount_bps)
  const custom = values.sales_end === 'custom'
  const prefix = `ticket-type-${index}`

  return (
    <div
      className="rounded-xl border bg-background p-3 @container"
      onBlur={flush}
      onKeyDown={(event) => {
        // Enter i et felt betyr «lagre nå», som i resten av skjemaet.
        if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
          event.preventDefault()
          flush()
        }
      }}
    >
      <div className="grid grid-cols-12 gap-x-3 gap-y-3">
        <Field className="col-span-12 min-w-0 gap-1.5 @lg:col-span-6">
          <FieldLabel htmlFor={`${prefix}-name`}>Ticket name</FieldLabel>
          <div className={FIELD_GROUP_CLASS}>
            <Input
              id={`${prefix}-name`}
              value={values.name}
              maxLength={60}
              onChange={(event) => update('name', event.target.value)}
              placeholder="Student, Early-bird …"
              aria-invalid={Boolean(error) && !values.name.trim()}
              className={FIELD_INPUT_CLASS}
            />
          </div>
        </Field>
        <Field className="col-span-6 min-w-0 gap-1.5 @lg:col-span-3">
          <FieldLabel htmlFor={`${prefix}-quantity`}>Amount of tickets</FieldLabel>
          <div className={FIELD_GROUP_CLASS}>
            <Input
              id={`${prefix}-quantity`}
              type="number"
              min={0}
              value={values.quantity}
              onChange={(event) => update('quantity', event.target.value)}
              placeholder="Unlimited"
              className={cn(FIELD_INPUT_CLASS, NUMBER_INPUT_CLASS)}
            />
          </div>
        </Field>
        <Field className="col-span-6 min-w-0 gap-1.5 @lg:col-span-3">
          <FieldLabel htmlFor={`${prefix}-price`}>Price</FieldLabel>
          <div className={FIELD_GROUP_CLASS}>
            <Input
              id={`${prefix}-price`}
              type="number"
              min={0}
              step="0.01"
              value={values.price}
              onChange={(event) => update('price', event.target.value)}
              placeholder="0"
              className={cn(FIELD_INPUT_CLASS, NUMBER_INPUT_CLASS)}
            />
            <span className={cn(FIELD_ADDON_CLASS, 'border-l')}>{currency}</span>
          </div>
        </Field>

        <Field className="col-span-6 min-w-0 gap-1.5 @lg:col-span-3">
          <FieldLabel htmlFor={`${prefix}-discount`}>Discount</FieldLabel>
          <div className={FIELD_GROUP_CLASS}>
            <Input
              id={`${prefix}-discount`}
              type="number"
              min={0}
              max={100}
              step="1"
              value={values.discount}
              onChange={(event) => update('discount', event.target.value)}
              placeholder="0"
              className={cn(FIELD_INPUT_CLASS, NUMBER_INPUT_CLASS)}
            />
            <span className={cn(FIELD_ADDON_CLASS, 'border-l')}>%</span>
          </div>
        </Field>
        <Field className="col-span-6 min-w-0 gap-1.5 @lg:col-span-4">
          <FieldLabel htmlFor={`${prefix}-promo`}>Promo code</FieldLabel>
          <div className={FIELD_GROUP_CLASS}>
            <Input
              id={`${prefix}-promo`}
              value={values.promo_code}
              maxLength={40}
              onChange={(event) => update('promo_code', event.target.value.toUpperCase())}
              placeholder="None — public"
              spellCheck={false}
              autoComplete="off"
              className={cn(FIELD_INPUT_CLASS, 'uppercase')}
            />
          </div>
        </Field>
        <Field className="col-span-12 min-w-0 gap-1.5 @lg:col-span-5">
          <FieldLabel id={`${prefix}-sales-label`}>Ticket sales period</FieldLabel>
          <Select
            value={values.sales_end}
            // En nedtrekksliste har ingen blur å lagre på; forsinkelsen tar den.
            onValueChange={(value) => update('sales_end', value)}
          >
            <SelectTrigger aria-labelledby={`${prefix}-sales-label`} className={cn(FIELD_TRIGGER_CLASS, 'h-10')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SALES_END_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {custom && (
          <>
            <Field className="col-span-7 min-w-0 gap-1.5 @lg:col-span-5 @lg:col-start-8">
              <FieldLabel htmlFor={`${prefix}-until-date`}>Sells until</FieldLabel>
              <div className={FIELD_GROUP_CLASS}>
                <Input
                  id={`${prefix}-until-date`}
                  type="date"
                  value={values.sales_end_date}
                  onChange={(event) => update('sales_end_date', event.target.value)}
                  aria-invalid={!values.sales_end_date}
                  className={FIELD_INPUT_CLASS}
                />
              </div>
            </Field>
            <Field className="col-span-5 min-w-0 gap-1.5 @lg:col-span-5 @lg:col-start-8">
              <FieldLabel htmlFor={`${prefix}-until-time`}>Time</FieldLabel>
              <div className={FIELD_GROUP_CLASS}>
                <Input
                  id={`${prefix}-until-time`}
                  type="time"
                  value={values.sales_end_time}
                  onChange={(event) => update('sales_end_time', event.target.value)}
                  className={cn(FIELD_INPUT_CLASS, TIME_INPUT_CLASS)}
                />
              </div>
            </Field>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
        <FieldDescription className={cn(FIELD_HINT_CLASS, 'flex flex-wrap items-center gap-x-3')}>
          <span>{sold} sold</span>
          {discounted && unit !== null && (
            <span>
              Buyers pay {unit / 100} {currency}
            </span>
          )}
          {input.promo_code && <span>Hidden until the code is entered</span>}
          {unit !== null && unit > 0 && unit < MIN_TICKET_PRICE_MINOR && (
            <span>Minimum {MIN_TICKET_PRICE_MINOR / 100} {currency}, or 0 for free</span>
          )}
        </FieldDescription>
        <div className="flex items-center gap-2">
          <SaveStatus status={status} error={error} pendingNew={!saved && !readyToSave(values)} />
          {canRemove && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={remove}
              disabled={removing}
              aria-label="Remove ticket type"
              className="text-muted-foreground"
            >
              {removing ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function SaveStatus({
  status,
  error,
  pendingNew,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error'
  error: string | null
  pendingNew: boolean
}) {
  if (status === 'error' && error) {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-destructive">
        <TriangleAlert className="size-3.5 shrink-0" /> {error}
      </span>
    )
  }
  if (pendingNew) {
    return <span className="text-xs text-muted-foreground">Add a name and a price to save</span>
  }
  if (status === 'saving') {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" /> Saving…
      </span>
    )
  }
  if (status === 'saved') {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Check className="size-3.5" /> Saved
      </span>
    )
  }
  return null
}
