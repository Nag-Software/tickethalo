'use client'

import * as React from 'react'
import Image from 'next/image'
import { Check, ImageOff, LayoutTemplate, Loader2, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MARKETING_DESIGN_ACCEPT } from '@/lib/marketing/storage'
import { templateFit } from '@/lib/marketing/slots'
import { useMarketingAction } from './use-marketing-action'

/**
 * Malvelgeren.
 *
 * Malene ligger i klubbens bibliotek, ikke på det enkelte showet, så den samme
 * malen kan brukes om igjen uten å lastes opp på nytt. Lista er sortert etter
 * hvor godt malen passer lineupen: har showet sju komikere, kommer malene med
 * sju bilderuter først, og de andre er merket med hva som skjer hvis de brukes.
 */

export type TemplateOption = {
  id: string
  label: string
  fileUrl: string
  fileName: string
  slotCount: number
  /** True når malen ligger på dette showet i stedet for i biblioteket. */
  isShowScoped: boolean
}

const FIT_TONE_CLASS: Record<string, string> = {
  exact: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
  close: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
  unknown: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400',
  off: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500',
}

export function TemplatePicker({
  showId,
  templates,
  selectedId,
  lineupSize,
  selectAction,
  uploadAction,
  deleteAction,
}: {
  showId: string
  templates: TemplateOption[]
  selectedId: string | null
  lineupSize: number
  selectAction: (formData: FormData) => Promise<void>
  uploadAction: (formData: FormData) => Promise<{ designId: string }>
  deleteAction: (formData: FormData) => Promise<void>
}) {
  const [isBrowsing, setIsBrowsing] = React.useState(false)
  const selected = templates.find((template) => template.id === selectedId) ?? null

  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Template</h2>
          <p className="text-xs text-muted-foreground">
            {templates.length === 0
              ? 'No templates in the library yet.'
              : `${templates.length} in your club library.`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setIsBrowsing(true)}>
          <LayoutTemplate aria-hidden />
          Browse templates
        </Button>
      </header>

      <div className="p-4">
        {selected ? (
          <div className="flex items-start gap-3">
            <div className="relative aspect-[3/4] w-24 shrink-0 overflow-hidden rounded-lg border bg-muted/20">
              <Image src={selected.fileUrl} alt={selected.label} fill sizes="96px" className="object-contain" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="truncate text-sm font-medium">{selected.label}</p>
              <FitBadge slotCount={selected.slotCount} lineupSize={lineupSize} />
              <p className="text-[11px] text-muted-foreground">
                {selected.isShowScoped ? 'Uploaded to this show.' : 'From the club library.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
            <ImageOff className="size-4 shrink-0" aria-hidden />
            <span>No template selected. The AI poster will design from scratch.</span>
          </div>
        )}
      </div>

      {isBrowsing && (
        <TemplateBrowser
          showId={showId}
          templates={templates}
          selectedId={selectedId}
          lineupSize={lineupSize}
          selectAction={selectAction}
          uploadAction={uploadAction}
          deleteAction={deleteAction}
          onClose={() => setIsBrowsing(false)}
        />
      )}
    </section>
  )
}

