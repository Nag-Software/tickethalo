'use client'

import { BellOff, MegaphoneOff, Trash2 } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import { deleteContactAction, stopAdsContactAction, unsubscribeContactAction } from './actions'

/**
 * To handlinger, fordi de svarer på to forskjellige ønsker:
 *
 * - «Ikke send meg mer» → avmeld. Adressen står igjen, så en senere import
 *   ikke legger den inn på nytt.
 * - «Slett det dere har om meg» → slett. Raden er borte, og med den sperren.
 *
 * Og en tredje for den som har sagt ja til annonser: «Vis meg ikke annonser»
 * → stopp annonsene. E-postene fortsetter.
 */
export function ContactActions({
  contactId,
  label,
  subscribed,
  adsConsent,
}: {
  contactId: string
  label: string
  subscribed: boolean
  adsConsent: boolean
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      {adsConsent && (
        <ToastActionForm action={stopAdsContactAction} successMessage={`${label} will not be in your Meta export.`}>
          <input type="hidden" name="contact_id" value={contactId} />
          <button
            type="submit"
            aria-label={`Stop ads for ${label}`}
            title="Stop ads"
            onClick={(event) => {
              if (!window.confirm(`Stop ads for ${label}? They keep getting emails, but will not be in your Meta export. Replace your audience in Meta to remove them there too.`)) {
                event.preventDefault()
              }
            }}
            className="inline-flex items-center rounded px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MegaphoneOff className="size-4" />
          </button>
        </ToastActionForm>
      )}
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
