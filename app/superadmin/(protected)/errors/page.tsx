import { AlertTriangle, Check } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { ToastActionForm } from '@/components/toast-action-form'
import { ConfirmActionButton } from '@/components/superadmin/confirm-action-button'
import { EmptyState, Pill, Section } from '@/components/superadmin/ui'
import { Button } from '@/components/ui/button'
import type { AppError } from '@/types/database'
import { resolveAllErrorsAction, resolveErrorAction } from './actions'

export const metadata = { title: 'Feil — Superadmin' }

/** Nok til å se et mønster; eldre feil er historikk, ikke arbeid. */
const UNRESOLVED_LIMIT = 200
const RESOLVED_LIMIT = 50

const SCOPE_LABELS: Record<string, string> = {
  checkout: 'Kjøp',
  free_tickets: 'Gratisbilletter',
  ticket_email: 'Billettepost',
  stripe_webhook: 'Stripe-webhook',
  cron: 'Cron',
}

function formatTime(value: string) {
  return new Date(value).toLocaleString('nb-NO', {
    timeZone: 'Europe/Oslo',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Feil appen selv har meldt fra om — se lib/error-log.ts.
 *
 * Lista er en innboks: det som venter står øverst, og hver rad kvitteres ut
 * når noen har sett på den. Konteksten (show, ordre, sesjon) står i raden,
 * så saken kan finnes igjen uten å lete i Vercel-loggen.
 */
export default async function ErrorsPage() {
  const db = createAdminClient()

  const [{ data: unresolvedRows }, { data: resolvedRows }] = await Promise.all([
    db.from('app_errors').select('*').is('resolved_at', null).order('created_at', { ascending: false }).limit(UNRESOLVED_LIMIT),
    db.from('app_errors').select('*').not('resolved_at', 'is', null).order('created_at', { ascending: false }).limit(RESOLVED_LIMIT),
  ])

  const unresolved = (unresolvedRows ?? []) as AppError[]
  const resolved = (resolvedRows ?? []) as AppError[]

  return (
    <div>
      <AdminHeader
        title="Feil"
        description="Det appen ikke fikk til: kjøp, billettepost, Stripe-webhook og cron"
      />

      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
        <Section
          title={`Venter (${unresolved.length}${unresolved.length === UNRESOLVED_LIMIT ? '+' : ''})`}
          description="Hver rad er noe som gikk galt for en kunde, en klubb eller en jobb. Kvitter ut når du har sett på den."
          actions={
            unresolved.length > 0 ? (
              <ConfirmActionButton
                action={resolveAllErrorsAction}
                fields={{}}
                confirmMessage={`Kvittere ut alle ${unresolved.length} feilene?`}
                successMessage="Alle feil er kvittert ut."
                variant="outline"
                size="sm"
              >
                <Check className="size-4" />
                Kvitter ut alle
              </ConfirmActionButton>
            ) : null
          }
        >
          {unresolved.length === 0 ? (
            <EmptyState icon={AlertTriangle}>Ingen feil venter.</EmptyState>
          ) : (
            <ErrorList errors={unresolved} resolvable />
          )}
        </Section>

        {resolved.length > 0 && (
          <Section title="Kvittert ut" description={`De ${RESOLVED_LIMIT} siste.`}>
            <ErrorList errors={resolved} />
          </Section>
        )}
      </div>
    </div>
  )
}

function ErrorList({ errors, resolvable = false }: { errors: AppError[]; resolvable?: boolean }) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {errors.map((row) => {
        const context = Object.entries(row.context ?? {})
        return (
          <li key={row.id} className={`flex items-start gap-3 px-4 py-3 ${resolvable ? '' : 'text-muted-foreground'}`}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={resolvable ? 'amber' : 'muted'}>{SCOPE_LABELS[row.scope] ?? row.scope}</Pill>
                <span className="text-xs tabular-nums text-muted-foreground">{formatTime(row.created_at)}</span>
              </div>
              <p className="mt-1.5 break-words text-sm font-medium">{row.message}</p>
              {context.length > 0 && (
                <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                  {context.map(([key, value]) => (
                    <div key={key} className="flex gap-1">
                      <dt className="font-medium">{key}</dt>
                      <dd className="break-all">{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {row.stack && (
                <details className="mt-1.5 text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">Stack</summary>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px]">{row.stack}</pre>
                </details>
              )}
            </div>
            {resolvable && (
              <ToastActionForm action={resolveErrorAction} successMessage="Kvittert ut." className="shrink-0">
                <input type="hidden" name="error_id" value={row.id} />
                <Button type="submit" variant="ghost" size="sm" aria-label="Kvitter ut">
                  <Check className="size-4" />
                  Sett
                </Button>
              </ToastActionForm>
            )}
          </li>
        )
      })}
    </ul>
  )
}
