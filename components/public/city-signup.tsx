'use client'

import { ArrowRight } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import { subscribeToCityAction } from '@/app/actions/subscribe'

/**
 * Bypåmelding under listen. Fanger opp de som ikke fant noe denne gangen —
 * ellers den største lekkasjen på en eventforside.
 */
export function CitySignup({ city }: { city: string }) {
  const named = city !== 'Alle'

  return (
    <div
      className="mt-16 flex flex-col gap-5 bg-[var(--ev-card)] p-7 sm:p-9 lg:flex-row lg:items-center lg:justify-between lg:gap-10"
      style={{ borderRadius: 'var(--ev-r-card)' }}
    >
      <div className="max-w-md">
        <h3 className="text-lg font-semibold tracking-[-0.01em] text-[var(--ev-text)]">
          {named ? `Få beskjed om nye show i ${city}` : 'Få beskjed om nye show'}
        </h3>
        <p className="mt-1.5 text-[14px] text-[var(--ev-muted)]">
          Én e-post når det slippes billetter{named ? ` i ${city}` : ''}. Ingenting annet.
        </p>
      </div>

      <ToastActionForm
        action={subscribeToCityAction}
        successMessage={named ? `Du får beskjed om nye show i ${city}.` : 'Du får beskjed om nye show.'}
        className="flex w-full max-w-md items-center gap-2"
      >
        <input type="hidden" name="city" value={city} />
        <label htmlFor="city-signup-email" className="sr-only">
          E-postadresse
        </label>
        <input
          id="city-signup-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="din@epost.no"
          className="h-11 min-w-0 flex-1 bg-[var(--ev-bg)] px-4 text-[14px] text-[var(--ev-text)] outline-none ring-1 ring-inset ring-[var(--ev-line)] transition-[box-shadow] placeholder:text-[var(--ev-faint)] focus:ring-2 focus:ring-[var(--ev-accent-fill)]"
          style={{ borderRadius: 'var(--ev-r-chip)' }}
        />
        <button
          type="submit"
          className="inline-flex h-11 shrink-0 items-center gap-1.5 bg-[var(--ev-text)] px-5 text-[13px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]"
          style={{ borderRadius: 'var(--ev-r-chip)' }}
        >
          Meld meg på <ArrowRight className="size-4" />
        </button>
      </ToastActionForm>
    </div>
  )
}
