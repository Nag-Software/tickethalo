import { AlertTriangle, ArrowUpRight, Check, ExternalLink, RefreshCw, X } from 'lucide-react'
import { AdminHeader } from '@/components/admin/admin-header'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import {
  CLUB_CONNECT_FIELDS,
  type ConnectClub,
  describeClubReadiness,
  getAccountBalance,
  isClubPayoutReady,
} from '@/lib/stripe-connect'
import { releasableAmount } from '@/lib/payouts'
import {
  openClubDashboardAction,
  refreshClubStatusAction,
  saveSellerDetailsAction,
  startClubOnboardingAction,
} from './actions'

/**
 * Klubbens økonomiside.
 *
 * Klubben er selger av billetten og eier pengene fra betalingsøyeblikket —
 * de ligger på klubbens egen Stripe-konto, ikke hos Tickethalo. Denne siden
 * er der klubben kobler kontoen, ser hva som er opptjent og når det utbetales.
 */
export default async function OkonomiPage() {
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()

  const { data } = await db.from('clubs').select(CLUB_CONNECT_FIELDS).eq('id', clubId).single()
  if (!data) throw new Error('Fant ikke klubben.')

  const club = data as unknown as ConnectClub
  const readiness = describeClubReadiness(club)
  const ready = isClubPayoutReady(club)

  const [balance, upcoming, { data: payouts }, { data: settlements }] = await Promise.all([
    club.stripe_account_id && club.payouts_enabled
      ? getAccountBalance(club.stripe_account_id).catch(() => null)
      : Promise.resolve(null),
    club.stripe_account_id
      ? releasableAmount({
        id: club.id,
        name: club.name,
        currency: club.currency,
        stripe_account_id: club.stripe_account_id,
        payout_hold_days: club.payout_hold_days,
      }).catch(() => 0)
      : Promise.resolve(0),
    db
      .from('club_payouts')
      .select('id, amount, currency, status, created_at, paid_at')
      .eq('club_id', clubId)
      .order('created_at', { ascending: false })
      .limit(12),
    db
      .from('club_settlements')
      .select('id, period_start, period_end, gross_amount, commission_amount, refunded_amount, net_amount, currency, document_number')
      .eq('club_id', clubId)
      .order('period_start', { ascending: false })
      .limit(12),
  ])

  const money = (value: number | null | undefined, currency = club.currency) =>
    value === null || value === undefined
      ? '—'
      : new Intl.NumberFormat('nb-NO', {
        style: 'currency',
        currency: currency.toUpperCase(),
        maximumFractionDigits: 0,
      }).format(value / 100)

  return (
    <div>
      <AdminHeader
        title="Økonomi"
        description={`Klubben er selger av billettene. Tickethalo tar ${(club.platform_fee_bps / 100).toFixed(0)} % i formidlingsprovisjon.`}
      />

      <div className="flex max-w-3xl flex-col gap-8 px-6 py-10 md:py-12">
        {/* ── Klarhet ────────────────────────────────────────── */}
        <section className="rounded-lg border p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Utbetalingskonto</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Billettpengene går rett inn på klubbens egen Stripe-konto. Tickethalo trekker kun
                provisjonen, og rører aldri resten.
              </p>
            </div>
            {ready ? (
              <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                Klar for salg
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                Ikke klar
              </span>
            )}
          </div>

          <ul className="mt-4 flex flex-col gap-1.5">
            {readiness.map((item) => (
              <li key={item.key} className="flex items-center gap-2 text-sm">
                {item.done ? (
                  <Check className="size-4 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <X className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className={item.done ? 'text-muted-foreground' : 'font-medium'}>{item.label}</span>
              </li>
            ))}
          </ul>

          {!ready && (
            <p className="mt-4 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Show kan ikke publiseres for salg før dette er på plass. Uten en ferdig konto finnes
                det ingen selger å ta imot pengene på vegne av, og billetten kan ikke navngi
                arrangøren.
              </span>
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <form action={startClubOnboardingAction}>
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                {club.stripe_account_id ? 'Fortsett oppsettet' : 'Koble Stripe-konto'}
                <ArrowUpRight className="size-3.5" aria-hidden />
              </button>
            </form>

            {club.stripe_account_id && (
              <>
                <form action={openClubDashboardAction}>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3.5 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    Åpne Stripe
                    <ExternalLink className="size-3.5" aria-hidden />
                  </button>
                </form>
                <form action={refreshClubStatusAction}>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                    Oppdater status
                  </button>
                </form>
              </>
            )}
          </div>

          {club.stripe_account_id && (
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Ett punkt må settes i Stripe og kan ikke settes herfra: slå på kvitteringsepost under
              <em> Customer emails → Successful payments</em>. Da får kunden en betalingskvittering
              i klubbens navn. Billetten med QR-kode sender vi uansett.
            </p>
          )}
        </section>

        {/* ── Penger ─────────────────────────────────────────── */}
        <section className="grid gap-4 sm:grid-cols-3">
          <Stat label="Tilgjengelig i Stripe" value={money(balance?.available, balance?.currency)} />
          <Stat label="Underveis" value={money(balance?.pending, balance?.currency)} />
          <Stat
            label="Klar til utbetaling"
            value={money(upcoming)}
            hint={`Frigis ${club.payout_hold_days} ${club.payout_hold_days === 1 ? 'dag' : 'dager'} etter showet`}
          />
        </section>

        {/* ── Selgeropplysninger ─────────────────────────────── */}
        <section className="rounded-lg border p-5">
          <h2 className="text-base font-semibold">Selgeropplysninger</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Dette står som selger på billetten kunden får, og i kjøpsvilkårene. Klubben er selger og
            arrangør — Tickethalo formidler billetten.
          </p>

          <form action={saveSellerDetailsAction} className="mt-4 flex flex-col gap-4">
            <Field
              name="legal_name"
              label="Juridisk navn"
              defaultValue={club.legal_name ?? ''}
              placeholder="Komiklubb AS"
            />
            <Field
              name="org_number"
              label="Organisasjonsnummer"
              defaultValue={club.org_number ?? ''}
              placeholder="999 999 999"
              hint="Ni siffer."
            />
            <Field
              name="support_email"
              label="Kontakt for billettkjøpere"
              type="email"
              defaultValue={club.support_email ?? ''}
              placeholder="billett@komiklubb.no"
              hint="Klubben eier kundeforholdet og svarer på spørsmål om arrangementet."
            />
            <div>
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Lagre
              </button>
            </div>
          </form>
        </section>

        {/* ── Utbetalinger ───────────────────────────────────── */}
        <section className="rounded-lg border">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-semibold">Utbetalinger</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pengene holdes til showet er avholdt, slik at en avlysning kan refunderes.
            </p>
          </div>
          {payouts?.length ? (
            <table className="w-full text-sm">
              <tbody>
                {payouts.map((payout) => (
                  <tr key={payout.id} className="border-b last:border-0">
                    <td className="px-5 py-3 font-medium">{money(payout.amount, payout.currency)}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {payout.status === 'paid' ? 'Utbetalt' : payout.status === 'failed' ? 'Feilet' : 'Underveis'}
                    </td>
                    <td className="px-5 py-3 text-right text-xs text-muted-foreground">
                      {new Date(payout.paid_at ?? payout.created_at).toLocaleDateString('nb-NO', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Ingen utbetalinger ennå.</p>
          )}
        </section>

        {/* ── Avregning ──────────────────────────────────────── */}
        <section className="rounded-lg border">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-semibold">Avregning</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Brutto billettsalg, minus formidlingsprovisjon og refusjoner. Provisjonen er unntatt
              merverdiavgift som formidling av adgang til kulturarrangement.
            </p>
          </div>
          {settlements?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 text-left font-medium">Periode</th>
                  <th className="px-5 py-2.5 text-left font-medium">Brutto</th>
                  <th className="px-5 py-2.5 text-left font-medium">Provisjon</th>
                  <th className="px-5 py-2.5 text-left font-medium">Refundert</th>
                  <th className="px-5 py-2.5 text-right font-medium">Utbetalt</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-5 py-3">
                      {new Date(row.period_start).toLocaleDateString('nb-NO', { month: 'long', year: 'numeric' })}
                      {row.document_number && (
                        <div className="text-xs text-muted-foreground">{row.document_number}</div>
                      )}
                    </td>
                    <td className="px-5 py-3">{money(row.gross_amount, row.currency)}</td>
                    <td className="px-5 py-3 text-muted-foreground">−{money(row.commission_amount, row.currency)}</td>
                    <td className="px-5 py-3 text-muted-foreground">−{money(row.refunded_amount, row.currency)}</td>
                    <td className="px-5 py-3 text-right font-medium">{money(row.net_amount, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              Første avregning lages ved månedsskiftet.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function Field({
  name,
  label,
  defaultValue,
  placeholder,
  hint,
  type = 'text',
}: {
  name: string
  label: string
  defaultValue: string
  placeholder?: string
  hint?: string
  type?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-9 rounded-md border bg-background px-3 text-sm"
      />
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}
