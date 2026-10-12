import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * En sendeknapp som viser at noe skjer.
 *
 * `ToastActionForm` setter `data-pending` på skjemaet mens handlingen
 * kjører og demper feltene, men knappen selv sto urørt. Et kall som tar
 * mange sekunder — «Connect Stripe» oppretter kontoen, laster opp logoen
 * og henter onboarding-lenken — så da ut som om ingenting skjedde, og folk
 * trykket igjen. Knappen bytter til et snurrende ikon og `pendingLabel` så
 * lenge skjemaet venter; ikonene som hører til hviletilstanden skjules.
 *
 * Virker i alle `ToastActionForm`, som alltid har `group` på seg.
 */
export function PendingButton({
  pendingLabel,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel: string }) {
  return (
    <Button {...props} className={cn('group-data-[pending]:pointer-events-none', className)}>
      <span className="contents group-data-[pending]:hidden">{children}</span>
      <span className="hidden items-center gap-2 group-data-[pending]:inline-flex">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {pendingLabel}
      </span>
    </Button>
  )
}
