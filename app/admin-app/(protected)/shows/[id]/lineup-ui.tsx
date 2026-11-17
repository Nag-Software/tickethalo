'use client'

import * as React from 'react'
import { Megaphone } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  setSubmissionsAudienceAction,
  setSubmissionsDeadlineAction,
  setSuggestFromSubmissionsAction,
  toggleRequirementSubmissionsAction,
} from '@/lib/actions/submissions'
import type { SubmissionsAudience } from '@/types/database'

/**
 * Delene lineup-fanen er tegnet med.
 *
 * Fanen har to tilstander — kriteriene før booking (`requirements-tab`) og
 * plassene under booking (`lineup-tab`) — og de skal se ut som samme side.
 * Rammen, plassnummeret, ikonknappene og fotkortet bor derfor her, slik at et
 * designgrep treffer begge.
 */

/** Kortflaten én lineup-plass tegnes på. */
export const spotCardClass = 'rounded-2xl border bg-card shadow-sm'

/** Plassnummeret først i korthodet. */
export function SpotNumber({
  position,
  className,
  ...props
}: { position: number } & React.ComponentProps<'span'>) {
  return (
    <span
      {...props}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--ev-accent-fill)]/10 text-[13px] font-semibold tabular-nums text-foreground',
        className
      )}
    >
      {position}
    </span>
  )
}

/** Duplisér- og slett-knappene ytterst i korthodet. */
export function SpotIconButton({
  tone = 'muted',
  className,
  ...props
}: { tone?: 'muted' | 'danger' } & React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background transition-colors disabled:opacity-50',
        tone === 'danger'
          ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        className
      )}
    />
  )
}

/**
 * Fotkortet under lineupen — det ene steget videre herfra: start booking før
 * tilbudene er ute, publiser lineupen etter.
 */
export function LineupCallout({
  title,
  action,
  children,
}: {
  title: string
  /** Knappen til høyre. Uten den får teksten hele bredden. */
  action?: React.ReactNode
  /** Forklaringen under tittelen. */
  children: React.ReactNode
}) {
  return (
    <div className={cn(spotCardClass, 'flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4 sm:px-5')}>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--ev-accent-fill)]/10 text-[var(--ev-accent-fill)]">
        <Megaphone className="size-5" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <h3 className="text-sm font-bold">{title}</h3>
        {children}
      </div>
      {action != null && <div className="shrink-0 sm:ml-2">{action}</div>}
    </div>
  )
}

// ─── SubmissionsToggle ────────────────────────────────────────────────────────

/**
 * Åpner eller lukker én plass for søknader.
 *
 * Skriver direkte i stedet for å gå gjennom autolagringen til kortet: de
 * andre feltene er tekst bookeren redigerer, dette er en bryter som skal
 * virke i det den trykkes. Lukking rører ikke søknadene som allerede ligger
 * der. Søknadene gjelder showet, ikke plassen, så tellingen står i
 * `SubmissionsBar`, ikke her.
 *
 * Bryteren slår om med en gang (`useOptimistic`). Før ventet den på at siden
 * ble hentet på nytt, og bookerne trodde den ikke virket. Den er tegnet som en
 * bryter med «On»/«Off», så den ikke kan leses som et merke som forteller at
 * plassen allerede er åpen.
 *
 * `onChange` er for kort som holder sin egen kopi av plassen
 * (`RequirementsTab`): uten den sto kopien med den gamle verdien, og neste
 * autolagring av et annet felt skrev den tilbake.
 */
