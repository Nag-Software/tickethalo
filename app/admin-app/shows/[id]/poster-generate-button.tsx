'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'

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
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [changeRequest, setChangeRequest] = React.useState('')

  const runGenerate = React.useCallback((options?: { changeRequest?: string; isRegeneration?: boolean }) => {
    const formData = new FormData()
    formData.set('show_id', showId)

    if (options?.isRegeneration) {
      formData.set('is_regeneration', 'true')
      const normalizedChangeRequest = options.changeRequest?.trim() ?? ''
      if (normalizedChangeRequest) formData.set('change_request', normalizedChangeRequest)
    }

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

        setIsDialogOpen(false)
        setChangeRequest('')
        router.refresh()
      } catch (error) {
        if (isNextControlFlowError(error)) throw error
        toast.error(getErrorMessage(error))
      }
    })
  }, [action, posterUrl, router, showId])

  return (
    <>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (posterUrl) {
            setIsDialogOpen(true)
            return
          }

          runGenerate()
        }}
        className="rounded-md border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-70"
      >
        {isPending ? 'Genererer...' : children}
      </button>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md gap-0 border-border/50 p-0 shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
            <DialogTitle className="text-sm font-medium">Hva skal endres på?</DialogTitle>
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Lukk"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </DialogClose>
          </div>

          {/* Body */}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              runGenerate({ isRegeneration: true, changeRequest })
            }}
          >
            <textarea
              value={changeRequest}
              onChange={(event) => setChangeRequest(event.target.value)}
              placeholder="Beskriv hva du vil endre, f.eks. «mørkere bakgrunn, mer luft rundt tekst» …"
              autoFocus
              maxLength={400}
              rows={7}
              className="w-full resize-none bg-transparent px-4 py-3.5 text-sm outline-none placeholder:text-muted-foreground/60"
            />

            {/* Footer */}
            <div className="flex items-end justify-between border-t border-border/40 px-4 py-2.5">
              <p className="max-w-[200px] text-[10px] leading-relaxed text-muted-foreground/60">
                Teksten sendes til OpenAI for å generere plakat. Ikke inkluder personopplysninger.
              </p>
              <Button type="submit" className="h-9 shrink-0 px-4 rounded-lg" disabled={isPending}>
                {isPending ? 'Genererer…' : 'Fortsett'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