function FitBadge({ slotCount, lineupSize }: { slotCount: number; lineupSize: number }) {
  const fit = templateFit(slotCount, lineupSize)
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${FIT_TONE_CLASS[fit.tone]}`}>
      {fit.label}
    </span>
  )
}

function TemplateBrowser({
  showId,
  templates,
  selectedId,
  lineupSize,
  selectAction,
  uploadAction,
  deleteAction,
  onClose,
}: {
  showId: string
  templates: TemplateOption[]
  selectedId: string | null
  lineupSize: number
  selectAction: (formData: FormData) => Promise<void>
  uploadAction: (formData: FormData) => Promise<{ designId: string }>
  deleteAction: (formData: FormData) => Promise<void>
  onClose: () => void
}) {
  const { run, isRunning, isPending } = useMarketingAction()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [slotCount, setSlotCount] = React.useState(String(lineupSize || ''))

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const ranked = React.useMemo(
    () => [...templates].sort((a, b) => {
      const scoreA = templateFit(a.slotCount, lineupSize).score
      const scoreB = templateFit(b.slotCount, lineupSize).score
      if (scoreA !== scoreB) return scoreA - scoreB
      return a.label.localeCompare(b.label)
    }),
    [templates, lineupSize],
  )

  function upload(file: File) {
    const formData = new FormData()
    formData.set('show_id', showId)
    formData.set('design_file', file)
    formData.set('scope', 'club')
    formData.set('slot_count', slotCount || '0')
    formData.set('label', file.name.replace(/\.[^.]+$/, ''))
    run('upload', () => uploadAction(formData), { success: 'Template added to the library.' })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Browse templates"
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border bg-card shadow-xl sm:rounded-2xl">
        <header className="flex items-center justify-between gap-3 border-b px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">Browse templates</h3>
            <p className="text-xs text-muted-foreground">
              Sorted by fit for this lineup ({lineupSize} {lineupSize === 1 ? 'artist' : 'artists'}).
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X aria-hidden />
          </Button>
        </header>

        <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3 lg:grid-cols-4">
          {ranked.map((template) => {
            const isSelected = template.id === selectedId
            return (
              <div
                key={template.id}
                className={`group relative overflow-hidden rounded-xl border transition-colors ${
                  isSelected ? 'border-primary ring-2 ring-primary/30' : 'hover:border-foreground/30'
                }`}
              >
                <button
                  type="button"
                  disabled={isPending}
                  className="block w-full text-left disabled:opacity-60"
                  onClick={() => {
                    const formData = new FormData()
                    formData.set('show_id', showId)
                    formData.set('design_id', isSelected ? '' : template.id)
                    run(`select-${template.id}`, () => selectAction(formData), {
                      success: isSelected ? 'Template cleared.' : 'Template selected.',
                      onSuccess: () => { if (!isSelected) onClose() },
                    })
                  }}
                >
                  <div className="relative aspect-[3/4] bg-muted/20">
                    <Image
                      src={template.fileUrl}
                      alt={template.label}
                      fill
                      sizes="(max-width: 640px) 45vw, 220px"
                      className="object-contain"
                    />
                    {isRunning(`select-${template.id}`) && (
                      <div className="absolute inset-0 grid place-content-center bg-background/70">
                        <Loader2 className="size-5 animate-spin" aria-hidden />
                      </div>
                    )}
                    {isSelected && (
                      <span className="absolute right-2 top-2 grid size-6 place-content-center rounded-full bg-primary text-primary-foreground">
                        <Check className="size-3.5" aria-hidden />
                      </span>
                    )}
                  </div>
                  <div className="space-y-1 p-2.5">
                    <p className="truncate text-xs font-medium">{template.label}</p>
                    <FitBadge slotCount={template.slotCount} lineupSize={lineupSize} />
                  </div>
                </button>

                <button
                  type="button"
                  disabled={isPending}
                  aria-label={`Delete ${template.label}`}
                  className="absolute left-2 top-2 grid size-7 place-content-center rounded-full bg-background/90 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => {
                    if (!window.confirm(`Delete the template "${template.label}"? Shows using it lose the selection.`)) return
                    const formData = new FormData()
                    formData.set('show_id', showId)
                    formData.set('design_id', template.id)
                    run(`delete-${template.id}`, () => deleteAction(formData), { success: 'Template deleted.' })
                  }}
                >
                  {isRunning(`delete-${template.id}`)
                    ? <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    : <Trash2 className="size-3.5" aria-hidden />}
                </button>
              </div>
            )
          })}

          {ranked.length === 0 && (
            <p className="col-span-full rounded-xl border border-dashed bg-muted/20 px-4 py-12 text-center text-sm text-muted-foreground">
              Your club library is empty. Upload a design below and it becomes reusable across every show.
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t bg-muted/20 px-5 py-4">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Photo slots in the design
            <input
              type="number"
              min={0}
              max={24}
              value={slotCount}
              onChange={(event) => setSlotCount(event.currentTarget.value)}
              className="h-8 w-16 rounded-md border bg-background px-2 text-xs text-foreground"
            />
          </label>

          <input
            ref={inputRef}
            type="file"
            accept={MARKETING_DESIGN_ACCEPT}
            className="sr-only"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) upload(file)
            }}
          />
          <Button size="sm" disabled={isPending} onClick={() => inputRef.current?.click()} className="ml-auto">
            {isRunning('upload') ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            Upload template
          </Button>
        </footer>
      </div>
    </div>
  )
}