export function SubmissionsToggle({
  showId,
  reqId,
  open,
  disabled,
  onChange,
}: {
  showId: string
  reqId: string
  open: boolean
  disabled: boolean
  onChange?: (open: boolean) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [shown, setShown] = React.useOptimistic(open)

  function toggle() {
    const next = !shown
    const fd = new FormData()
    fd.set('show_id', showId)
    fd.set('req_id', reqId)
    fd.set('submissions_open', String(next))

    startTransition(async () => {
      setShown(next)
      try {
        await toggleRequirementSubmissionsAction(fd)
        onChange?.(next)
        toast.success(next ? 'Spot open for submissions' : 'Spot closed for submissions')
        router.refresh()
      } catch (err: unknown) {
        toast.error((err as Error)?.message ?? 'Could not change the spot')
      }
    })
  }

  return (
    <button
      type="button"
      role="switch"
      onClick={toggle}
      disabled={disabled || pending}
      aria-checked={shown}
      title={shown ? 'Comedians can apply for this spot. Click to close it.' : 'Let comedians apply for this spot'}
      className={cn(
        'inline-flex h-[26px] shrink-0 cursor-pointer items-center gap-2 rounded-4xl border px-2.5 text-xs font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-60',
        shown
          ? 'border-primary/40 bg-primary/10 text-foreground hover:bg-primary/15'
          : 'border-border bg-background text-muted-foreground hover:text-foreground'
      )}
    >
      <span>Submissions</span>
      <span
        aria-hidden
        className={cn(
          'relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors',
          shown ? 'bg-primary' : 'bg-muted-foreground/30'
        )}
      >
        <span
          className={cn(
            'absolute size-2.5 rounded-full bg-background shadow-sm transition-transform',
            shown ? 'translate-x-3' : 'translate-x-0.5'
          )}
        />
      </span>
      <span className={cn('w-5 text-left', shown && 'text-primary')}>{shown ? 'On' : 'Off'}</span>
    </button>
  )
}

// ─── SubmissionsBar ───────────────────────────────────────────────────────────

/**
 * Publikummet og fristen — showets to søknadsinnstillinger, på én rad.
 *
 * Begge skrives med en gang de endres. Det er to felter, ikke et skjema:
 * en lagre-knapp for et nedtrekk og en dato ville vært en knapp for mye.
 */
export function SubmissionsBar({
  showId,
  audience,
  closeAt,
  rosterSize,
  pendingTotal,
  disabled,
}: {
  showId: string
  audience: SubmissionsAudience
  closeAt: string | null
  rosterSize: number
  pendingTotal: number
  disabled: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  /* `<input type="date">` vil ha «2025-10-02». Verdien er lagret som slutten
     av dagen i UTC, så vi leser den lokalt for å unngå å vise dagen før. */
  const dateValue = closeAt
    ? new Date(new Date(closeAt).getTime() - new Date(closeAt).getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10)
    : ''

  function save(action: (fd: FormData) => Promise<void>, fd: FormData, failure: string) {
    fd.set('show_id', showId)
    startTransition(async () => {
      try {
        await action(fd)
        router.refresh()
      } catch (err: unknown) {
        toast.error((err as Error)?.message ?? failure)
      }
    })
  }

  return (
    <div className={cn(spotCardClass, 'flex flex-wrap items-center gap-x-3 gap-y-2 py-2 pl-4 pr-3')}>
      <Megaphone className="size-[18px] shrink-0 text-[var(--ev-accent-fill)]" aria-hidden />
      <span className="text-sm font-bold whitespace-nowrap">Submissions open to</span>

      <div className="flex items-center gap-0.5 rounded-4xl bg-muted p-[3px]">
        {(['roster', 'everyone'] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={disabled || pending}
            aria-pressed={audience === value}
            onClick={() => {
              if (audience === value) return
              const fd = new FormData()
              fd.set('submissions_audience', value)
              save(setSubmissionsAudienceAction, fd, 'Could not change who can apply')
            }}
            className={cn(
              'h-[26px] cursor-pointer rounded-4xl px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              audience === value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {value === 'roster' ? 'Our comedians' : 'Everyone'}
          </button>
        ))}
      </div>

      <span className="text-[13px] whitespace-nowrap text-muted-foreground">
        {audience === 'roster'
          ? `${rosterSize} on your list`
          : 'Everyone approved on Tickethalo'}
      </span>

      <label className="flex items-center gap-1.5 text-[13px] whitespace-nowrap text-muted-foreground">
        <span>Closes</span>
        <Input
          type="date"
          defaultValue={dateValue}
          disabled={disabled || pending}
          aria-label="Submission deadline"
          onChange={(event) => {
            const fd = new FormData()
            fd.set('submissions_close_at', event.target.value)
            save(setSubmissionsDeadlineAction, fd, 'Could not set the deadline')
          }}
          className="h-[30px] w-[148px] rounded-lg border-input px-2 text-[13px] shadow-none"
        />
      </label>

      {pendingTotal > 0 && (
        <a
          href={`/admin-app/shows/${showId}?tab=submissions`}
          className="ml-auto text-[13px] font-medium whitespace-nowrap underline underline-offset-[3px]"
        >
          {pendingTotal} application{pendingTotal === 1 ? '' : 's'}
        </a>
      )}
    </div>
  )
}

/**
 * Etikett og kontroll på samme linje.
 *
 * Var en versal-etikett over kontrollen. Det kostet 26px per rad uten å si
 * mer enn «Energy» gjør inne i ruten, og lineupen ble dobbelt så høy som
 * den trengte.
 */

// ─── SuggestFromSubmissionsToggle ─────────────────────────────────────────────

/**
 * «Suggest line-up based on submissions» (ClickUp, Tom 2026-11-16).
 *
 * Står på Submissions-fanen og ved «Suggest line-up now» på Lineup-fanen.
 * Begge leser og skriver `shows.suggest_from_submissions`, så det som krysses
 * av på den ene fanen, står krysset av på den andre.
 *
 * `variant="full"` har overskrift og forklaring (Submissions);
 * `variant="compact"` er én linje under forslagsknappen (Lineup).
 */
export function SuggestFromSubmissionsToggle({
  showId,
  enabled,
  disabled,
  variant = 'full',
}: {
  showId: string
  enabled: boolean
  disabled?: boolean
  variant?: 'full' | 'compact'
}) {
  const router = useRouter()
  // Klikket vises med en gang; når siden er tegnet på nytt, er serverens
  // verdi (`enabled`) fasiten igjen.
  const [optimistic, setOptimistic] = React.useState<boolean | null>(null)
  const [pending, startTransition] = React.useTransition()
  const checked = pending && optimistic !== null ? optimistic : enabled

  function toggle(next: boolean) {
    setOptimistic(next)
    startTransition(async () => {
      const result = await setSuggestFromSubmissionsAction({ showId, enabled: next })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  const id = `suggest-from-submissions-${React.useId()}`

  // Teksten sier hva som skjer, ikke hva innstillingen heter: en booker som
  // er ny på plattformen skal skjønne det uten å kjenne «forslaget».
  if (variant === 'compact') {
    return (
      <div className="flex items-start gap-2">
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled || pending}
          onCheckedChange={(value) => toggle(value === true)}
          className="mt-0.5"
        />
        <label htmlFor={id} className="cursor-pointer text-xs leading-snug">
          <span className="font-medium text-foreground">Applicants first</span>
          <span className="block text-muted-foreground">Comedians who applied to this show are suggested before the rest of your list.</span>
        </label>
      </div>
    )
  }

  return (
    <div className={cn(spotCardClass, 'flex items-start gap-3 px-4 py-3')}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled || pending}
        onCheckedChange={(value) => toggle(value === true)}
        className="mt-0.5"
      />
      <label htmlFor={id} className="cursor-pointer space-y-0.5">
        <span className="block text-sm font-semibold">Put applicants first in the line-up</span>
        <span className="block text-xs text-muted-foreground">
          When you suggest a line-up, comedians who applied to this show are picked first for the spots that fit them.
          Nothing is sent until you start booking.
        </span>
      </label>
    </div>
  )
}
