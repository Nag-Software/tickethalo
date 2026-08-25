'use client'

import * as React from 'react'
import { AlertTriangle, Check, Download, Loader2, RefreshCw, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MARKETING_EXPORT_SPECS } from '@/lib/marketing/export-formats'
import { useMarketingAction } from './use-marketing-action'
import type { MarketingExportFormat } from '@/types/database'

/**
 * De ferdige filene: Facebook-event, SoMe og trykk.
 *
 * Hvert format kjenner plakaten det ble laget av. Byttes plakaten, blir de
 * gamle filene merket som utdaterte i stedet for å bli slettet — klubben kan ha
 * rukket å laste dem opp et sted, og da er det verre å miste dem enn å se at de
 * er gamle.
 */

export type ExportState = {
  format: MarketingExportFormat
  fileUrl: string
  isStale: boolean
}

export function ExportPanel({
  showId,
  exports,
  hasPoster,
  generateAction,
  generateAllAction,
}: {
  showId: string
  exports: ExportState[]
  hasPoster: boolean
  generateAction: (formData: FormData) => Promise<{ format: MarketingExportFormat; fileUrl: string }>
  generateAllAction: (formData: FormData) => Promise<{ generated: number }>
}) {
  const { run, isRunning, isPending } = useMarketingAction()
  const byFormat = new Map(exports.map((entry) => [entry.format, entry]))
  const staleCount = exports.filter((entry) => entry.isStale).length

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Export</h2>
          <p className="text-xs text-muted-foreground">
            {hasPoster
              ? staleCount > 0
                ? `${staleCount} ${staleCount === 1 ? 'file is' : 'files are'} from an older poster.`
                : 'Ready-to-post files, cropped from the poster.'
              : 'Add a poster first — every format is cut from it.'}
          </p>
        </div>
        <Button
          size="sm"
          disabled={!hasPoster || isPending}
          onClick={() => {
            const formData = new FormData()
            formData.set('show_id', showId)
            run('all', () => generateAllAction(formData), {
              success: (result) => `${result.generated} of ${MARKETING_EXPORT_SPECS.length} files generated.`,
            })
          }}
        >
          {isRunning('all') ? <Loader2 className="animate-spin" aria-hidden /> : <Wand2 aria-hidden />}
          Export all
        </Button>
      </header>

      <ul className="divide-y">
        {MARKETING_EXPORT_SPECS.map((spec) => {
          const existing = byFormat.get(spec.format)
          const key = `export-${spec.format}`
          const busy = isRunning(key) || isRunning('all')

          return (
            <li key={spec.format} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{spec.label}</p>
                  {existing && !existing.isStale && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                      <Check className="size-2.5" aria-hidden />
                      Ready
                    </span>
                  )}
                  {existing?.isStale && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                      <AlertTriangle className="size-2.5" aria-hidden />
                      Outdated
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">{spec.usage}</p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {existing && (
                  <Button variant="ghost" size="icon-sm" asChild title={`Download ${spec.label}`}>
                    <a href={existing.fileUrl} target="_blank" rel="noreferrer" download>
                      <Download aria-hidden />
                      <span className="sr-only">Download {spec.label}</span>
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasPoster || isPending}
                  onClick={() => {
                    const formData = new FormData()
                    formData.set('show_id', showId)
                    formData.set('format', spec.format)
                    run(key, () => generateAction(formData), { success: `${spec.label} is ready.` })
                  }}
                >
                  {busy
                    ? <Loader2 className="animate-spin" aria-hidden />
                    : existing ? <RefreshCw aria-hidden /> : null}
                  {existing ? 'Rebuild' : 'Create'}
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
