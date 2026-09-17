'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

/**
 * Felles kjøring for dialogene rundt billettsalg og sletting.
 *
 * Handlingene returnerer `{ error }` for det bookeren skal lese. Kaster en
 * handling likevel, er det noe uventet — da vises en generell melding, men
 * aldri en feilside midt i en dialog. `redirect` fra en handling er ikke en
 * feil og slippes gjennom til Next.
 *
 * Siden oppdateres uansett utfall: en feil betyr ofte at noe har endret seg
 * siden siden ble tegnet, som et kjøp som kom inn mens dialogen sto åpen.
 * Det gjelder også når handlingen kaster — et tidsavbrudd midt i «Refund all»
 * kan ha refundert halve showet, og tallene i panelet skal vise det.
 */
export function useShowSalesAction() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function run<T>(action: () => Promise<T>, onDone: (result: T) => void) {
    startTransition(async () => {
      try {
        const result = await action()
        router.refresh()
        onDone(result)
      } catch (error) {
        if (isNextControlFlowError(error)) throw error
        router.refresh()
        toast.error(error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.')
      }
    })
  }

  return { isPending, run }
}

export function isNextControlFlowError(error: unknown) {
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error
      ? String((error as { digest?: unknown }).digest ?? '')
      : ''

  return digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND')
}
