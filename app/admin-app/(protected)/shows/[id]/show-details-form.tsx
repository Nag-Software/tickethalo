'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, LoaderCircle, TriangleAlert } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { cn } from '@/lib/utils'

/**
 * Long enough that a saved row is not written on every keystroke, short enough
 * that leaving the field — or the tab — lands the change. Blur flushes early,
 * so the delay only ever runs out mid-typing.
 */
const AUTOSAVE_DELAY_MS = 800

export type ShowDetailsValues = {
  title: string
  slug: string
  date: string
  start_time: string
  end_time: string
  venue_address: string
  capacity: string
  ticket_price: string
  description: string
}

const FIELD_KEYS = [
  'title',
  'slug',
  'date',
  'start_time',
  'end_time',
  'venue_address',
  'capacity',
  'ticket_price',
  'description',
] as const

/**
 * The columns the show cannot be saved without. Autosave holds while one of
 * them is empty rather than writing a row the event page cannot render.
 */
const REQUIRED_FIELDS: Array<{ key: keyof ShowDetailsValues; label: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'slug', label: 'Slug' },
  { key: 'date', label: 'Date' },
]

/**
 * Production builds strip the message off a thrown server error and leave a
 * `digest` behind, so that text is never worth showing. Actions with something
 * the booker can act on return it as a value instead.
 */
function thrownErrorMessage(error: unknown) {
  const isRedacted = typeof error === 'object' && error !== null && 'digest' in error
  return !isRedacted && error instanceof Error && error.message
    ? error.message
    : 'Could not save the show. Try again.'
}

function isSameValues(left: ShowDetailsValues, right: ShowDetailsValues) {
  return FIELD_KEYS.every((key) => left[key] === right[key])
}

function missingRequiredField(values: ShowDetailsValues) {
  return REQUIRED_FIELDS.find((field) => !values[field.key].trim())?.label ?? null
}

