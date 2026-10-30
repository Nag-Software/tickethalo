'use client'

import { RotateCcw } from 'lucide-react'
import { CopyLink } from '@/components/admin/copy-link'
import { ToastActionForm } from '@/components/toast-action-form'
import { resetInviteLinkAction } from '@/app/admin-app/(protected)/artists/actions'

/**
 * Klubbens invitasjonslenke på Comedians-siden: kopier den, eller bytt den
 * ut når den har gått for langt. Se lib/club-invite.ts.
 */
export function InviteLinkCard({ url, joined }: { url: string; joined: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-5 sm:flex-row sm:items-start">
      <CopyLink
        url={url}
        label="Invite link"
        className="flex-1"
        hint={
          <>
            Comedians who sign up or log in through this link join your roster. They still show up in Discover
            comedians for other clubs.
            {joined > 0 && ` ${joined} ${joined === 1 ? 'comedian has' : 'comedians have'} joined via your link.`}
          </>
        }
      />
      <ToastActionForm action={resetInviteLinkAction} successMessage="New invite link created." className="sm:pt-6">
        <button
          type="submit"
          onClick={(event) => {
            if (!window.confirm('Reset the invite link? The current link stops working right away.')) {
              event.preventDefault()
            }
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RotateCcw className="size-4" aria-hidden />
          Reset link
        </button>
      </ToastActionForm>
    </div>
  )
}
