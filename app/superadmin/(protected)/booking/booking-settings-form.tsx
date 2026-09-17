'use client'

import { useActionState, useRef } from 'react'
import { RotateCcw, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  BOOKING_SETTING_FIELDS,
  DEFAULT_BOOKING_SETTINGS,
  type BookingSettings,
} from '@/lib/booking-settings'
import { saveBookingSettingsAction, type BookingSettingsFormState } from './actions'

const INITIAL_STATE: BookingSettingsFormState = {
  status: 'idle',
  message: null,
  issues: {},
  savedAt: null,
}

/**
 * Skjemaet for bookingmotorens innstillinger.
 *
 * Hvert felt viser grensene sine og hva standarden er, fordi tallene ikke
 * betyr noe uten det: «10» er trygt for maks tilbud og vilt for tilbud per
 * dag. Verdier utenfor grensene avvises i stedet for å klippes i stillhet —
 * se `parseBookingSettings`.
 */
export function BookingSettingsForm({ settings }: { settings: BookingSettings }) {
  const [state, formAction, pending] = useActionState<BookingSettingsFormState, FormData>(
    saveBookingSettingsAction,
    INITIAL_STATE,
  )
  const formRef = useRef<HTMLFormElement>(null)

  /**
   * Fyller feltene med standardverdiene, men lagrer ikke.
   *
   * Tidligere skrev knappen rett til databasen. Feltene er ukontrollerte, så
   * de ble stående med de gamle tallene etterpå — siden sa «tilbakestilt» og
   * viste noe annet. Nå ser superadmin hva det blir før hen trykker Lagre.
   */
  function fillWithDefaults() {
    const form = formRef.current
    if (!form) return

    for (const field of BOOKING_SETTING_FIELDS) {
      const input = form.elements.namedItem(field.key)
      if (input instanceof HTMLInputElement) input.value = String(DEFAULT_BOOKING_SETTINGS[field.key])
    }
  }

  const shown = state

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-6">
      {shown.message && (
        <p
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            shown.status === 'error'
              ? 'border-destructive/30 bg-destructive/5 text-destructive'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {shown.message}
        </p>
      )}

      <div className="rounded-lg border divide-y">
        {BOOKING_SETTING_FIELDS.map((field) => {
          const issue = shown.issues[field.key]
          const fallback = DEFAULT_BOOKING_SETTINGS[field.key]
          const changed = settings[field.key] !== fallback

          return (
            <div key={field.key} className="flex flex-wrap items-start gap-4 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <label htmlFor={field.key} className="text-sm font-medium">
                  {field.label}
                </label>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{field.help}</p>
                {issue && <p className="mt-1.5 text-[13px] font-medium text-destructive">{issue}</p>}
              </div>

              <div className="flex shrink-0 items-center gap-2.5">
                <Input
                  id={field.key}
                  name={field.key}
                  type="number"
                  inputMode="decimal"
                  defaultValue={String(settings[field.key])}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  aria-invalid={Boolean(issue)}
                  aria-describedby={`${field.key}-range`}
                  className="h-9 w-24 text-right"
                />
                <div className="w-36 text-[12px] leading-tight text-muted-foreground">
                  <span>{field.unit}</span>
                  <span id={`${field.key}-range`} className="block text-muted-foreground/70">
                    {field.min}–{field.max}
                    {changed ? ` · standard ${fallback}` : ' · standard'}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Save className="size-4" />
          {pending ? 'Lagrer …' : 'Lagre innstillingene'}
        </Button>

        <Button type="button" variant="ghost" disabled={pending} onClick={fillWithDefaults}>
          <RotateCcw className="size-4" />
          Fyll inn standardverdiene
        </Button>

        <span className="text-[12.5px] text-muted-foreground">
          Ingenting endres før du lagrer.
        </span>
      </div>
    </form>
  )
}
