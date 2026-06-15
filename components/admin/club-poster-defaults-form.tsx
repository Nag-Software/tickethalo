'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImageIcon, Layers, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { saveClubPosterDefaultsAction } from '@/app/admin-app/min-klubb/actions'

type ClubPosterDefaultsFormProps = {
  clubId: string
  defaultAiPosterReferenceUrl: string | null
  defaultFrameBackgroundUrl: string | null
}

function PosterAssetCard({
  title,
  description,
  previewUrl,
  emptyLabel,
  onSelect,
}: {
  title: string
  description: string
  previewUrl: string | null
  emptyLabel: string
  onSelect: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="rounded-xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black text-white">
          <ImageIcon className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (file) onSelect(file)
          if (inputRef.current) inputRef.current.value = ''
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="block w-full overflow-hidden rounded-xl border border-dashed bg-zinc-50 transition hover:border-zinc-400 hover:bg-zinc-100"
      >
        {previewUrl ? (
          <div className="relative aspect-[2/3] w-full">
            <img src={previewUrl} alt="" className="h-full w-full object-contain" />
          </div>
        ) : (
          <div className="flex aspect-[2/3] w-full flex-col items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </div>
        )}
      </button>
    </div>
  )
}

export function ClubPosterDefaultsForm({
  clubId,
  defaultAiPosterReferenceUrl,
  defaultFrameBackgroundUrl,
}: ClubPosterDefaultsFormProps) {
  const router = useRouter()
  const [aiPreview, setAiPreview] = useState(defaultAiPosterReferenceUrl)
  const [framePreview, setFramePreview] = useState(defaultFrameBackgroundUrl)
  const [aiFile, setAiFile] = useState<File | null>(null)
  const [frameFile, setFrameFile] = useState<File | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  async function handleSave() {
    if (!aiFile && !frameFile) {
      toast.error('Velg minst én fil å lagre.')
      return
    }

    const formData = new FormData()
    formData.set('club_id', clubId)
    if (aiFile) formData.set('ai_reference_file', aiFile)
    if (frameFile) formData.set('frame_background_file', frameFile)

    setIsSaving(true)
    try {
      await saveClubPosterDefaultsAction(formData)
      toast.success('Klubb-standard for plakater er lagret.')
      setAiFile(null)
      setFrameFile(null)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kunne ikke lagre plakat-standarder.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-amber-700">
            <Sparkles className="h-3.5 w-3.5" />
            Plakat-standarder
          </div>
          <h3 className="mt-3 text-xl font-semibold tracking-tight">Klubbens standard for lineup-plakater</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Disse brukes som default for nye shows. AI-referanse bevarer klubbens visuelle identitet. Ramme-bakgrunn må være ren uten personer eller tekst.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PosterAssetCard
          title="AI-referanseplakat"
          description="En ferdig plakat som AI skal kopiere identiteten fra. Kun personer, navn, tittel og dato byttes."
          previewUrl={aiFile ? URL.createObjectURL(aiFile) : aiPreview}
          emptyLabel="Last opp klubbens referanseplakat"
          onSelect={(file) => {
            setAiFile(file)
            setAiPreview(URL.createObjectURL(file))
          }}
        />
        <PosterAssetCard
          title="Ramme-bakgrunn"
          description="Rent bakgrunnsbilde uten personer eller tekst. Komikere og navn legges på automatisk."
          previewUrl={frameFile ? URL.createObjectURL(frameFile) : framePreview}
          emptyLabel="Last opp ren bakgrunn"
          onSelect={(file) => {
            setFrameFile(file)
            setFramePreview(URL.createObjectURL(file))
          }}
        />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={isSaving || (!aiFile && !frameFile)}
          onClick={() => void handleSave()}
          className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white transition hover:bg-black/90 disabled:pointer-events-none disabled:opacity-60"
        >
          {isSaving ? 'Lagrer…' : 'Lagre plakat-standarder'}
        </button>
      </div>
    </section>
  )
}
