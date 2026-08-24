'use client'

import { useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export function DeleteButton({
  action,
  id,
  idField,
  label = 'Delete',
  confirmMessage,
  tone = 'muted',
}: {
  action: (formData: FormData) => Promise<void>
  id: string
  idField: string
  label?: string
  confirmMessage: string
  /** 'danger' keeps the button red at all times, not only on hover. */
  tone?: 'muted' | 'danger'
}) {
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name={idField} value={id} />
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          if (window.confirm(confirmMessage)) {
            formRef.current?.requestSubmit()
          }
        }}
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors hover:bg-destructive/10 hover:text-destructive',
          tone === 'danger' ? 'font-medium text-destructive' : 'text-muted-foreground',
        )}
      >
        <Trash2 className="size-3.5" />
        {label}
      </button>
    </form>
  )
}
