import { ToastActionForm } from '@/components/toast-action-form'
import { acceptOfferAction, declineOfferAction } from '@/app/artist-app/actions'
import { portalButton } from '@/components/artist/portal-ui'
import { cn } from '@/lib/utils'

/**
 * Aksepter/avslå-paret for et bookingtilbud.
 *
 * Ligger her og ikke i page.tsx: Next tillater bare et fast sett med
 * eksporter fra en route-fil, så `export function OfferButtons` derfra
 * ga typefeil i den genererte rutetypen.
 *
 * `size="lg"` brukes på tilbudssiden, der svaret er hele poenget med
 * siden: Aksepter fyller raden og Avslå trer tilbake.
 */
export function OfferButtons({ token, size = 'sm' }: { token: string; size?: 'sm' | 'lg' }) {
  const large = size === 'lg'

  return (
    <div className={cn('flex items-center gap-2', large && 'w-full')}>
      <ToastActionForm action={acceptOfferAction} className={large ? 'flex-1' : undefined}>
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className={cn(portalButton.primary, large && 'h-12 w-full text-[15px]')}
        >
          Accept
        </button>
      </ToastActionForm>
      <ToastActionForm action={declineOfferAction}>
        <input type="hidden" name="token" value={token} />
        <button
          type="submit"
          className={cn(portalButton.secondary, large && 'h-12 px-6')}
        >
          Decline
        </button>
      </ToastActionForm>
    </div>
  )
}
