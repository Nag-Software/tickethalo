'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

type PosterGenerateButtonProps = {
  showId: string
  posterUrl: string | null
  action: (formData: FormData) => Promise<{ posterUrl?: string | null } | unknown>
  children: React.ReactNode
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

export function PosterGenerateButton({ showId, posterUrl, action, children }: PosterGenerateButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        const formData = new FormData()
        formData.set('show_id', showId)

        startTransition(async () => {
          try {
            const result = await action(formData)
            const newPosterUrl = typeof result === 'object' && result !== null && 'posterUrl' in result
              ? String((result as { posterUrl?: string | null }).posterUrl ?? '')
              : ''

            if (newPosterUrl && newPosterUrl === posterUrl) {
              toast.info('Plakaten ble generert, men URL-en er uendret.')
            } else {
              toast.success('Ny plakat er klar.')
            }

            router.refresh()
          } catch (error) {
            if (isNextControlFlowError(error)) throw error
            toast.error(getErrorMessage(error))
          }
        })
      }}
      className="rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-70"
    >
      {isPending ? 'Genererer...' : children}
    </button>
  )
}