export function ShowDetailsForm({
  showId,
  currency,
  initialValues,
  action,
}: {
  showId: string
  currency: string
  initialValues: ShowDetailsValues
  action: (formData: FormData) => Promise<{ error?: string } | void>
}) {
  const router = useRouter()
  const [values, setValues] = useState(initialValues)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [, startTransition] = useTransition()

  const savedRef = useRef(initialValues)
  const valuesRef = useRef(values)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    valuesRef.current = values
  }, [values])

  const missingField = missingRequiredField(values)

  const persist = useCallback(
    (next: ShowDetailsValues) => {
      if (isSameValues(next, savedRef.current) || missingRequiredField(next)) return

      setStatus('saving')
      const formData = new FormData()
      formData.set('show_id', showId)
      for (const key of FIELD_KEYS) formData.set(key, next[key])

      startTransition(async () => {
        try {
          const returned = await action(formData)
          if (returned?.error) {
            setStatus('error')
            toast.error(returned.error)
            return
          }

          savedRef.current = next
          setStatus('saved')
          // The header and the booking card read the same row, so they follow
          // the edit rather than showing the old title until the next visit.
          router.refresh()
        } catch (error) {
          setStatus('error')
          toast.error(thrownErrorMessage(error))
        }
      })
    },
    [action, router, showId],
  )

  useEffect(() => {
    if (isSameValues(values, savedRef.current) || missingField) return

    timerRef.current = setTimeout(() => persist(valuesRef.current), AUTOSAVE_DELAY_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [values, missingField, persist])

  /** Leaving a field saves it now instead of waiting out the debounce. */
  function flush() {
    if (timerRef.current) clearTimeout(timerRef.current)
    persist(valuesRef.current)
  }

  function update(key: keyof ShowDetailsValues, value: string) {
    setValues((previous) => ({ ...previous, [key]: value }))
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        // No submit button — Enter just means "save it now".
        event.preventDefault()
        flush()
      }}
      onBlur={flush}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold">Show details</h2>
          <p className="text-xs text-muted-foreground">
            What the event page, the poster and the ticket are built from.
          </p>
        </div>
        <AutosaveStatus status={status} missingField={missingField} />
      </div>

      <Separator />

      <FieldGroup className="gap-5">
        <Field className="gap-2">
          <FieldLabel htmlFor="show-title">Title</FieldLabel>
          <Input
            id="show-title"
            value={values.title}
            onChange={(event) => update('title', event.target.value)}
            aria-invalid={!values.title.trim()}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field className="gap-2">
            <FieldLabel htmlFor="show-date">Date</FieldLabel>
            <Input
              id="show-date"
              type="date"
              value={values.date}
              onChange={(event) => update('date', event.target.value)}
              aria-invalid={!values.date.trim()}
            />
          </Field>
          <Field className="gap-2">
            <FieldLabel htmlFor="show-start">Start</FieldLabel>
            <Input
              id="show-start"
              type="time"
              value={values.start_time}
              onChange={(event) => update('start_time', event.target.value)}
            />
          </Field>
          <Field className="gap-2">
            <FieldLabel htmlFor="show-end">End</FieldLabel>
            <Input
              id="show-end"
              type="time"
              value={values.end_time}
              onChange={(event) => update('end_time', event.target.value)}
            />
          </Field>
        </div>

        <Field className="gap-2">
          <FieldLabel htmlFor="show-venue">Venue / address</FieldLabel>
          <Input
            id="show-venue"
            value={values.venue_address}
            onChange={(event) => update('venue_address', event.target.value)}
            placeholder="Venue TBA"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field className="gap-2">
            <FieldLabel htmlFor="show-capacity">Capacity</FieldLabel>
            <Input
              id="show-capacity"
              type="number"
              min={0}
              value={values.capacity}
              onChange={(event) => update('capacity', event.target.value)}
              placeholder="Unlimited"
            />
          </Field>
          <Field className="gap-2">
            <FieldLabel htmlFor="show-price">Ticket price ({currency})</FieldLabel>
            <Input
              id="show-price"
              type="number"
              min={0}
              step="0.01"
              value={values.ticket_price}
              onChange={(event) => update('ticket_price', event.target.value)}
            />
            <FieldDescription>
              Set under <Link href="/admin-app/my-club">My club</Link>.
            </FieldDescription>
          </Field>
        </div>

        <Field className="gap-2">
          <FieldLabel htmlFor="show-slug">Slug</FieldLabel>
          <Input
            id="show-slug"
            value={values.slug}
            onChange={(event) => update('slug', event.target.value)}
            aria-invalid={!values.slug.trim()}
          />
          <FieldDescription>The event page lives at /events/{values.slug}</FieldDescription>
        </Field>

        <Field className="gap-2">
          <FieldLabel htmlFor="show-description">Description</FieldLabel>
          <Textarea
            id="show-description"
            rows={4}
            value={values.description}
            onChange={(event) => update('description', event.target.value)}
          />
        </Field>
      </FieldGroup>
    </form>
  )
}

function AutosaveStatus({
  status,
  missingField,
}: {
  status: 'idle' | 'saving' | 'saved' | 'error'
  missingField: string | null
}) {
  const state = missingField
    ? { tone: 'warning' as const, icon: TriangleAlert, label: `${missingField} is required` }
    : status === 'saving'
      ? { tone: 'muted' as const, icon: LoaderCircle, label: 'Saving…' }
      : status === 'saved'
        ? { tone: 'muted' as const, icon: Check, label: 'Saved' }
        : status === 'error'
          ? { tone: 'destructive' as const, icon: TriangleAlert, label: 'Not saved' }
          : null

  if (!state) return null

  const Icon = state.icon

  return (
    <span
      role="status"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium',
        state.tone === 'muted' && 'text-muted-foreground',
        state.tone === 'warning' && 'text-amber-700 dark:text-amber-400',
        state.tone === 'destructive' && 'text-destructive',
      )}
    >
      <Icon className={cn('size-3.5', status === 'saving' && !missingField && 'animate-spin')} />
      {state.label}
    </span>
  )
}
