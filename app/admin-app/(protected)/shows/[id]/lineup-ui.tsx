'use client'

import * as React from 'react'
import { Check, Megaphone } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  setSubmissionsAudienceAction,
  setSubmissionsDeadlineAction,
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
  /** Knappen til høyre. */
  action: React.ReactNode
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
      <div className="shrink-0 sm:ml-2">{action}</div>
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
 * der — derfor blir tellingen stående også når plassen er lukket.
 */
export function SubmissionsToggle({
  showId,
  reqId,
  open,
  pendingCount,
  disabled,
}: {
  showId: string
  reqId: string
  open: boolean
  pendingCount: number
  disabled: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  function toggle() {
    const fd = new FormData()
    fd.set('show_id', showId)
    fd.set('req_id', reqId)
    fd.set('submissions_open', String(!open))

    startTransition(async () => {
      try {
        await toggleRequirementSubmissionsAction(fd)
        router.refresh()
      } catch (err: unknown) {
        toast.error((err as Error)?.message ?? 'Could not change the spot')
      }
    })
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled || pending}
        aria-pressed={open}
        title={open ? 'Comedians can apply for this spot' : 'Open this spot for submissions'}
        className={cn(
          'inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-4xl px-2.5 text-xs font-medium transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-60',
          open
            ? 'bg-primary text-primary-foreground hover:bg-primary/80'
            : 'border border-border bg-input/30 text-muted-foreground hover:text-foreground'
        )}
      >
        {open && <Check className="size-3.5" aria-hidden />}
        {open ? 'Open' : 'Open for submissions'}
      </button>

      {pendingCount > 0 && (
        <a
          href={`/admin-app/shows/${showId}?tab=submissions`}
          className="text-[13px] whitespace-nowrap text-muted-foreground hover:text-foreground"
        >
          {pendingCount} applied
        </a>
      )}
    </div>
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
