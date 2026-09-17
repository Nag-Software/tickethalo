'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format, isValid, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { CalendarDays, Check, Clock, Copy, LoaderCircle, TriangleAlert } from 'lucide-react'
import {
  FIELD_ADDON_BUTTON_CLASS,
  FIELD_ADDON_CLASS,
  FIELD_GROUP_CLASS,
  FIELD_HINT_CLASS,
  FIELD_INPUT_CLASS,
  FIELD_TEXTAREA_CLASS,
  FIELD_TRIGGER_CLASS,
  FieldFrame,
  FieldIcon,
  FieldSection,
  NUMBER_INPUT_CLASS,
  TIME_INPUT_CLASS,
} from '@/components/admin/form-fields'
import { Calendar } from '@/components/ui/calendar'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
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

/** `https://tickethalo.com/events/` → `tickethalo.com` og `/events/`. */
function splitEventsBaseUrl(url: string) {
  try {
    const { host, pathname } = new URL(url)
    return { host, path: pathname.endsWith('/') ? pathname : `${pathname}/` }
  } catch {
    return { host: '', path: '/events/' }
  }
}

export function ShowDetailsForm({
  showId,
  currency,
  eventsBaseUrl,
  initialValues,
  action,
}: {
  showId: string
  currency: string
  /** Adressen eventsidene ligger under, med skråstrek til slutt: `https://tickethalo.com/events/`. */
  eventsBaseUrl: string
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
  const events = splitEventsBaseUrl(eventsBaseUrl)

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

  /** Lenken slik den står i feltet — det bookeren ser, er det som kopieres. */
  async function copyEventLink() {
    try {
      await navigator.clipboard.writeText(`${eventsBaseUrl}${values.slug.trim()}`)
      toast.success('Link copied.')
    } catch {
      toast.error('Could not copy the link.')
    }
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
          <h2 className="text-base font-semibold tracking-tight">Show details</h2>
          <p className="text-xs text-muted-foreground">
            What the event page, the poster and the ticket are built from.
          </p>
        </div>
        <AutosaveStatus status={status} missingField={missingField} />
      </div>

      <FieldFrame>
        <FieldSection id="show-details-basics" title="Basics">
          <Field className="col-span-12 min-w-0 gap-1.5">
            <FieldLabel htmlFor="show-title">Title</FieldLabel>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                id="show-title"
                value={values.title}
                onChange={(event) => update('title', event.target.value)}
                aria-invalid={!values.title.trim()}
                placeholder="Backstage Stand Up"
                className={FIELD_INPUT_CLASS}
              />
            </div>
          </Field>

          <Field className="col-span-12 min-w-0 gap-1.5">
            <FieldLabel htmlFor="show-slug">Web address</FieldLabel>
            <div className={FIELD_GROUP_CLASS}>
              {/* Hele adressen står i feltet, så bookeren ser lenken mens den
                  skrives. Domenet faller bort når rammen blir smal. */}
              <span className={cn(FIELD_ADDON_CLASS, 'border-r')}>
                <span className="hidden @lg:inline">{events.host}</span>
                {events.path}
              </span>
              <Input
                id="show-slug"
                value={values.slug}
                onChange={(event) => update('slug', event.target.value)}
                aria-invalid={!values.slug.trim()}
                spellCheck={false}
                className={FIELD_INPUT_CLASS}
              />
              <button
                type="button"
                aria-label="Copy link"
                title="Copy link"
                disabled={!values.slug.trim()}
                onClick={copyEventLink}
                className={FIELD_ADDON_BUTTON_CLASS}
              >
                <Copy className="size-4" />
              </button>
            </div>
            {/* Gamle adresser videresendes ikke, så en endring gjør delte lenker døde. */}
            <FieldDescription className={FIELD_HINT_CLASS}>Changing it breaks links you have already shared.</FieldDescription>
          </Field>
        </FieldSection>

        <FieldSection id="show-details-when" title="When & where">
          <Field className="col-span-12 min-w-0 gap-1.5 @lg:col-span-6">
            <FieldLabel id="show-date-label" htmlFor="show-date">Date</FieldLabel>
            <DateField id="show-date" labelId="show-date-label" value={values.date} onChange={(value) => update('date', value)} />
          </Field>
          <Field className="col-span-6 min-w-0 gap-1.5 @lg:col-span-3">
            <FieldLabel htmlFor="show-start">Start</FieldLabel>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                id="show-start"
                type="time"
                value={values.start_time}
                onChange={(event) => update('start_time', event.target.value)}
                className={cn(FIELD_INPUT_CLASS, TIME_INPUT_CLASS)}
              />
              <FieldIcon icon={Clock} />
            </div>
          </Field>
          <Field className="col-span-6 min-w-0 gap-1.5 @lg:col-span-3">
            <FieldLabel htmlFor="show-end">End</FieldLabel>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                id="show-end"
                type="time"
                value={values.end_time}
                onChange={(event) => update('end_time', event.target.value)}
                className={cn(FIELD_INPUT_CLASS, TIME_INPUT_CLASS)}
              />
              <FieldIcon icon={Clock} />
            </div>
          </Field>

          <Field className="col-span-12 min-w-0 gap-1.5">
            <FieldLabel htmlFor="show-venue">Venue / address</FieldLabel>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                id="show-venue"
                value={values.venue_address}
                onChange={(event) => update('venue_address', event.target.value)}
                placeholder="Venue TBA"
                className={FIELD_INPUT_CLASS}
              />
            </div>
          </Field>
        </FieldSection>

        <FieldSection id="show-details-tickets" title="Tickets">
          <Field className="col-span-12 min-w-0 gap-1.5 @md:col-span-6">
            <FieldLabel htmlFor="show-capacity">Capacity</FieldLabel>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                id="show-capacity"
                type="number"
                min={0}
                value={values.capacity}
                onChange={(event) => update('capacity', event.target.value)}
                placeholder="Unlimited"
                className={cn(FIELD_INPUT_CLASS, NUMBER_INPUT_CLASS)}
              />
              <span className={cn(FIELD_ADDON_CLASS, 'border-l')}>seats</span>
            </div>
            <FieldDescription className={FIELD_HINT_CLASS}>Leave empty for unlimited.</FieldDescription>
          </Field>
          <Field className="col-span-12 min-w-0 gap-1.5 @md:col-span-6">
            <FieldLabel htmlFor="show-price">Ticket price</FieldLabel>
            <div className={FIELD_GROUP_CLASS}>
              <Input
                id="show-price"
                type="number"
                min={0}
                step="0.01"
                value={values.ticket_price}
                onChange={(event) => update('ticket_price', event.target.value)}
                placeholder="0"
                className={cn(FIELD_INPUT_CLASS, NUMBER_INPUT_CLASS)}
              />
              <span className={cn(FIELD_ADDON_CLASS, 'border-l')}>{currency}</span>
            </div>
            <FieldDescription className={FIELD_HINT_CLASS}>
              Currency is set under <Link href="/admin-app/my-club">My club</Link>.
            </FieldDescription>
          </Field>
        </FieldSection>

        <FieldSection id="show-details-about" title="About">
          <Field className="col-span-12 min-w-0 gap-1.5">
            <FieldLabel htmlFor="show-description">Description</FieldLabel>
            <Textarea
              id="show-description"
              rows={4}
              value={values.description}
              onChange={(event) => update('description', event.target.value)}
              placeholder="A few lines about the night — what the audience can expect."
              className={FIELD_TEXTAREA_CLASS}
            />
            <FieldDescription className={FIELD_HINT_CLASS}>Shown on the event page, under the poster.</FieldDescription>
          </Field>
        </FieldSection>
      </FieldFrame>
    </form>
  )
}

/**
 * Datoen velges i en kalender, ikke i nettleserens eget datofelt: det ser
 * forskjellig ut fra nettleser til nettleser (17.10.2026, 10/17/2026) og viser
 * ikke ukedagen. Verdien er fortsatt `yyyy-MM-dd`, som kolonnen.
 */
function DateField({
  id,
  labelId,
  value,
  onChange,
}: {
  id: string
  labelId: string
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const parsed = value ? parseISO(value) : null
  const date = parsed && isValid(parsed) ? parsed : undefined
  const valueId = `${id}-value`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          // Etiketten alene ville gitt knappen navnet «Date» uten selve datoen.
          aria-labelledby={`${labelId} ${valueId}`}
          // Mangler datoen, sier statusen over skjemaet det; her er det bare fargen.
          data-invalid={!date}
          className={FIELD_TRIGGER_CLASS}
        >
          <span id={valueId} className={cn('truncate', !date && 'text-muted-foreground')}>
            {date ? format(date, 'EEE d MMM yyyy') : 'Pick a date'}
          </span>
          <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      {/* Kalenderen flytter fokus til valgt dag selv; Radix skal ikke ta det først. */}
      <PopoverContent align="start" className="w-auto p-0" onOpenAutoFocus={(event) => event.preventDefault()}>
        <Calendar
          mode="single"
          required
          autoFocus
          selected={date}
          defaultMonth={date}
          weekStartsOn={1}
          onSelect={(next) => {
            onChange(format(next, 'yyyy-MM-dd'))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
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
