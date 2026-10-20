'use client'

import { BellOff, Trash2 } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import { deleteContactAction, unsubscribeContactAction } from './actions'

/**
 * To handlinger, fordi de svarer på to forskjellige ønsker:
 *
 * - «Ikke send meg mer» → avmeld. Adressen står igjen, så en senere import
 *   ikke legger den inn på nytt.
 * - «Slett det dere har om meg» → slett. Raden er borte, og med den sperren.
 */
export function ContactActions({ contactId, label, subscribed }: { contactId: string; label: string; subscribed: boolean }) {
  return (
    <div className="flex items-center justify-end gap-1">
      {subscribed && (
        <ToastActionForm action={unsubscribeContactAction} successMessage={`${label} unsubscribed.`}>
          <input type="hidden" name="contact_id" value={contactId} />
          <button
            type="submit"
            aria-label={`Unsubscribe ${label}`}
            title="Unsubscribe"
            onClick={(event) => {
              if (!window.confirm(`Unsubscribe ${label}? They will not get emails from you, and an import will not add them again.`)) {
                event.preventDefault()
              }
            }}
            className="inline-flex items-center rounded px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <BellOff className="size-4" />
          </button>
        </ToastActionForm>
      )}
      <ToastActionForm action={deleteContactAction} successMessage={`${label} deleted.`}>
        <input type="hidden" name="contact_id" value={contactId} />
        <button
          type="submit"
          aria-label={`Delete ${label}`}
          title="Delete contact"
          onClick={(event) => {
            if (!window.confirm(`Delete ${label} from your list? Use this when someone asks you to delete their data. To stop emails only, unsubscribe them instead.`)) {
              event.preventDefault()
            }
          }}
          className="inline-flex items-center rounded px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </ToastActionForm>
    </div>
  )
}
