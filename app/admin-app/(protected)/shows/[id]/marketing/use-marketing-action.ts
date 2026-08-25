'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

/**
 * Kjører en server action fra en knapp, ikke fra et skjema.
 *
 * Nesten alt i markedsføringsfanen er ett klikk på noe man ser — en farge, en
 * mal, en rute — og ikke et skjema som sendes inn. Uten dette ville hver av dem
 * fått sin egen kopi av try/catch, toast og `router.refresh()`.
 */

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Something went wrong. Please try again.'
}

function isNextControlFlowError(error: unknown) {
  const digest = typeof error === 'object' && error !== null && 'digest' in error
    ? String((error as { digest?: unknown }).digest ?? '')
    : ''

  return digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND')
}

export type RunOptions<T> = {
  success?: string | ((result: T) => string | null)
  /** Hopper over `router.refresh()` når kalleren selv styrer visningen. */
  skipRefresh?: boolean
  onSuccess?: (result: T) => void
}

export function useMarketingAction() {
  const router = useRouter()
  const [pendingKey, setPendingKey] = React.useState<string | null>(null)
  const [, startTransition] = React.useTransition()

  const run = React.useCallback(
    <T,>(key: string, work: () => Promise<T>, options: RunOptions<T> = {}) => {
      setPendingKey(key)
      startTransition(async () => {
        try {
          const result = await work()
          const message = typeof options.success === 'function'
            ? options.success(result)
            : options.success
          if (message) toast.success(message)
          options.onSuccess?.(result)
          if (!options.skipRefresh) router.refresh()
        } catch (error) {
          if (isNextControlFlowError(error)) throw error
          toast.error(getErrorMessage(error))
        } finally {
          setPendingKey(null)
        }
      })
    },
    [router],
  )

  return {
    run,
    /** Nøkkelen som kjører nå — brukes til å vise spinner på riktig knapp. */
    pendingKey,
    isPending: pendingKey !== null,
    isRunning: (key: string) => pendingKey === key,
  }
}
