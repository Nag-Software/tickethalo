import {
  artistPrimaryButtonClass,
  artistSecondaryButtonClass,
} from '@/components/artist/artist-ui'
import { ToastActionForm } from '@/components/toast-action-form'
import { acceptOfferAction, declineOfferAction } from '../actions'

export function OfferButtons({ token }: { token: string }) {
  return (
    <>
      <ToastActionForm action={acceptOfferAction}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className={artistPrimaryButtonClass}>Aksepter</button>
      </ToastActionForm>
      <ToastActionForm action={declineOfferAction}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className={artistSecondaryButtonClass}>Avslå</button>
      </ToastActionForm>
    </>
  )
}
