'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

type PosterReferenceToggleProps = {
  showId: string
  useReference: boolean
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

export function PosterReferenceToggle({ showId, useReference, action }: PosterReferenceToggleProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const [checked, setChecked] = React.useState(useReference)
  const [prevUseReference, setPrevUseReference] = React.useState(useReference)

  // Sync the optimistic state when the server value changes (after refresh).
  if (prevUseReference !== useReference) {
    setPrevUseReference(useReference)
    setChecked(useReference)
  }

  return (
    <label className={`flex cursor-pointer items-center gap-2.5 ${isPending ? 'opacity-70' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={isPending}
        onChange={(event) => {
          const next = event.currentTarget.checked
          setChecked(next)

          const formData = new FormData()
          formData.set('show_id', showId)
          formData.set('use_reference', next ? 'true' : 'false')

          startTransition(async () => {
            try {
              await action(formData)
              toast.success(next ? 'Plakaten bygger nå på referanseplakaten.' : 'Plakaten lages nå uten referanse.')
              router.refresh()
            } catch (error) {
              if (isNextControlFlowError(error)) throw error
              setChecked(!next)
              toast.error(getErrorMessage(error))
            }
          })
        }}
        className="size-4 accent-primary"
      />
      <span className="text-sm font-semibold">Bruk referanseplakat</span>
    </label>
  )
}
