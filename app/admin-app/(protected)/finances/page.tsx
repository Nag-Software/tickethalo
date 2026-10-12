import Link from 'next/link'
import { ChevronRight, Receipt } from 'lucide-react'
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
import { CLUB_CONNECT_FIELDS, type ConnectClub, getAccountBalance, syncAccountStatus } from '@/lib/stripe-connect'
import { describeClubSetup } from '@/lib/club-setup'
import { orgNumberFieldLabel, orgNumberPlaceholder } from '@/lib/org-number'
import { ReadyCard, SetupCard } from './setup-card'
import { getClubArtistFees } from '@/lib/artist-fees'
import { getFinanceSummary } from '@/lib/finances'
import { getReleasableAmount } from '@/lib/payouts'
import type { ArtistFeeInvoiceStatus, ClubPayoutStatus } from '@/types/database'
import { saveSellerDetailsAction } from './actions'

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
 * Utbetalingens status slik Stripe melder den. «Paid» vises først når banken
 * har bekreftet — at Stripe godtok forespørselen betyr bare at den behandles.
 */
const PAYOUT_STATUS: Record<ClubPayoutStatus, string> = {
  creating: 'Being created',
  pending: 'Processing',
  in_transit: 'On the way',
  paid: 'Paid',
  failed: 'Failed',
  cancelled: 'Cancelled',
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

  let club = data as unknown as ConnectClub
  let setup = describeClubSetup(club)

  // Mens Stripe-steget pågår, hentes status fra Stripe hver gang siden
  // åpnes — også rett etter at klubben kommer tilbake fra onboardingen. Da
  // trenger ingen å trykke Refresh. Feiler kallet, vises det vi vet fra før.
  if (setup.step === 'stripe' && club.stripe_account_id) {
    try {
      const status = await syncAccountStatus(club.stripe_account_id)
      club = {
        ...club,
        charges_enabled: status.chargesEnabled,
        payouts_enabled: status.payoutsEnabled,
        payout_schedule_interval: status.payoutScheduleInterval ?? club.payout_schedule_interval,
      }
      setup = describeClubSetup(club)
    } catch (error) {
      console.error('[Finances] Could not sync Stripe status on page load:', error)
    }
  }
  const ready = setup.step === 'ready'

  const [summary, artistFees, balance, upcoming, { data: payouts }, { data: settlements }] = await Promise.all([
    getFinanceSummary(clubId),
    getClubArtistFees(clubId),
    club.stripe_account_id && club.payouts_enabled
      ? getAccountBalance(club.stripe_account_id).catch(() => null)
      : Promise.resolve(null),
    // Samme tall som utbetalingsjobben reserverer fra, så siden aldri lover
    // mer enn jobben vil frigi. Feiler oppslaget, vises en strek framfor en
    // null som ser ut som et svar.
    getReleasableAmount(clubId)
      .then((amount) => amount.releasable)
      .catch((error: unknown) => {
        console.error('[Finances] Could not compute releasable amount:', error)
        return null
      }),
    db
      .from('club_payouts')
      .select('id, amount, currency, status, created_at, paid_at, arrival_date, failure_reason, failed_at, cancelled_at')
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
        {/* ── Setup, one step at a time ──────────────────── */}
        {!ready && <SetupCard club={club} setup={setup} />}

        {/* ── Earnings ─────────────────────────────────────── */}
        <div className={ready ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]' : 'grid gap-6'}>
          <div className="flex flex-col gap-4">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Your earnings</CardTitle>
                <CardDescription>
                  Your share of ticket sales, after commission — last six months.
                  {club.ticket_vat_bps > 0 && ` Ticket prices include ${club.ticket_vat_bps / 100}% VAT.`}
                </CardDescription>
                <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end text-right">
                  {/* Ett tall å lede med. Proporsjonale sifre: `tabular-nums`
                      gjør store tall luftige. */}
                  <div className="text-2xl font-semibold leading-none">{money(summary.periodNet)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {summary.periodTickets} {summary.periodTickets === 1 ? 'ticket' : 'tickets'}
                  </div>
                  {/* Klubber med moms på billettene: tallet over er det de får
                      utbetalt. Momsen i det er deres å gjøre opp, og
                      honorarene regnes av resten. */}
                  {club.ticket_vat_bps > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      incl. {money(summary.periodVat)} VAT · {money(summary.periodNet - summary.periodVat)} ex VAT
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <EarningsChart months={summary.months} currency={club.currency} />
              </CardContent>
            </Card>

            <div className="grid gap-4 sm:grid-cols-3">
              <Stat label="Available in Stripe" value={money(balance?.available, balance?.currency)} />
              {/* Stripes ventende saldo: betalinger Stripe ikke har frigitt til
                  saldoen ennå. Det er ikke utbetalinger på vei til banken —
                  de står under Payouts. */}
              <Stat
                label="Pending in Stripe"
                value={money(balance?.pending, balance?.currency)}
                hint="Paid by customers, not yet available"
              />
              <Stat
                label="Ready for payout"
                value={money(upcoming)}
                hint={`Released ${club.payout_hold_days} ${club.payout_hold_days === 1 ? 'day' : 'days'} after the show`}
              />
            </div>
          </div>

          {ready && <ReadyCard club={club} />}
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
            <CardDescription>
              Open a show to see who gets what.
              {club.ticket_vat_bps > 0 && ' Fees are calculated from ticket revenue after VAT.'}
            </CardDescription>
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

        {/* Selgerkortet er steg 1 i oppsettet til det er fylt ut; etterpå
            er det her klubben redigerer opplysningene. */}
        {setup.step !== 'seller' && (
        <>
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
                  label={orgNumberFieldLabel(club.country)}
                  defaultValue={club.org_number ?? ''}
                  placeholder={orgNumberPlaceholder(club.country)}
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
        </>
        )}

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
                    <li key={payout.id} className="flex flex-col gap-0.5 py-2.5 text-sm first:pt-0 last:pb-0">
                      <div className="flex items-center justify-between gap-4">
                        <span className="font-medium tabular-nums">{money(payout.amount, payout.currency)}</span>
                        <span className="text-right text-xs text-muted-foreground">
                          {PAYOUT_STATUS[payout.status]}
                          {' · '}
                          {payoutDateLabel(payout)}
                        </span>
                      </div>
                      {/* Stripes egen forklaring. Som regel bankopplysningene —
                          klubben må rette dem i Stripe før neste forsøk. */}
                      {payout.status === 'failed' && payout.failure_reason && (
                        <p className="text-xs text-destructive">{payout.failure_reason}</p>
                      )}
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
                Gross ticket sales, less commission and refunds.{' '}
                {club.country === 'NO'
                  ? 'The commission is exempt from VAT as intermediation of admission to a cultural event.'
                  : `Tickethalo is a Norwegian company and invoices the commission without VAT. As a VAT-registered business in ${club.country === 'DK' ? 'Denmark' : 'Sweden'}, you account for the VAT yourself under reverse charge${club.org_number ? `, using your registration number ${club.org_number}` : ''}.`}
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

type PayoutListItem = {
  status: ClubPayoutStatus
  created_at: string
  paid_at: string | null
  arrival_date: string | null
  failed_at: string | null
  cancelled_at: string | null
}

/**
 * Datoen som betyr noe for statusen: når pengene kom fram, når de ventes, eller
 * når utbetalingen stoppet.
 */
function payoutDateLabel(payout: PayoutListItem) {
  const format = (value: string, timeZone?: string) =>
    new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone })

  // `arrival_date` er en ren dato (midnatt UTC). Formatert i serverens sone
  // kunne den havnet på dagen før.
  const arrival = payout.arrival_date ? format(payout.arrival_date, 'UTC') : null

  switch (payout.status) {
    case 'paid':
      return payout.paid_at ? format(payout.paid_at) : arrival ?? format(payout.created_at)
    case 'in_transit':
    case 'pending':
      return arrival ? `expected ${arrival}` : format(payout.created_at)
    case 'failed':
      return format(payout.failed_at ?? payout.created_at)
    case 'cancelled':
      return format(payout.cancelled_at ?? payout.created_at)
    default:
      return format(payout.created_at)
  }
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
