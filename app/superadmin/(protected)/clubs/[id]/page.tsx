import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Check, ChevronLeft, ExternalLink, Trash2, UserMinus, X } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { ToastActionForm } from '@/components/toast-action-form'
import { ConfirmActionButton } from '@/components/superadmin/confirm-action-button'
import {
  ClubReadinessPill,
  MetricCard,
  READINESS_LABELS_NB,
  SHOW_STATUS_LABELS,
  Section,
  ShowStatusPill,
  formatDate,
  formatNok,
} from '@/components/superadmin/ui'
import { PendingButton } from '@/components/pending-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeClubReadiness } from '@/lib/stripe-connect'
import { getOsloToday } from '@/lib/event-filters'
import { MAX_PLATFORM_FEE_PERCENT, MIN_PLATFORM_FEE_PERCENT, formatCommissionPercent } from '@/lib/platform-fee'
import { CLUB_COUNTRIES, MAX_TICKET_VAT_PERCENT, defaultTicketVatBps, formatVatPercent } from '@/lib/ticket-vat'
import {
  addClubAdminAction,
  deleteClubAction,
  removeClubAdminAction,
  updateClubCommissionAction,
  updateClubTaxAction,
} from '../actions'
import type { ShowStatus } from '@/types/database'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATUS_ORDER: ShowStatus[] = ['draft', 'booking', 'fullbooked', 'published', 'completed', 'cancelled']

