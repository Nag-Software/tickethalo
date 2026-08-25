'use client'

import { Loader2 } from 'lucide-react'
import { useMarketingAction } from './use-marketing-action'

/**
 * AI-plakaten ved publisering.
 *
 * Den pleide å kjøre av seg selv når lineupen ble full. Klubbene har som regel
 * sin egen plakat, og en generert plakat som dukker opp på event-siden uten at
 * noen ba om den er verre enn ingen plakat. Bryteren er derfor av som standard,
 * og dette er stedet den skrus på for de showene det faktisk passer for.
 */
export function AutoPosterToggle({
  showId,
  enabled,
  hasPoster,
  action,
}: {
  showId: string
  enabled: boolean
  hasPoster: boolean
  action: (formData: FormData) => Promise<{ enabled: boolean }>
}) {
  const { run, isRunning, isPending } = useMarketingAction()

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">Generate an AI poster when the lineup publishes</p>
        <p className="text-xs text-muted-foreground">
          {enabled
            ? hasPoster
              ? 'On — but this show already has a poster, so nothing will be generated.'
              : 'On — a poster is generated from the template, colours and photo slots at publish time.'
            : 'Off. Nothing is generated unless you press “Generate with AI”.'}
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label="Generate an AI poster when the lineup publishes"
        disabled={isPending}
        onClick={() => {
          const formData = new FormData()
          formData.set('show_id', showId)
          formData.set('enabled', String(!enabled))
          run('toggle', () => action(formData), {
            success: (result) => result.enabled ? 'Automatic AI poster is on.' : 'Automatic AI poster is off.',
          })
        }}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
          enabled ? 'bg-primary' : 'bg-input'
        }`}
      >
        <span
          className={`grid size-5 place-content-center rounded-full bg-background shadow transition-transform ${
            enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        >
          {isRunning('toggle') && <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden />}
        </span>
      </button>
    </div>
  )
}
