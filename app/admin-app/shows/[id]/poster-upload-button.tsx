'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { PosterCropSheet } from '@/components/admin/poster-crop-sheet'

type PosterUploadButtonProps = {
  showId: string
  action: (formData: FormData) => Promise<{ posterUrl?: string | null } | unknown>
  className?: string
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Noe gikk galt. Prøv igjen.'
}

function isNextControlFlowError(error: unknown) {
  const digest = typeof error === 'object' && error !== null && 'digest' in error
    ? String((error as { digest?: unknown }).digest ?? '')
    : ''

  return digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND')
}

export function PosterUploadButton({ showId, action, className }: PosterUploadButtonProps) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = React.useTransition()
  const [cropOpen, setCropOpen] = React.useState(false)
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)
  const [fileName, setFileName] = React.useState('plakat.jpg')

  React.useEffect(() => {
    return () => {
      if (imageSrc?.startsWith('blob:')) URL.revokeObjectURL(imageSrc)
    }
  }, [imageSrc])

  function clearPreview() {
    if (imageSrc?.startsWith('blob:')) URL.revokeObjectURL(imageSrc)
    setImageSrc(null)
    setFileName('plakat.jpg')
    if (inputRef.current) inputRef.current.value = ''
  }

  async function uploadCroppedBlob(blob: Blob) {
    const formData = new FormData()
    formData.set('show_id', showId)
    formData.append('poster_file', blob, 'poster.jpg')

    startTransition(async () => {
      try {
        await action(formData)
        toast.success('Plakat lastet opp.')
        clearPreview()
        router.refresh()
      } catch (error) {
        if (isNextControlFlowError(error)) throw error
        toast.error(getErrorMessage(error))
      }
    })
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/heic,image/heif"
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (!file) return

          if (imageSrc?.startsWith('blob:')) URL.revokeObjectURL(imageSrc)
          setFileName(file.name)
          setImageSrc(URL.createObjectURL(file))
          setCropOpen(true)
        }}
      />
      <button
        type="button"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
        className={className ?? 'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-70'}
      >
        {isPending ? 'Laster opp...' : 'Last opp plakat'}
      </button>

      <PosterCropSheet
        open={cropOpen}
        imageSrc={imageSrc}
        fileName={fileName}
        onOpenChange={(open) => {
          setCropOpen(open)
          if (!open) clearPreview()
        }}
        onConfirm={uploadCroppedBlob}
      />
    </>
  )
}
