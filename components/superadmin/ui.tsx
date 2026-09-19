import { cn } from '@/lib/utils'
import type { ShowStatus } from '@/types/database'

/** Delte byggeklosser for superadmin, så sidene sier det samme med samme form. */

export const SHOW_STATUS_LABELS: Record<ShowStatus, string> = {
  draft: 'Planlegger',
  booking: 'Booking',
  fullbooked: 'Full lineup',
  published: 'Publisert',
  completed: 'Gjennomført',
  cancelled: 'Avlyst',
}

const SHOW_STATUS_TONES: Record<ShowStatus, Tone> = {
  draft: 'muted',
  booking: 'blue',
  fullbooked: 'amber',
  published: 'green',
  completed: 'muted',
  cancelled: 'red',
}

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'muted'

const TONES: Record<Tone, string> = {
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  red: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  muted: 'bg-muted text-muted-foreground',
}

export function Pill({ tone, children, title }: { tone: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', TONES[tone])}>
      {children}
    </span>
  )
}

export function ShowStatusPill({ status }: { status: ShowStatus }) {
  return <Pill tone={SHOW_STATUS_TONES[status] ?? 'muted'}>{SHOW_STATUS_LABELS[status] ?? status}</Pill>
}

export function MetricCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </div>
  )
}

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function EmptyState({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-muted-foreground">
      <Icon className="size-8 opacity-40" />
      <div className="text-center text-sm">{children}</div>
    </div>
  )
}

export function formatNok(amountMinor: number) {
  return new Intl.NumberFormat('nb-NO', { style: 'currency', currency: 'NOK', maximumFractionDigits: 0 }).format(amountMinor / 100)
}

/** `shows.date` er en ren dato; bygges midt på dagen i UTC så den ikke tipper over. */
export function formatDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value)
  return date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Oslo' })
}

/**
 * Salgsklar-sjekklisten på norsk. `describeClubReadiness` skriver engelsk,
 * fordi klubbportalen er engelsk — superadmin er norsk.
 */
export const READINESS_LABELS_NB: Record<string, string> = {
  stripe_account: 'Stripe-konto opprettet',
  charges: 'Kan ta imot betaling',
  payouts: 'Bankkonto for utbetaling',
  payout_schedule: 'Utbetalinger holdes til etter showet',
  legal_name: 'Juridisk navn',
  org_number: 'Organisasjonsnummer',
}

/**
 * Én etikett for om klubben kan selge. Kontoen kan være ferdig hos Stripe mens
 * utbetalingene ikke holdes tilbake — det er en plattformfeil, ikke noe
 * klubben mangler, så den får sin egen tekst.
 */
export function ClubReadinessPill({
  hasAccount,
  missing,
}: {
  hasAccount: boolean
  missing: Array<{ key: string }>
}) {
  if (missing.length === 0) return <Pill tone="green">Klar for salg</Pill>

  const title = missing.map((item) => READINESS_LABELS_NB[item.key] ?? item.key).join(', ')
  const onlySchedule = missing.every((item) => item.key === 'payout_schedule')
  return (
    <Pill tone={onlySchedule ? 'red' : 'amber'} title={title}>
      {!hasAccount ? 'Ingen Stripe-konto' : onlySchedule ? 'Utbetalingsplan ikke manuell' : 'Oppsett ikke fullført'}
    </Pill>
  )
}
