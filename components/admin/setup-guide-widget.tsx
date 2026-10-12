'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowRight, Check, ChevronDown, ChevronUp, Loader2, PartyPopper } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { SetupGuide } from '@/lib/setup-guide'
import { cn } from '@/lib/utils'

/**
 * Oppstartsguiden, nede til høyre i klubbportalen.
 *
 * Fire punkter, sjekket av fra det klubben faktisk har gjort
 * (`lib/setup-guide.ts`). Det første som gjenstår står uthevet med en
 * lenke dit det gjøres. Guiden kan foldes sammen til en linje — det
 * huskes i nettleseren, så den ikke spretter opp på hver side — og legges
 * bort for godt når alt er gjort, som lagres på klubben.
 */

const COLLAPSED_KEY = 'tickethalo:setup-guide:collapsed'
const COLLAPSED_EVENT = 'tickethalo:setup-guide'

/**
 * Sammenfoldet eller ikke, husket i nettleseren. Lest via
 * `useSyncExternalStore`, så serveren rendrer utfoldet uten å vite hva
 * nettleseren husker, og klienten tar over uten hydreringsfeil.
 */
function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function subscribeCollapsed(onChange: () => void) {
  window.addEventListener(COLLAPSED_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(COLLAPSED_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // Privat vindu eller blokkert lagring: ikke viktig nok til å si fra om.
  }
  window.dispatchEvent(new Event(COLLAPSED_EVENT))
}

export function SetupGuideWidget({
  guide,
  dismiss,
}: {
  guide: SetupGuide
  /** Legger guiden bort for godt. Vises bare når alt er gjort. */
  dismiss: () => Promise<{ error: string } | undefined>
}) {
  const collapsed = React.useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false)
  const [isPending, startTransition] = React.useTransition()
  const [gone, setGone] = React.useState(false)

  function toggle() {
    writeCollapsed(!collapsed)
  }

  function handleDismiss() {
    startTransition(async () => {
      const result = await dismiss()
      if (result?.error) toast.error(result.error)
      else setGone(true)
    })
  }

  if (gone) return null

  const total = guide.steps.length

  return (
    <aside
      aria-label="Getting started"
      className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-border bg-background text-foreground shadow-xl"
    >
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="relative inline-flex size-8 shrink-0 items-center justify-center">
          <svg aria-hidden="true" viewBox="0 0 36 36" className="size-8 -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" className="stroke-muted" />
            <circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              strokeWidth="3"
              // Butt ved null: en rund ende tegner en prikk selv uten lengde.
              strokeLinecap={guide.doneCount === 0 ? 'butt' : 'round'}
              className={guide.complete ? 'stroke-emerald-600' : 'stroke-foreground'}
              strokeDasharray={`${(guide.doneCount / total) * 94.2} 94.2`}
            />
          </svg>
          <span className="absolute text-[10px] font-semibold tabular-nums">
            {guide.doneCount}/{total}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{guide.complete ? 'You are ready' : 'Ready for your first show'}</span>
          {collapsed && guide.next && (
            <span className="block truncate text-xs text-muted-foreground">Next: {guide.next.label}</span>
          )}
        </span>
        {collapsed ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="border-t px-2 pb-3 pt-1">
          <ol className="flex flex-col">
            {guide.steps.map((step) => {
              const isNext = guide.next?.key === step.key
              return (
                <li key={step.key}>
                  <Link
                    href={step.href}
                    className={cn(
                      'flex items-start gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent',
                      step.done && 'text-muted-foreground',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]',
                        step.done ? 'border-emerald-600 bg-emerald-600 text-white' : isNext ? 'border-foreground' : 'border-border',
                      )}
                    >
                      {step.done && <Check className="size-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm', step.done ? 'line-through decoration-muted-foreground/60' : 'font-medium')}>
                        {step.label}
                      </span>
                      {isNext && <span className="mt-0.5 block text-xs text-muted-foreground">{step.hint}</span>}
                    </span>
                    {isNext && <ArrowRight className="mt-1 size-4 shrink-0" />}
                  </Link>
                </li>
              )
            })}
          </ol>

          {guide.complete && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm dark:bg-emerald-950/30">
              <span className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                <PartyPopper className="size-4" />
                Break a leg.
              </span>
              <Button type="button" size="sm" variant="outline" onClick={handleDismiss} disabled={isPending}>
                {isPending ? <Loader2 className="size-4 animate-spin" /> : 'Done'}
              </Button>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
