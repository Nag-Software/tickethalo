import Link from 'next/link'
import { ArrowUpRight, ChevronRight, ExternalLink, Receipt, RefreshCw } from 'lucide-react'
import { AdminHeader } from '@/components/admin/admin-header'
import { InfoHint } from '@/components/admin/info-hint'
import { EarningsChart } from '@/components/admin/earnings-chart'
import { ToastActionForm } from '@/components/toast-action-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import {
  CLUB_CONNECT_FIELDS,
  type ConnectClub,
  describeClubReadiness,
  getAccountBalance,
} from '@/lib/stripe-connect'
import { getClubArtistFees } from '@/lib/artist-fees'
import { getFinanceSummary } from '@/lib/finances'
import { releasableAmount } from '@/lib/payouts'
import type { ArtistFeeInvoiceStatus } from '@/types/database'
import {
  openClubDashboardAction,
  refreshClubStatusAction,
  saveSellerDetailsAction,
  startClubOnboardingAction,
} from './actions'

/**
 * Hvor honorarfakturaen står, sagt til klubben. Saksgangen er vår, men
 * klubben skal kunne se om pengene faktisk har gått ut.
 */
const FEE_STATUS: Record<ArtistFeeInvoiceStatus, string> = {
  issued: 'Asked to invoice',
  received: 'Invoice received',
  approved: 'Approved',
  paid: 'Paid',
  rejected: 'On hold',
}

/**
 * The club's finance page.
 *
 * The club sells the ticket and owns the money from the moment of payment — it
 * sits in the club's own Stripe account, not with Tickethalo. The page leads
 * with what was earned, and keeps the setup out of the way once it is done.
 */
