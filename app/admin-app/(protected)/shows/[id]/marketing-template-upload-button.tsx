'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

type MarketingTemplateUploadButtonProps = {
  showId: string
  action: (formData: FormData) => Promise<unknown>
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

export function MarketingTemplateUploadButton({ showId, action }: MarketingTemplateUploadButtonProps) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [isPending, startTransition] = React.useTransition()

  return (
    <div className="border-t pt-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/heic,image/heif"
        className="sr-only"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          if (!file) return

          const formData = new FormData()
          formData.append('show_id', showId)
          formData.append('design_file', file)

          startTransition(async () => {
            try {
              await action(formData)
              toast.success('Template lastet opp.')
              router.refresh()
            } catch (error) {
              if (isNextControlFlowError(error)) throw error
              toast.error(getErrorMessage(error))
            } finally {
              if (inputRef.current) inputRef.current.value = ''
            }
          })
        }}
      />
      <button
        type="button"
        disabled={isPending}
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-70"
      >
        <span aria-hidden="true">+</span>
        {isPending ? 'Laster opp...' : 'Last opp template'}
      </button>
    </div>
  )
}