'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ImagePlus } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export type PosterTemplateListItem = {
  id: string
  name: string
  status: 'draft' | 'confirmed'
  thumbnailUrl: string | null
  isDefault: boolean
}

type Props = {
  templates: PosterTemplateListItem[]
  hasLegacyReference?: boolean
  createAction: (formData: FormData) => Promise<{ templateId: string }>
  setDefaultAction: (formData: FormData) => Promise<unknown>
  deleteAction: (formData: FormData) => Promise<unknown>
  convertReferenceAction?: () => Promise<{ templateId: string }>
}

export function PosterTemplatesManager({ templates, hasLegacyReference, createAction, setDefaultAction, deleteAction, convertReferenceAction }: Props) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [busy, setBusy] = React.useState(false)

  function onUpload(file: File) {
    const fd = new FormData()
    fd.set('template_file', file)
    setBusy(true)
    void (async () => {
      try {
        const { templateId } = await createAction(fd)
        toast.success('Mal opprettet. Justér feltene og bekreft.')
        router.push(`/admin-app/min-klubb/maler/${templateId}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Kunne ikke lage mal.')
      } finally {
        setBusy(false)
        if (inputRef.current) inputRef.current.value = ''
      }
    })()
  }

  function runAction(action: (fd: FormData) => Promise<unknown>, id: string, okMessage: string) {
    const fd = new FormData()
    fd.set('template_id', id)
    setBusy(true)
    void (async () => {
      try {
        await action(fd)
        toast.success(okMessage)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Noe gikk galt.')
      } finally {
        setBusy(false)
      }
    })()
  }

  function convertReference() {
    if (!convertReferenceAction) return
    setBusy(true)
    void (async () => {
      try {
        const { templateId } = await convertReferenceAction()
        toast.success('Mal laget fra referanseplakaten. Justér og bekreft.')
        router.push(`/admin-app/min-klubb/maler/${templateId}`)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Kunne ikke konvertere referansen.')
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plakatmaler</CardTitle>
        <CardDescription>
          Last opp en tidligere plakat du liker. Vi gjør den om til en mal – nye show får samme stil og struktur,
          og tekst og logoer blir alltid skarpe fordi de bygges med ekte fonter, ikke av AI.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {templates.length === 0 && hasLegacyReference && convertReferenceAction && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Du har en eksisterende AI-referanseplakat. Lag en mal fra den for å komme i gang.</p>
            <button type="button" disabled={busy} onClick={convertReference} className="rounded-md border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50">
              {busy ? 'Jobber…' : 'Lag mal fra referanse'}
            </button>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            if (file) onUpload(file)
          }}
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {templates.map((t) => (
            <div key={t.id} className="group overflow-hidden rounded-xl border">
              <Link href={`/admin-app/min-klubb/maler/${t.id}`} className="block aspect-[2/3] bg-muted/30">
                {t.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.thumbnailUrl} alt={t.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Ingen forhåndsvisning</div>
                )}
              </Link>
              <div className="space-y-1.5 p-2">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-medium">{t.name}</span>
                  {t.isDefault && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">Standard</span>}
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  <span className={`rounded px-1.5 py-0.5 font-medium ${t.status === 'confirmed' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
                    {t.status === 'confirmed' ? 'Bekreftet' : 'Utkast'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Link href={`/admin-app/min-klubb/maler/${t.id}`} className="rounded border px-2 py-1 text-[10px] hover:bg-muted">Rediger</Link>
                  {!t.isDefault && (
                    <button type="button" disabled={busy} onClick={() => runAction(setDefaultAction, t.id, 'Satt som klubbstandard.')} className="rounded border px-2 py-1 text-[10px] hover:bg-muted disabled:opacity-50">Sett som standard</button>
                  )}
                  <button type="button" disabled={busy} onClick={() => runAction(deleteAction, t.id, 'Mal slettet.')} className="rounded border border-red-300 px-2 py-1 text-[10px] text-red-600 hover:bg-red-50 disabled:opacity-50">Slett</button>
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="flex aspect-[2/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/20 px-3 text-center transition hover:border-foreground/25 hover:bg-muted/40 disabled:opacity-60"
          >
            <ImagePlus className="size-5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{busy ? 'Jobber…' : 'Last opp plakat som mal'}</span>
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
