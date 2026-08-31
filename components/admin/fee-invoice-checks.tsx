import { AlertTriangle, CheckCircle2, Send, XCircle } from 'lucide-react'
import { ToastActionForm } from '@/components/toast-action-form'
import { Button } from '@/components/ui/button'
import { InfoHint } from '@/components/admin/info-hint'
import { formatMinor, type CheckLevel, type FeeInvoiceContext, type VerifyInvoiceResult } from '@/lib/fee-invoices'
import type { ArtistFeeInvoiceStatus } from '@/types/database'
import { resendFeeInvoiceAction, setFeeInvoiceStatusAction } from '@/app/admin-app/(protected)/finances/invoices/actions'

/**
 * Kontrollsvaret og handlingene på et fakturagrunnlag.
 *
 * Ligger utenfor siden fordi begge deler brukes to steder — i svaret på et
 * oppslag og på hver rad i lista — og fordi en side på fire hundre linjer er
 * vanskeligere å endre enn to filer på to hundre.
 */

/** Navnet komikeren går under. Scenenavn når det finnes. */
export function artistName(invoice: FeeInvoiceContext) {
  return invoice.artist?.stage_name?.trim() || invoice.artist?.full_name || 'Unknown comedian'
}

export function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Svaret på oppslaget.
 *
 * Konklusjonen, hvem det gjelder og hva som skal gjøres står på én linje, og
 * hver kontroll på én til. Begrunnelsene er flyttet bak en (i): den som har
 * gjort dette før trenger å se at det står tre grønne haker, ikke lese hvorfor
 * de er grønne. Den som lurer, klikker.
 *
 * Rødt får likevel sin begrunnelse framme. Skal noen la være å betale en
 * faktura, må de vite hva som er galt uten å måtte lete etter det.
 */
export function Verdict({ result }: { result: VerifyInvoiceResult }) {
  const failed = result.checks.some((check) => check.level === 'fail')
  const warned = result.checks.some((check) => check.level === 'warn')

  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        failed
          ? 'border-destructive/40 bg-destructive/5'
          : warned
            ? 'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
            : 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <CheckIcon level={failed ? 'fail' : warned ? 'warn' : 'ok'} />
          <span className="font-medium">
            {failed ? 'Do not pay' : warned ? 'Look over before paying' : 'Matches'}
          </span>
          {result.invoice && (
            <span className="truncate text-sm text-muted-foreground">
              {artistName(result.invoice)} · {formatMinor(result.invoice.amount, result.invoice.currency)}
              {result.invoice.agreement ? ` · ${result.invoice.agreement}` : ''}
            </span>
          )}
        </div>
        {result.invoice && <StatusButtons invoice={result.invoice} />}
      </div>

      <ul className="mt-2 flex flex-col gap-1">
        {result.checks.map((check) => (
          <li key={check.key} className="flex items-start gap-1.5 text-sm">
            <CheckIcon level={check.level} small />
            <span className="min-w-0">
              <span className={check.level === 'fail' ? 'font-medium' : ''}>{check.label}</span>
              {/* Avviket forklares på stedet; det som stemmer forklares på forespørsel. */}
              {check.level === 'fail'
                ? <span className="text-muted-foreground"> — {check.detail}</span>
                : <InfoHint label={check.label}>{check.detail}</InfoHint>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CheckIcon({ level, small = false }: { level: CheckLevel; small?: boolean }) {
  const size = small ? 'mt-0.5 size-3.5' : 'size-4'
  if (level === 'fail') return <XCircle className={`${size} shrink-0 text-destructive`} aria-label="Mismatch" />
  if (level === 'warn') return <AlertTriangle className={`${size} shrink-0 text-amber-600`} aria-label="Check this" />
  return <CheckCircle2 className={`${size} shrink-0 text-emerald-600`} aria-label="Matches" />
}

/**
 * Statusknappene.
 *
 * Bare det neste steget vises. «Paid» er den som stenger referansen mot en
 * dublett, og skal derfor ikke stå tilgjengelig ved siden av alt annet som en
 * knapp man klikker i farten.
 */
export function StatusButtons({ invoice }: { invoice: FeeInvoiceContext }) {
  const next: Array<{ status: ArtistFeeInvoiceStatus; label: string; variant?: 'default' | 'outline' | 'ghost' }> =
    invoice.status === 'issued' ? [{ status: 'received', label: 'Invoice received', variant: 'outline' }]
      : invoice.status === 'received' ? [
        { status: 'approved', label: 'Approve' },
        { status: 'rejected', label: 'Reject', variant: 'ghost' },
      ]
        : invoice.status === 'approved' ? [
          { status: 'paid', label: 'Mark as paid' },
          { status: 'rejected', label: 'Reject', variant: 'ghost' },
        ]
          : invoice.status === 'rejected' ? [{ status: 'issued', label: 'Reopen', variant: 'ghost' }]
            : []

  // Purringen står sammen med saksgangen, men ikke etter at pengene er ute:
  // «husk å fakturere oss» til en komiker som allerede har fått betalt er
  // ikke en påminnelse, det er en feil.
  const canResend = invoice.status !== 'paid' && invoice.status !== 'rejected'

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {canResend && (
        <ToastActionForm
          action={resendFeeInvoiceAction}
          successMessage={`Sent again to ${invoice.artist?.email ?? 'the comedian'}.`}
        >
          <input type="hidden" name="id" value={invoice.id} />
          {/* Ikon alene: purringen er den sjeldneste handlingen her, og
              trenger ikke bredden en etikett koster på hver eneste rad. */}
          <Button type="submit" size="icon-sm" variant="ghost" title="Resend" aria-label="Resend the fee email">
            <Send />
          </Button>
        </ToastActionForm>
      )}
      {next.map((step) => (
        <ToastActionForm
          key={step.status}
          action={setFeeInvoiceStatusAction}
          successMessage={step.status === 'paid' ? 'Marked as paid.' : undefined}
        >
          <input type="hidden" name="id" value={invoice.id} />
          <input type="hidden" name="status" value={step.status} />
          {step.status === 'rejected' && (
            <input type="hidden" name="note" value="Rejected during invoice control." />
          )}
          <Button type="submit" size="xs" variant={step.variant ?? 'default'}>
            {step.label}
          </Button>
        </ToastActionForm>
      ))}
    </div>
  )
}
