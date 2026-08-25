'use client'

import * as React from 'react'
import Image from 'next/image'
import { ExternalLink, ImageOff, Loader2, Sparkles, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MARKETING_EXPORT_SPECS, type MarketingExportSpec } from '@/lib/marketing/export-formats'
import { MARKETING_DESIGN_ACCEPT } from '@/lib/marketing/storage'
import { useMarketingAction } from './use-marketing-action'
import type { MarketingPalette, PosterSource } from '@/types/database'

/**
 * Plakaten, slik den ser ut i hver kanal.
 *
 * Formatvelgeren over bildet viser den *samme* beskjæringen som eksportfilene
 * får — `cover` der formatet ligger nær 2:3, plakaten hel oppå en uskarp
 * bakgrunn der det ikke gjør det. Da vet klubben hva den får før den bruker
 * tid på å generere filen.
 */

type StageFormat = 'poster' | MarketingExportSpec['format']

const POSTER_RATIO = 2 / 3

const SOURCE_BADGE: Record<PosterSource, { label: string; className: string }> = {
  upload: { label: 'Your own file', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' },
  ai: { label: 'AI generated', className: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400' },
}

export function PosterStage({
  showId,
  showTitle,
  posterUrl,
  posterSource,
  palette,
  canGenerate,
  generateHint,
  uploadAction,
  generateAction,
  clearAction,
}: {
  showId: string
  showTitle: string
  posterUrl: string | null
  posterSource: PosterSource | null
  palette: MarketingPalette
  canGenerate: boolean
  generateHint: string | null
  uploadAction: (formData: FormData) => Promise<{ posterUrl: string }>
  generateAction: (formData: FormData) => Promise<{ posterUrl: string | null }>
  clearAction: (formData: FormData) => Promise<void>
}) {
  const { run, isRunning, isPending } = useMarketingAction()
  const [format, setFormat] = React.useState<StageFormat>('poster')
  const inputRef = React.useRef<HTMLInputElement>(null)

  const spec = format === 'poster' ? null : MARKETING_EXPORT_SPECS.find((entry) => entry.format === format) ?? null
  const ratio = spec ? spec.width / spec.height : POSTER_RATIO
  const badge = posterSource ? SOURCE_BADGE[posterSource] : null

  function upload(file: File) {
    const formData = new FormData()
    formData.set('show_id', showId)
    formData.set('poster_file', file)
    formData.set('label', `${showTitle} — poster`)
    run('upload', () => uploadAction(formData), { success: 'Poster uploaded.' })
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold">Poster</h2>
          {badge && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}>{badge.label}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
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
          <Button size="sm" disabled={isPending} onClick={() => inputRef.current?.click()}>
            {isRunning('upload') ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
            {posterUrl ? 'Replace' : 'Upload poster'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={isPending || !canGenerate}
            title={generateHint ?? undefined}
            onClick={() => {
              const formData = new FormData()
              formData.set('show_id', showId)
              run('generate', () => generateAction(formData), { success: 'New AI poster is ready.' })
            }}
          >
            {isRunning('generate') ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            {posterUrl ? 'Regenerate with AI' : 'Generate with AI'}
          </Button>

          {posterUrl && (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={isPending}
              aria-label="Remove the poster from this show"
              title="Remove the poster from this show"
              onClick={() => {
                if (!window.confirm('Remove the poster from this show? The file stays in the library.')) return
                const formData = new FormData()
                formData.set('show_id', showId)
                run('clear', () => clearAction(formData), { success: 'Poster removed from the show.' })
              }}
            >
              {isRunning('clear') ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
            </Button>
          )}
        </div>
      </header>

      {posterUrl && (
        <div className="flex gap-1 overflow-x-auto border-b px-3 py-2">
          <FormatTab active={format === 'poster'} onClick={() => setFormat('poster')} label="Poster" sub="2:3" />
          {MARKETING_EXPORT_SPECS.map((entry) => (
            <FormatTab
              key={entry.format}
              active={format === entry.format}
              onClick={() => setFormat(entry.format)}
              label={entry.label}
              sub={`${entry.width}×${entry.height}`}
            />
          ))}
        </div>
      )}

      <div className="flex justify-center bg-muted/20 p-5">
        {posterUrl ? (
          <figure className="w-full max-w-[520px] space-y-2">
            <PosterPreview
              posterUrl={posterUrl}
              alt={`Poster for ${showTitle}`}
              ratio={ratio}
              framed={spec?.fit === 'blur'}
              backdropColor={palette.secondary}
            />
            <figcaption className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{spec ? spec.usage : 'The file shown on the event page and in the app.'}</span>
              <a
                href={posterUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"
              >
                Open original
                <ExternalLink className="size-3" aria-hidden />
              </a>
            </figcaption>
          </figure>
        ) : (
          <div className="flex aspect-[2/3] w-full max-w-[520px] flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-background/60 px-8 text-center">
            <ImageOff className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">No poster yet</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Upload your own artwork, or let the AI build one from your template, brand colours and photo slots.
            </p>
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => inputRef.current?.click()}>
              <Upload aria-hidden />
              Upload poster
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

function FormatTab({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean
  onClick: () => void
  label: string
  sub: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-lg px-3 py-1.5 text-left transition-colors ${
        active ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'
      }`}
    >
      <span className="block text-xs font-medium">{label}</span>
      <span className="block text-[10px] opacity-70">{sub}</span>
    </button>
  )
}

/**
 * Speiler `renderMarketingExport` i CSS.
 *
 * `framed` er `fit: 'blur'`-varianten: samme bilde uskarpt og nedtonet i
 * bakgrunnen, plakaten hel oppå. Endres innrammingen på serveren, skal den
 * endres her også — hele poenget er at forhåndsvisningen ikke lyver.
 */
function PosterPreview({
  posterUrl,
  alt,
  ratio,
  framed,
  backdropColor,
}: {
  posterUrl: string
  alt: string
  ratio: number
  framed: boolean
  backdropColor: string
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-lg border"
      style={{ aspectRatio: ratio, backgroundColor: backdropColor }}
    >
      {framed ? (
        <>
          <Image
            src={posterUrl}
            alt=""
            fill
            sizes="520px"
            aria-hidden
            className="scale-110 object-cover blur-xl brightness-[0.62]"
          />
          <div className="absolute inset-[7%]">
            <Image src={posterUrl} alt={alt} fill sizes="520px" className="object-contain drop-shadow-xl" />
          </div>
        </>
      ) : (
        <Image src={posterUrl} alt={alt} fill sizes="520px" className="object-cover" />
      )}
    </div>
  )
}