export default async function FinancesPage() {
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()

  const { data } = await db.from('clubs').select(CLUB_CONNECT_FIELDS).eq('id', clubId).single()
  if (!data) throw new Error('Could not find the club.')

  const club = data as unknown as ConnectClub
  const readiness = describeClubReadiness(club)
  const missing = readiness.filter((item) => !item.done)
  // Utledet fra sjekklista i stedet for `isClubPayoutReady`: den er et
  // typepredikat, og ville smalnet `club` til `never` i else-grenene her.
  const ready = missing.length === 0

  // Stripe krever kontakt-e-post for merchant-konfigurasjonen, så kontoen kan
  // ikke opprettes uten. Resten av lista kan fylles ut underveis.
  const canOnboard = Boolean(club.support_email?.trim())

  const [summary, artistFees, balance, upcoming, { data: payouts }, { data: settlements }] = await Promise.all([
    getFinanceSummary(clubId),
    getClubArtistFees(clubId),
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
      .limit(6),
    db
      .from('club_settlements')
      .select('id, period_start, gross_amount, commission_amount, refunded_amount, net_amount, currency')
      .eq('club_id', clubId)
      .order('period_start', { ascending: false })
      .limit(6),
  ])

  const feesTotal = artistFees.reduce((total, show) => total + show.total, 0)

  // Ører vises bare når det er noen. Honorarene er prosenter av et
  // billettsalg og lander sjelden på hele kroner; skjuler vi ørene, ser
  // klubben et annet tall enn det komikeren er bedt om å fakturere.
  const money = (value: number | null | undefined, currency = club.currency) => {
    if (value === null || value === undefined) return '—'
    const digits = value % 100 === 0 ? 0 : 2
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value / 100)
  }

  return (
    <div>
      <AdminHeader
        title="Finances"
        description={`The club sells the tickets. Tickethalo takes ${club.platform_fee_bps / 100}% in booking commission.`}
      />

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        {/* ── Earnings + setup ─────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-4">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Your earnings</CardTitle>
                <CardDescription>
                  Your share of ticket sales, after commission — last six months.
                </CardDescription>
                <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end text-right">
                  {/* Ett tall å lede med. Proporsjonale sifre: `tabular-nums`
                      gjør store tall luftige. */}
                  <div className="text-2xl font-semibold leading-none">{money(summary.periodNet)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {summary.periodTickets} {summary.periodTickets === 1 ? 'ticket' : 'tickets'}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <EarningsChart months={summary.months} currency={club.currency} />
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Available in Stripe" value={money(balance?.available, balance?.currency)} />
              <Stat label="In transit" value={money(balance?.pending, balance?.currency)} />
              <Stat
                label="Ready for payout"
                value={money(upcoming)}
                hint={`Released ${club.payout_hold_days} ${club.payout_hold_days === 1 ? 'day' : 'days'} after the show`}
              />
            </div>
          </div>

          {/* ── Setup guide ────────────────────────────────── */}
          <Card size="sm" className="h-fit">
            <CardHeader>
              <CardTitle>{ready ? 'Ready to sell' : 'Finish the setup'}</CardTitle>
              <CardDescription>
                {ready
                  ? 'Ticket money goes straight into the club’s own Stripe account. Tickethalo only takes the commission.'
                  : `${readiness.length - missing.length} of ${readiness.length} done. Shows cannot go on sale until the rest is in place.`}
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-4">
              {/* Er alt på plass, sier overskriften det allerede. En liste med
                  fem grønne haker og en «fortsett oppsettet»-knapp ville bare
                  antydet at det gjenstår noe. */}
              {!ready && (
                <ul className="flex flex-col gap-2">
                  {missing.map((item) => (
                    <li key={item.key} className="flex items-start gap-2 text-sm">
                      <span
                        aria-hidden
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--ev-accent-fill)]"
                      />
                      {item.label}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-col gap-2">
                {!ready && (
                  <ToastActionForm action={startClubOnboardingAction}>
                    <Button
                      type="submit"
                      // Stripe krever kontakt-e-post for merchant-konfigurasjonen.
                      // Bedre å stenge knappen med en forklaring under enn å la
                      // kallet feile etter at brukeren har trykket.
                      disabled={!canOnboard}
                      className="w-full"
                    >
                      {club.stripe_account_id ? 'Continue setup' : 'Connect Stripe'}
                      <ArrowUpRight data-icon="inline-end" />
                    </Button>
                  </ToastActionForm>
                )}

                {!canOnboard && (
                  <p className="text-xs text-muted-foreground">
                    Add a contact email under <strong>Seller details</strong> first — Stripe needs
                    it to create the account.
                  </p>
                )}

                {club.stripe_account_id && (
                  <div className="flex gap-2">
                    {club.charges_enabled && (
                      <ToastActionForm action={openClubDashboardAction} className="flex-1">
                        <Button
                          type="submit"
                          variant={ready ? 'default' : 'outline'}
                          size="sm"
                          className="w-full"
                        >
                          Open Stripe
                          <ExternalLink data-icon="inline-end" />
                        </Button>
                      </ToastActionForm>
                    )}
                    <ToastActionForm
                      action={refreshClubStatusAction}
                      successMessage="The account is ready to sell."
                      className="flex-1"
                    >
                      <Button type="submit" variant="ghost" size="sm" className="w-full">
                        <RefreshCw data-icon="inline-start" />
                        Refresh
                      </Button>
                    </ToastActionForm>
                  </div>
                )}
              </div>

              {club.charges_enabled && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  One setting lives in Stripe: turn on receipt emails under{' '}
                  <em>Customer emails</em>. The customer then gets a payment receipt in the
                  club&apos;s name. We send the ticket either way.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Artist fees ──────────────────────────────────── */}
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              Artist fees
              <InfoHint label="How fees are paid">
                <p>
                  What the club owes the lineup for shows that have been played. Each comedian gets a
                  reference and is told to invoice you against it.
                </p>
                <p>
                  Check an invoice against its reference before paying — that is how you know it is a
                  fee we actually asked for.
                </p>
              </InfoHint>
            </CardTitle>
            <CardDescription>Open a show to see who gets what.</CardDescription>
            {feesTotal > 0 && (
              <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end text-right">
                <div className="text-2xl font-semibold leading-none">{money(feesTotal)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {artistFees.length} {artistFees.length === 1 ? 'show' : 'shows'}
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent className="pb-0">
            <Button asChild variant="outline" size="sm">
              <Link href="/admin-app/finances/invoices">
                <Receipt data-icon="inline-start" />
                Check an invoice
              </Link>
            </Button>
          </CardContent>
          <CardContent>
            {artistFees.length === 0 ? (
              <Empty>Fees appear here once a booked show has been played.</Empty>
            ) : (
              <div className="flex flex-col divide-y">
                {/* `details` framfor en klient-komponent: siden er server-rendret,
                    og å utvide en rad trenger ingen tilstand vi må sende ned. */}
                {artistFees.map((show) => (
                  <details key={show.showId} className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-3 py-2.5 text-sm marker:hidden hover:text-foreground/80">
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                      <span className="w-24 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {new Date(show.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{show.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {show.lines.length} {show.lines.length === 1 ? 'comedian' : 'comedians'}
                      </span>
                      <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
                        {money(show.total, show.currency)}
                      </span>
                    </summary>

                    <div className="pb-3 pl-[2.1rem]">
                      <p className="text-xs text-muted-foreground">
                        {money(show.net, show.currency)} net ticket sales
                      </p>

                      <ul className="mt-1.5 flex flex-col">
                        {show.lines.map((line, index) => (
                          <li
                            key={`${show.showId}-${line.artistId}-${index}`}
                            className="flex items-baseline justify-between gap-4 py-1 text-sm"
                          >
                            <span className="min-w-0 truncate">
                              {line.name}
                              <span className="text-xs text-muted-foreground">
                                {' · '}
                                {line.agreement}
                                {line.capped && ' (capped)'}
                                {' · '}
                                {line.accountNumber ?? 'no account number'}
                                {/* Referansen står her fordi den er det klubben
                                    kan gjenfinne kostnaden på — den samme
                                    strengen som står på komikerens faktura. */}
                                {line.reference && (
                                  <>
                                    {' · '}
                                    <span className="font-mono">{line.reference}</span>
                                  </>
                                )}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-baseline gap-3">
                              <span className="w-24 text-right font-medium tabular-nums">
                                {money(line.amount, show.currency)}
                              </span>
                              {/* Bare de som faktisk skal ha penger kan vente på
                                  et fakturagrunnlag — null kroner sendes ikke. */}
                              <span className="w-28 text-right text-xs text-muted-foreground">
                                {line.amount <= 0
                                  ? ''
                                  : line.invoiceStatus
                                    ? FEE_STATUS[line.invoiceStatus]
                                    : line.notified ? 'Asked to invoice' : 'Not sent yet'}
                              </span>
                            </span>
                          </li>
                        ))}
                      </ul>

                      {show.overCommitted && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                          The agreed fixed fees are higher than the show earned — the club covers the
                          difference.
                        </p>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Seller details ───────────────────────────────── */}
        <Card size="sm">
          <CardHeader>
            <CardTitle>Seller details</CardTitle>
            <CardDescription>
              Shown as the seller on the ticket. The club is the seller and organiser — Tickethalo
              handles the ticketing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ToastActionForm action={saveSellerDetailsAction} successMessage="Seller details saved.">
              <div className="grid gap-4 sm:grid-cols-3">
                <SellerField
                  name="legal_name"
                  label="Legal name"
                  defaultValue={club.legal_name ?? ''}
                  placeholder="Comedy Club Ltd"
                />
                <SellerField
                  name="org_number"
                  label="Registration number"
                  defaultValue={club.org_number ?? ''}
                  placeholder="999 999 999"
                  inputMode="numeric"
                />
                <SellerField
                  name="support_email"
                  label="Contact for ticket buyers"
                  type="email"
                  defaultValue={club.support_email ?? ''}
                  placeholder="tickets@comedyclub.com"
                />
              </div>
              {/* Fakturaadressen står her og ikke i sin egen boks: det er den
                  samme identiteten. Men den er ikke en selgeropplysning
                  billettkjøperen ser, så den får sin egen linje og sin egen
                  forklaring. */}
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <SellerField
                  name="invoice_email"
                  label="Where comedians send invoices"
                  type="email"
                  defaultValue={club.invoice_email ?? ''}
                  placeholder="accounts@comedyclub.com"
                  hint="Goes in the settlement email we send the lineup. Falls back to the ticket-buyer contact."
                />
              </div>
              <div className="mt-4">
                <Button type="submit" size="sm">Save</Button>
              </div>
            </ToastActionForm>
          </CardContent>
        </Card>

        {/* ── Payouts and settlement ───────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Payouts</CardTitle>
              <CardDescription>
                Held until the show has taken place, so a cancellation can be refunded.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {payouts?.length ? (
                <ul className="flex flex-col divide-y">
                  {payouts.map((payout) => (
                    <li key={payout.id} className="flex items-center justify-between gap-4 py-2.5 text-sm first:pt-0 last:pb-0">
                      <span className="font-medium tabular-nums">{money(payout.amount, payout.currency)}</span>
                      <span className="text-xs text-muted-foreground">
                        {payout.status === 'paid' ? 'Paid' : payout.status === 'failed' ? 'Failed' : 'On the way'}
                        {' · '}
                        {new Date(payout.paid_at ?? payout.created_at).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No payouts yet.</Empty>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Settlement</CardTitle>
              <CardDescription>
                Gross ticket sales, less commission and refunds. The commission is exempt from VAT
                as intermediation of admission to a cultural event.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settlements?.length ? (
                <ul className="flex flex-col divide-y">
                  {settlements.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-4 py-2.5 text-sm first:pt-0 last:pb-0">
                      <span>
                        {new Date(row.period_start).toLocaleDateString('en-GB', {
                          month: 'long',
                          year: 'numeric',
                        })}
                      </span>
                      <span className="text-right">
                        <span className="font-medium tabular-nums">{money(row.net_amount, row.currency)}</span>
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {money(row.gross_amount, row.currency)} gross
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>The first settlement is created at the end of the month.</Empty>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card size="sm" className="gap-1 py-4">
      <CardContent>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-lg font-semibold">{value}</div>
        {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  )
}

function SellerField({
  name,
  label,
  defaultValue,
  placeholder,
  type = 'text',
  inputMode,
  hint,
}: {
  name: string
  label: string
  defaultValue: string
  placeholder?: string
  type?: string
  inputMode?: 'numeric'
  /** One line under the field, for what the value is actually used for. */
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
}