export default async function ClubDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ adminError?: string }>
}) {
  const { id } = await params
  // Satt av createClubAction når klubben ble laget, men kontoen ikke.
  const { adminError } = await searchParams
  if (!UUID_PATTERN.test(id)) notFound()

  const db = createAdminClient()

  // Arkiverte show (slettet av bookeren, men med salgshistorikk) holdes utenfor
  // tallene og lista. De har bare refunderte ordrer, så inntekt og solgte
  // billetter blir de samme — men de telles for seg, så de ikke blir borte.
  const [{ data: club }, { data: memberships }, { data: clubShows }, { count: archivedShows }] = await Promise.all([
    db.from('clubs')
      .select('id, name, slug, city, description, created_at, support_email, stripe_account_id, charges_enabled, payouts_enabled, payout_schedule_interval, legal_name, org_number, platform_fee_bps, country, currency, ticket_vat_bps')
      .eq('id', id)
      .maybeSingle(),
    db.from('club_memberships')
      .select('id, profile_id, created_at, profiles(full_name, email, role)')
      .eq('club_id', id)
      .order('created_at'),
    db.from('shows')
      .select('id, title, date, status, capacity')
      .eq('club_id', id)
      .is('deleted_at', null)
      .eq('is_template', false)
      .order('date', { ascending: false }),
    db.from('shows')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', id)
      .not('deleted_at', 'is', null),
  ])

  if (!club) notFound()

  const allShows = clubShows ?? []
  const showIds = allShows.map((show) => show.id)

  const [{ data: ticketRows }, { data: orderRows }] = await Promise.all([
    showIds.length > 0
      ? db.from('tickets').select('show_id, status').in('show_id', showIds)
      : Promise.resolve({ data: [] as Array<{ show_id: string; status: string }> }),
    showIds.length > 0
      ? db.from('orders').select('show_id, amount_total, status').in('show_id', showIds)
      : Promise.resolve({ data: [] as Array<{ show_id: string | null; amount_total: number | null; status: string }> }),
  ])

  const today = getOsloToday()
  const upcoming = allShows.filter((show) => show.date >= today && show.status !== 'cancelled').reverse()
  const past = allShows.filter((show) => show.date < today).slice(0, 8)
  const totalCapacity = allShows.reduce((sum, show) => sum + (show.capacity ?? 0), 0)
  const soldByShow = new Map<string, number>()
  for (const ticket of ticketRows ?? []) {
    if (ticket.status === 'valid' || ticket.status === 'used') {
      soldByShow.set(ticket.show_id, (soldByShow.get(ticket.show_id) ?? 0) + 1)
    }
  }
  const ticketsSold = [...soldByShow.values()].reduce((sum, count) => sum + count, 0)
  const checkedIn = (ticketRows ?? []).filter((ticket) => ticket.status === 'used').length
  const paidOrders = (orderRows ?? []).filter((order) => order.status === 'paid')
  const grossRevenue = paidOrders.reduce((sum, order) => sum + (order.amount_total ?? 0), 0)
  const fillRate = totalCapacity > 0 ? Math.round((ticketsSold / totalCapacity) * 100) : 0

  const readiness = describeClubReadiness(club)
  const missing = readiness.filter((item) => !item.done)

  return (
    <div>
      <AdminHeader
        title={club.name}
        description={[club.city, `Created ${formatDate(club.created_at)}`].filter(Boolean).join(' · ')}
        actions={
          <>
            {/* Setter klubben i klubbvelgeren og åpner portalen som den klubben. */}
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin-app/select-club?club=${club.id}&next=${encodeURIComponent('/admin-app/shows')}`}>
                <ExternalLink className="size-4" />
                Open in club portal
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/clubs/${club.slug}`} target="_blank">Public page</Link>
            </Button>
          </>
        }
      />

      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
        <Button variant="ghost" size="sm" asChild className="-mb-4 -ml-2 w-fit text-muted-foreground">
          <Link href="/superadmin/clubs">
            <ChevronLeft className="size-4" />
            Clubs
          </Link>
        </Button>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Gross revenue" value={formatNok(grossRevenue)} detail={`${paidOrders.length} paid ${paidOrders.length === 1 ? 'order' : 'orders'}`} />
          <MetricCard
            label="Tickets sold"
            value={String(ticketsSold)}
            detail={totalCapacity > 0 ? `${fillRate}% of capacity · ${checkedIn} checked in` : `${checkedIn} checked in`}
          />
          <MetricCard
            label="Shows"
            value={String(allShows.length)}
            detail={`${upcoming.length} upcoming${(archivedShows ?? 0) > 0 ? ` · ${archivedShows} archived` : ''}`}
          />
          <MetricCard
            label="Average per show"
            value={formatNok(allShows.length > 0 ? Math.round(grossRevenue / allShows.length) : 0)}
            detail="Gross divided by number of shows"
          />
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* ── Kan klubben selge? ─────────────────────────── */}
          <Section
            title="Ticket sales"
            description="A show can't be published until everything here is in place. The club completes it under Finances."
            actions={<ClubReadinessPill hasAccount={Boolean(club.stripe_account_id)} missing={missing} />}
          >
            <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm">
              {readiness.map((item) => (
                <li key={item.key} className="flex items-center gap-2.5 px-4 py-2.5">
                  {item.done
                    ? <Check className="size-4 shrink-0 text-emerald-600" />
                    : <X className="size-4 shrink-0 text-amber-600" />}
                  <span className={item.done ? 'text-muted-foreground' : 'font-medium'}>
                    {READINESS_LABELS_NB[item.key] ?? item.label}
                  </span>
                </li>
              ))}
            </ul>
            {club.stripe_account_id && (
              <p className="text-xs text-muted-foreground">
                Stripe account: <code className="rounded bg-muted px-1 py-0.5">{club.stripe_account_id}</code>
              </p>
            )}
          </Section>

          {/* ── Hvem driver klubben ────────────────────────── */}
          <Section
            title={`Admins (${memberships?.length ?? 0})`}
            description="If the user doesn't exist, the account is created and an email with a link to set a password goes out."
          >
            {adminError && (
              <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {adminError} Try “Add” below.
              </p>
            )}
            {!memberships || memberships.length === 0 ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                No admins yet — nobody can sign in and run the club.
              </p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {memberships.map((membership) => {
                  const profile = Array.isArray(membership.profiles) ? membership.profiles[0] : membership.profiles
                  const label = profile?.full_name ?? profile?.email ?? 'Unknown user'
                  return (
                    <li key={membership.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{label}</p>
                        {profile?.full_name && <p className="truncate text-xs text-muted-foreground">{profile.email}</p>}
                      </div>
                      <ConfirmActionButton
                        action={removeClubAdminAction}
                        fields={{ membership_id: membership.id, club_id: club.id }}
                        confirmMessage={`Remove ${label} as admin of ${club.name}?`}
                        successMessage={`${label} has been removed.`}
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${label}`}
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <UserMinus className="size-3.5" />
                      </ConfirmActionButton>
                    </li>
                  )
                })}
              </ul>
            )}

            <ToastActionForm action={addClubAdminAction} successMessage="Admin added, and the email has been sent." className="flex gap-2">
              <input type="hidden" name="club_id" value={club.id} />
              <Label htmlFor="admin-email" className="sr-only">Email</Label>
              <Input id="admin-email" name="email" type="email" placeholder="admin@club.com" required />
              <PendingButton type="submit" size="sm" className="h-9" pendingLabel="Creating…">Add</PendingButton>
            </ToastActionForm>
          </Section>

          {/* ── Hva Tickethalo tar ─────────────────────────── */}
          <Section
            title="Commission"
            description="The share of the ticket price Tickethalo takes on each purchase. Applies from the next purchase; paid orders keep the commission they were sold with."
          >
            <ToastActionForm
              action={updateClubCommissionAction}
              successMessage="Commission saved."
              className="flex flex-col gap-3 rounded-xl border bg-card p-4"
            >
              <input type="hidden" name="club_id" value={club.id} />
              <div className="flex items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="commission-percent">Commission in percent</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="commission-percent"
                      name="commission_percent"
                      type="number"
                      inputMode="decimal"
                      min={MIN_PLATFORM_FEE_PERCENT}
                      max={MAX_PLATFORM_FEE_PERCENT}
                      step={0.5}
                      defaultValue={formatCommissionPercent(club.platform_fee_bps)}
                      required
                      className="w-24 tabular-nums"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
                <Button type="submit" size="sm" className="h-9">Save</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The default is 10%. Tickethalo pays the Stripe fee, which is around 4% of the ticket price,
                so below {MIN_PLATFORM_FEE_PERCENT}% we lose money on every sale.
              </p>
            </ToastActionForm>
          </Section>

          {/* ── Land og moms på billettene ─────────────────── */}
          <Section
            title="Country and VAT"
            description="VAT is calculated from the ticket price and deducted from the comedians' fee basis. Applies from the next purchase; paid orders keep the VAT they were sold with."
          >
            <ToastActionForm
              action={updateClubTaxAction}
              successMessage="Country and VAT saved."
              className="flex flex-col gap-3 rounded-xl border bg-card p-4"
            >
              <input type="hidden" name="club_id" value={club.id} />
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="club-country">Country</Label>
                  <select
                    id="club-country"
                    name="country"
                    defaultValue={club.country}
                    // Stripe-kontoen er opprettet i landet og kan ikke flyttes.
                    disabled={Boolean(club.stripe_account_id)}
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  >
                    {CLUB_COUNTRIES.map((country) => (
                      <option key={country.code} value={country.code}>{country.label}</option>
                    ))}
                  </select>
                  {club.stripe_account_id && <input type="hidden" name="country" value={club.country} />}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ticket-vat-percent">VAT on tickets</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="ticket-vat-percent"
                      name="ticket_vat_percent"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={MAX_TICKET_VAT_PERCENT}
                      step={0.5}
                      defaultValue={formatVatPercent(club.ticket_vat_bps)}
                      required
                      className="w-24 tabular-nums"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </div>
                <Button type="submit" size="sm" className="h-9">Save</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The default for {CLUB_COUNTRIES.find((country) => country.code === club.country)?.label ?? club.country} is{' '}
                {formatVatPercent(defaultTicketVatBps(club.country))}%. Currency: {club.currency}. Set 0 for a club that is
                VAT-exempt, for example a non-profit association.
              </p>
            </ToastActionForm>
          </Section>
        </div>

        <Section
          title="Shows"
          actions={
            <div className="flex flex-wrap gap-1.5">
              {STATUS_ORDER.map((status) => {
                const count = allShows.filter((show) => show.status === status).length
                if (count === 0) return null
                return (
                  <span key={status} className="rounded-full border bg-background px-2.5 py-1 text-[11px]">
                    {SHOW_STATUS_LABELS[status]} <span className="ml-1 text-muted-foreground tabular-nums">{count}</span>
                  </span>
                )
              })}
            </div>
          }
        >
          {allShows.length === 0 ? (
            <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              No shows linked to this club yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Show</th>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Sold</th>
                    <th className="px-4 py-2.5 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...upcoming, ...past].map((show) => (
                    <tr key={show.id} className={`border-b last:border-0 ${show.date < today ? 'text-muted-foreground' : ''}`}>
                      <td className="px-4 py-2.5 font-medium">{show.title}</td>
                      <td className="px-4 py-2.5 tabular-nums">{formatDate(show.date)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {soldByShow.get(show.id) ?? 0}{show.capacity ? ` / ${show.capacity}` : ''}
                      </td>
                      <td className="px-4 py-2.5 text-right"><ShowStatusPill status={show.status as ShowStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {allShows.length > upcoming.length + past.length && (
            <p className="text-xs text-muted-foreground">Showing all upcoming shows and the last eight past shows.</p>
          )}
        </Section>

        {/* ── Faresone ─────────────────────────────────────── */}
        <Section
          title="Delete club"
          description="Removes the club, the admin access and the club's setup. A club with orders can't be deleted — the accounts must stay."
        >
          <ConfirmActionButton
            action={deleteClubAction}
            fields={{ club_id: club.id }}
            confirmMessage={`Delete ${club.name} permanently? This can't be undone.`}
            variant="outline"
            size="sm"
            className="w-fit border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
            Delete {club.name}
          </ConfirmActionButton>
        </Section>
      </div>
    </div>
  )
}
