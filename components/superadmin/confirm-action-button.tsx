'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { isNextControlFlowError } from '@/components/admin/show-sales-action'

/**
 * En knapp som spør før den gjør noe som ikke kan angres.
 *
 * Slett klubb og fjern admin var ikon-knapper som gikk rett til databasen ved
 * første klikk. Handlingene svarer `{ error }` når de sier nei — den teksten
 * vises her, i stedet for en feilside.
 */
export function ConfirmActionButton({
  action,
  fields,
  confirmMessage,
  successMessage,
  children,
  ...button
}: {
  action: (formData: FormData) => Promise<unknown>
  fields: Record<string, string>
  confirmMessage: string
  successMessage?: string
} & Omit<React.ComponentProps<typeof Button>, 'onClick' | 'type'>) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function run() {
    if (!window.confirm(confirmMessage)) return

    const formData = new FormData()
    for (const [name, value] of Object.entries(fields)) formData.set(name, value)

    startTransition(async () => {
      try {
        const result = await action(formData)
        if (typeof result === 'object' && result !== null && 'error' in result) {
          toast.error(String((result as { error: unknown }).error))
          return
        }
        if (successMessage) toast.success(successMessage)
        router.refresh()
      } catch (error) {
        if (isNextControlFlowError(error)) throw error
        toast.error(error instanceof Error && error.message ? error.message : 'Noe gikk galt.')
      }
    })
  }

  return (
    <Button type="button" disabled={isPending} onClick={run} {...button}>
      {children}
    </Button>
  )
}
