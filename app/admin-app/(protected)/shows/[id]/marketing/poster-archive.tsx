'use client'

import Image from 'next/image'
import { Check, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMarketingAction } from './use-marketing-action'
import type { PosterSource } from '@/types/database'

/**
 * Plakatene showet har hatt.
 *
 * Hver generering og hver opplasting blir liggende her. «Regenerate» og
 * «Remove» tar aldri bort en fil — det gjør bare søppelbøtta på den enkelte
 * plakaten, og aldri på den som er i bruk. Ombestemmer klubben seg, er den
 * forrige plakaten ett klikk unna.
 */

export type ArchivedPoster = {
  id: string
  fileUrl: string
  source: PosterSource | null
  createdAt: string
  isActive: boolean
  /** True når lineupen er endret siden plakaten ble laget. */
  isOutdated: boolean
}

const SOURCE_LABEL: Record<PosterSource, string> = { ai: 'Generated', upload: 'Uploaded' }

function formatWhen(value: string) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    .format(new Date(value))
}

export function PosterArchive({
  showId,
  posters,
  restoreAction,
  deleteAction,
}: {
  showId: string
  posters: ArchivedPoster[]
  restoreAction: (formData: FormData) => Promise<{ posterUrl: string }>
  deleteAction: (formData: FormData) => Promise<void>
}) {
  const { run, isRunning, isPending } = useMarketingAction()
  if (posters.length === 0) return null

  function form(designId: string) {
    const formData = new FormData()
    formData.set('show_id', showId)
    formData.set('design_id', designId)
    return formData
  }

  return (
    <section className="rounded-xl border bg-card">
      <header className="border-b px-5 py-3.5">
        <h2 className="text-sm font-semibold">Previous posters</h2>
        <p className="text-xs text-muted-foreground">
          Every poster made for this show is kept. Pick one to put it back on the event page.
        </p>
      </header>

      <ul className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-4">
        {posters.map((poster) => (
          <li
            key={poster.id}
            className={`group relative overflow-hidden rounded-xl border ${
              poster.isActive ? 'border-primary ring-2 ring-primary/30' : ''
            }`}
          >
            <a href={poster.fileUrl} target="_blank" rel="noreferrer" className="relative block aspect-[2/3] bg-muted/20">
              <Image
                src={poster.fileUrl}
                alt={`Poster from ${formatWhen(poster.createdAt)}`}
                fill
                sizes="(max-width: 640px) 45vw, 200px"
                className="object-cover"
              />
              {poster.isActive && (
                <span className="absolute right-2 top-2 grid size-6 place-content-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3.5" aria-hidden />
                </span>
              )}
            </a>

            <div className="space-y-1.5 p-2.5">
              <p className="text-xs font-medium">{formatWhen(poster.createdAt)}</p>
              <p className="text-[11px] text-muted-foreground">
                {poster.source ? SOURCE_LABEL[poster.source] : 'Poster'}
                {poster.isOutdated && (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                    Lineup changed since
                  </span>
                )}
              </p>

              {poster.isActive ? (
                <p className="text-[11px] font-medium text-primary">In use on the show</p>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 text-xs"
                    disabled={isPending}
                    onClick={() => run(`use-${poster.id}`, () => restoreAction(form(poster.id)), { success: 'Poster put back on the show.' })}
                  >
                    {isRunning(`use-${poster.id}`) && <Loader2 className="animate-spin" aria-hidden />}
                    Use this
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={isPending}
                    aria-label="Delete this poster permanently"
                    title="Delete this poster permanently"
                    onClick={() => {
                      if (!window.confirm('Delete this poster permanently? This cannot be undone.')) return
                      run(`delete-${poster.id}`, () => deleteAction(form(poster.id)), { success: 'Poster deleted.' })
                    }}
                  >
                    {isRunning(`delete-${poster.id}`) ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
