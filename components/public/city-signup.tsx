'use client'

import { ArrowRight } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import { subscribeToCityAction } from '@/app/actions/subscribe'
import { ALL_CITIES } from '@/lib/event-filters'

/**
 * City signup below the list. Catches the people who found nothing this time —
 * otherwise the biggest leak on an event front page.
 */
export function CitySignup({ city }: { city: string }) {
  const named = city !== ALL_CITIES

  return (
    <div
      className="mt-16 flex flex-col gap-5 bg-[var(--ev-card)] p-7 sm:p-9 lg:flex-row lg:items-center lg:justify-between lg:gap-10"
      style={{ borderRadius: 'var(--ev-r-card)' }}
    >
      <div className="max-w-md">
        <h3 className="text-[22px] font-semibold tracking-[-0.015em] text-[var(--ev-text)] sm:text-lg sm:tracking-[-0.01em]">
          {named ? `Get notified about new shows in ${city}` : 'Get notified about new shows'}
        </h3>
        <p className="mt-2 text-[17px] text-[var(--ev-muted)] sm:mt-1.5 sm:text-[14px]">
          One email when tickets go on sale{named ? ` in ${city}` : ''}. Nothing else.
        </p>
      </div>

      <ToastActionForm
        action={subscribeToCityAction}
        successMessage={named ? `You will hear about new shows in ${city}.` : 'You will hear about new shows.'}
        className="flex w-full max-w-md items-center gap-2"
      >
        <input type="hidden" name="city" value={city} />
        <label htmlFor="city-signup-email" className="sr-only">
          Email address
        </label>
        {/* 16px is not decoration: anything smaller makes iOS Safari zoom into the
            field on focus, leaving the user on a page that is suddenly wider than
            the screen. */}
        <input
          id="city-signup-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="h-12 min-w-0 flex-1 bg-[var(--ev-bg)] px-4 text-[16px] text-[var(--ev-text)] outline-none ring-1 ring-inset ring-[var(--ev-line)] transition-[box-shadow] placeholder:text-[var(--ev-faint)] focus:ring-2 focus:ring-[var(--ev-accent-fill)] sm:h-11 sm:text-[14px]"
          style={{ borderRadius: 'var(--ev-r-chip)' }}
        />
        <button
          type="submit"
          className="inline-flex h-12 shrink-0 items-center gap-2 bg-[var(--ev-text)] px-5 text-[15px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:h-11 sm:gap-1.5 sm:text-[13px]"
          style={{ borderRadius: 'var(--ev-r-chip)' }}
        >
          Notify me <ArrowRight className="size-4" aria-hidden />
        </button>
      </ToastActionForm>
    </div>
  )
}
