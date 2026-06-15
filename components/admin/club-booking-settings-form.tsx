'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Field, FieldContent, FieldLabel } from '@/components/ui/field'
import { updateClubBookingSettingsAction } from '@/app/admin-app/booking-innstillinger/actions'
import {
  FAIRNESS_PRESETS,
  type ClubBookingSettings,
  type FairnessPresetId,
} from '@/lib/booking-scoring'

type ClubBookingSettingsFormProps = {
  settings: ClubBookingSettings
  totalClubEvents: number
}

type FormState = {
  fairness_window_months: number
  fairness_multiplier_1: number
  fairness_multiplier_2: number
  fairness_multiplier_3: number
  fairness_multiplier_4_plus: number
  consecutive_event_multiplier: number
  offers_per_wave: number
  offers_per_slot: number
  min_bookable_score: number
}

function toFormState(settings: ClubBookingSettings): FormState {
  return {
    fairness_window_months: settings.fairness_window_months,
    fairness_multiplier_1: settings.fairness_multiplier_1,
    fairness_multiplier_2: settings.fairness_multiplier_2,
    fairness_multiplier_3: settings.fairness_multiplier_3,
    fairness_multiplier_4_plus: settings.fairness_multiplier_4_plus,
    consecutive_event_multiplier: settings.consecutive_event_multiplier,
    offers_per_wave: settings.offers_per_wave,
    offers_per_slot: settings.offers_per_slot,
    min_bookable_score: settings.min_bookable_score,
  }
}

const PRESETS: Array<{ id: FairnessPresetId; label: string }> = [
  { id: 'mild', label: 'Mild' },
  { id: 'normal', label: 'Normal' },
  { id: 'strict', label: 'Streng' },
]

export function ClubBookingSettingsForm({ settings, totalClubEvents }: ClubBookingSettingsFormProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [form, setForm] = useState<FormState>(() => toFormState(settings))

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function applyPreset(id: FairnessPresetId) {
    setForm(prev => ({ ...prev, ...FAIRNESS_PRESETS[id] }))
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)

    try {
      const formData = new FormData()
      for (const [key, value] of Object.entries(form)) {
        formData.set(key, String(value))
      }
      await updateClubBookingSettingsAction(formData)
      toast.success('Lagret.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kunne ikke lagre.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-8">
      <p className="text-sm text-muted-foreground">
        {totalClubEvents} events i valgt historikk-vindu. Lavere multiplikator = sterkere nedprioritering.
      </p>

      <Field>
        <FieldLabel htmlFor="fairness_window_months">Historikk (mnd)</FieldLabel>
        <FieldContent>
          <Input
            id="fairness_window_months"
            type="number"
            min={1}
            max={60}
            value={form.fairness_window_months}
            onChange={e => updateField('fairness_window_months', Number(e.target.value))}
            required
          />
        </FieldContent>
      </Field>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Nedprioritering etter bookinger</span>
          <div className="flex gap-1">
            {PRESETS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => applyPreset(id)}
                className="rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:border-foreground hover:text-foreground"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ['fairness_multiplier_1', 'Etter 1 show'],
            ['fairness_multiplier_2', 'Etter 2 show'],
            ['fairness_multiplier_3', 'Etter 3 show'],
            ['fairness_multiplier_4_plus', 'Etter 4+ show'],
            ['consecutive_event_multiplier', 'To events på rad'],
          ] as const).map(([key, label]) => (
            <Field key={key}>
              <FieldLabel htmlFor={key}>{label}</FieldLabel>
              <FieldContent>
                <Input
                  id={key}
                  type="number"
                  min={0.01}
                  max={1}
                  step={0.01}
                  value={form[key]}
                  onChange={e => updateField(key, Number(e.target.value))}
                  required
                />
              </FieldContent>
            </Field>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="offers_per_wave">Tilbud per utsendelse</FieldLabel>
          <FieldContent>
            <Input
              id="offers_per_wave"
              type="number"
              min={1}
              max={10}
              value={form.offers_per_wave}
              onChange={e => updateField('offers_per_wave', Number(e.target.value))}
              required
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Antall tilbud som sendes samtidig per ledig spot hver gang algoritmen kjører.
            </p>
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel htmlFor="offers_per_slot">Maks tilbud i kø per spot</FieldLabel>
          <FieldContent>
            <Input
              id="offers_per_slot"
              type="number"
              min={1}
              max={100}
              value={form.offers_per_slot}
              onChange={e => updateField('offers_per_slot', Number(e.target.value))}
              required
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Hvor mange komikere som kan få tilbud totalt (avslått og utløpt teller) før spotten stopper.
            </p>
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel htmlFor="min_bookable_score">Min. erfaringsnivå</FieldLabel>
          <FieldContent>
            <Input
              id="min_bookable_score"
              type="number"
              min={1}
              max={10}
              value={form.min_bookable_score}
              onChange={e => updateField('min_bookable_score', Number(e.target.value))}
              required
            />
          </FieldContent>
        </Field>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
      >
        {pending ? 'Lagrer…' : 'Lagre'}
      </button>
    </form>
  )
}
