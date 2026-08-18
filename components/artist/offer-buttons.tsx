import { ToastActionForm } from '@/components/toast-action-form'
import { acceptOfferAction, declineOfferAction } from '@/app/artist-app/actions'
import { portalButton } from '@/components/artist/portal-ui'

/**
 * Aksepter/avslå-paret for et bookingtilbud.
 *
 * Ligger her og ikke i page.tsx: Next tillater bare et fast sett med
 * eksporter fra en route-fil, så `export function OfferButtons` derfra
 * ga typefeil i den genererte rutetypen.
 */
export function OfferButtons({ token }: { token: string }) {
  return (
    <>
      <ToastActionForm action={acceptOfferAction}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className={portalButton.primary}>Aksepter</button>
      </ToastActionForm>
      <ToastActionForm action={declineOfferAction}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className={portalButton.secondary}>Avslå</button>
      </ToastActionForm>
    </>
  )
}
