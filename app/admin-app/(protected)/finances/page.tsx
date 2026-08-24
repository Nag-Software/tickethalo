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
 * The club's finance page.
 *
 * The club sells the ticket and owns the money from the moment of payment — it
 * sits in the club's own Stripe account, not with Tickethalo. This page is
 * where the club connects that account, sees what has been earned and when it
 * is paid out.
 */
export default async function FinancesPage() {
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()

  const { data } = await db.from('clubs').select(CLUB_CONNECT_FIELDS).eq('id', clubId).single()
  if (!data) throw new Error('Club not found.')

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
      : new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: currency.toUpperCase(),
        maximumFractionDigits: 0,
      }).format(value / 100)

  return (
    <div>
      <AdminHeader
        title="Finances"
        description={`The club sells the tickets. Tickethalo takes ${(club.platform_fee_bps / 100).toFixed(0)}% in booking commission.`}
      />

      <div className="flex max-w-3xl flex-col gap-8 px-6 py-10 md:py-12">
        {/* ── Readiness ──────────────────────────────────────── */}
        <section className="rounded-lg border p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold">Payout account</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ticket money goes straight into the club&apos;s own Stripe account. Tickethalo only
                takes the commission and never touches the rest.
              </p>
            </div>
            {ready ? (
              <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                Ready to sell
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                Not ready
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
                Shows cannot be published for sale until this is in place. Without a finished
                account there is no seller to receive the money on behalf of, and the ticket cannot
                name the organiser.
              </span>
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <form action={startClubOnboardingAction}>
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                {club.stripe_account_id ? 'Continue setup' : 'Connect Stripe account'}
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
                    Open Stripe
                    <ExternalLink className="size-3.5" aria-hidden />
                  </button>
                </form>
                <form action={refreshClubStatusAction}>
                  <button
                    type="submit"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <RefreshCw className="size-3.5" aria-hidden />
                    Refresh status
                  </button>
                </form>
              </>
            )}
          </div>

          {club.stripe_account_id && (
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              One setting lives in Stripe and cannot be changed from here: turn on receipt emails
              under <em>Customer emails → Successful payments</em>. The customer then gets a payment
              receipt in the club&apos;s name. We send the ticket with the QR code either way.
            </p>
          )}
        </section>

        {/* ── Money ──────────────────────────────────────────── */}
        <section className="grid gap-4 sm:grid-cols-3">
          <Stat label="Available in Stripe" value={money(balance?.available, balance?.currency)} />
          <Stat label="In transit" value={money(balance?.pending, balance?.currency)} />
          <Stat
            label="Ready for payout"
            value={money(upcoming)}
            hint={`Released ${club.payout_hold_days} ${club.payout_hold_days === 1 ? 'day' : 'days'} after the show`}
          />
        </section>

        {/* ── Seller details ─────────────────────────────────── */}
        <section className="rounded-lg border p-5">
          <h2 className="text-base font-semibold">Seller details</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This appears as the seller on the ticket the customer gets, and in the terms of sale.
            The club is the seller and organiser — Tickethalo handles the ticketing.
          </p>

          <form action={saveSellerDetailsAction} className="mt-4 flex flex-col gap-4">
            <Field
              name="legal_name"
              label="Legal name"
              defaultValue={club.legal_name ?? ''}
              placeholder="Comedy Club Ltd"
            />
            <Field
              name="org_number"
              label="Company registration number"
              defaultValue={club.org_number ?? ''}
              placeholder="999 999 999"
              hint="Nine digits."
            />
            <Field
              name="support_email"
              label="Contact for ticket buyers"
              type="email"
              defaultValue={club.support_email ?? ''}
              placeholder="tickets@comedyclub.com"
              hint="The club owns the customer relationship and answers questions about the event."
            />
            <div>
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Save
              </button>
            </div>
          </form>
        </section>

        {/* ── Payouts ────────────────────────────────────────── */}
        <section className="rounded-lg border">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-semibold">Payouts</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The money is held until the show has taken place, so a cancellation can be refunded.
            </p>
          </div>
          {payouts?.length ? (
            <table className="w-full text-sm">
              <tbody>
                {payouts.map((payout) => (
                  <tr key={payout.id} className="border-b last:border-0">
                    <td className="px-5 py-3 font-medium">{money(payout.amount, payout.currency)}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {payout.status === 'paid' ? 'Paid out' : payout.status === 'failed' ? 'Failed' : 'In transit'}
                    </td>
                    <td className="px-5 py-3 text-right text-xs text-muted-foreground">
                      {new Date(payout.paid_at ?? payout.created_at).toLocaleDateString('en-GB', {
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
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">No payouts yet.</p>
          )}
        </section>

        {/* ── Settlement ─────────────────────────────────────── */}
        <section className="rounded-lg border">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-semibold">Settlement</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Gross ticket sales, less booking commission and refunds. The commission is exempt from
              VAT as intermediation of admission to a cultural event.
            </p>
          </div>
          {settlements?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 text-left font-medium">Period</th>
                  <th className="px-5 py-2.5 text-left font-medium">Gross</th>
                  <th className="px-5 py-2.5 text-left font-medium">Commission</th>
                  <th className="px-5 py-2.5 text-left font-medium">Refunded</th>
                  <th className="px-5 py-2.5 text-right font-medium">Paid out</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="px-5 py-3">
                      {new Date(row.period_start).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
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
              The first settlement is created at the end of the month.
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
