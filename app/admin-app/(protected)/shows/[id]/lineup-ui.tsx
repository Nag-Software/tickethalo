'use client'

import * as React from 'react'
import { Megaphone } from 'lucide-react'
import { cn } from '@/lib/utils'

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
