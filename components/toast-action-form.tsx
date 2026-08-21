'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

type ToastActionFormProps = Omit<React.ComponentProps<'form'>, 'action' | 'onSubmit'> & {
  action: (formData: FormData) => Promise<unknown>
  successMessage?: string
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Something went wrong. Please try again.'
}

/**
 * Server actions that return `{ error }` instead of throwing. Next redacts the
 * message from thrown errors in production, so any action with a message the
 * user is meant to read returns it as a value.
 */
function getReturnedErrorMessage(result: unknown) {
  if (typeof result !== 'object' || result === null || !('error' in result)) return null

  const error = (result as { error?: unknown }).error
  if (typeof error === 'string') return error.trim() || null
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return null
}

function isNextControlFlowError(error: unknown) {
  const digest = typeof error === 'object' && error !== null && 'digest' in error
    ? String((error as { digest?: unknown }).digest ?? '')
    : ''

  return digest.startsWith('NEXT_REDIRECT') || digest.startsWith('NEXT_NOT_FOUND')
}

export function ToastActionForm({ action, successMessage, children, ...props }: ToastActionFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = React.useTransition()
  const formRef = React.useRef<HTMLFormElement>(null)

  return (
    <form
      {...props}
      ref={formRef}
      data-pending={isPending ? '' : undefined}
      onSubmit={(event) => {
        event.preventDefault()
        const form = event.currentTarget
        const formData = new FormData(form)
        const submitter = (event.nativeEvent as SubmitEvent).submitter

        if (
          submitter instanceof HTMLButtonElement ||
          submitter instanceof HTMLInputElement
        ) {
          if (submitter.name && !submitter.disabled) {
            formData.append(submitter.name, submitter.value)
          }
        }

        startTransition(async () => {
          try {
            const returnedError = getReturnedErrorMessage(await action(formData))
            // Refresh on a returned error too: it usually means the server state
            // has changed since the page was rendered — a show that sold out while
            // the tab sat open, for example.
            router.refresh()
            if (returnedError) toast.error(returnedError)
            else if (successMessage) toast.success(successMessage)
          } catch (error) {
            if (isNextControlFlowError(error)) throw error
            toast.error(getErrorMessage(error))
          }
        })
      }}
    >
      <fieldset disabled={isPending} className="contents disabled:pointer-events-none disabled:opacity-70">
        {children}
      </fieldset>
    </form>
  )
}