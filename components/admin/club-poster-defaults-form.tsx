'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ImagePlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { saveClubPosterDefaultsAction } from '@/app/admin-app/min-klubb/actions'

type ClubPosterDefaultsFormProps = {
  clubId: string
  defaultAiPosterReferenceUrl: string | null
  defaultFrameBackgroundUrl: string | null
}

function PosterUpload({
  label,
  hint,
  previewUrl,
  emptyLabel,
  onSelect,
}: {
  label: string
  hint: string
  previewUrl: string | null
  emptyLabel: string
  onSelect: (file: File) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
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
        className="block w-full overflow-hidden rounded-xl border border-dashed border-border bg-muted/30 transition hover:border-foreground/25 hover:bg-muted/50"
      >
        {previewUrl ? (
          <div className="aspect-[2/3] w-full">
            <img src={previewUrl} alt="" className="h-full w-full object-contain" />
          </div>
        ) : (
          <div className="flex aspect-[2/3] w-full flex-col items-center justify-center gap-2 px-4 text-center">
            <ImagePlus className="size-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{emptyLabel}</p>
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
      toast.success('Plakat-standarder lagret.')
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
    <Card>
      <CardHeader>
        <CardTitle>Plakat-standarder</CardTitle>
        <CardDescription>
          Standard for nye shows. AI kopierer stil fra referanseplakaten. Ramme-bakgrunn skal være ren, uten personer eller tekst.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">
        <PosterUpload
          label="AI-referanseplakat"
          hint="Ferdig plakat som mal. Kun personer, navn og dato byttes."
          previewUrl={aiFile ? URL.createObjectURL(aiFile) : aiPreview}
          emptyLabel="Last opp referanseplakat"
          onSelect={(file) => {
            setAiFile(file)
            setAiPreview(URL.createObjectURL(file))
          }}
        />
        <PosterUpload
          label="Ramme-bakgrunn"
          hint="Rent bakgrunnsbilde. Komikere og tekst legges på automatisk."
          previewUrl={frameFile ? URL.createObjectURL(frameFile) : framePreview}
          emptyLabel="Last opp bakgrunn"
          onSelect={(file) => {
            setFrameFile(file)
            setFramePreview(URL.createObjectURL(file))
          }}
        />
      </CardContent>
      <CardFooter className="justify-end border-t">
        <Button type="button" disabled={isSaving || (!aiFile && !frameFile)} onClick={() => void handleSave()}>
          {isSaving ? 'Lagrer…' : 'Lagre plakat-standarder'}
        </Button>
      </CardFooter>
    </Card>
  )
}
