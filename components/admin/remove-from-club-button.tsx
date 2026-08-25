'use client'

import { UserMinus } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import { disconnectArtistAction } from '@/app/admin-app/(protected)/discover/actions'

/**
 * Tar komikeren ut av klubbens liste — den sletter ingen.
 *
 * Komikeren er delt mellom klubbene på Tickethalo, så «fjern» her løser bare
 * koblingen (`club_artists`). Det er derfor knappen verken er rød eller heter
 * «Delete»: handlingen er reversibel med ett trykk i katalogen.
 */
export function RemoveFromClubButton({ artistId, name }: { artistId: string; name: string }) {
  return (
    <ToastActionForm action={disconnectArtistAction} successMessage={`${name} removed from your club.`}>
      <input type="hidden" name="artist_id" value={artistId} />
      <button
        type="submit"
        aria-label={`Remove ${name} from your club`}
        title="Remove from my club"
        onClick={(event) => {
          if (!window.confirm(`Remove ${name} from your club? You can add them back from Discover comedians.`)) {
            event.preventDefault()
          }
        }}
        className="inline-flex items-center rounded px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <UserMinus className="size-4" />
      </button>
    </ToastActionForm>
  )
}
