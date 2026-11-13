import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { MetricCard, Section, ShowStatusPill, formatDate, formatNok } from '@/components/superadmin/ui'
import { describeClubReadiness } from '@/lib/stripe-connect'
import { getOsloToday } from '@/lib/event-filters'
import type { ShowStatus } from '@/types/database'

export const metadata = { title: 'Overview — Superadmin' }

const DAY_MS = 24 * 60 * 60 * 1000

/** Tidspunktet for `days` døgn siden, som ISO-streng til et `gte`-filter. */
function daysAgo(days: number) {
  return new Date(Date.now() - days * DAY_MS).toISOString()
}

/**
 * Forsiden til superadmin: hva står til, og hva venter på noen.
 *
 * `/superadmin` åpnet før rett i klubblisten, og alt annet måtte letes frem
 * side for side — en klubb som ikke kan selge, et show med full lineup som
 * ingen har publisert, e-poster som ikke går ut. Det er de tingene denne
 * siden samler øverst. Tallene under er pulsen, ikke noe å handle på.
 */
export default async function SuperadminOverviewPage() {
  const db = createAdminClient()
  const today = getOsloToday()
  const monthAgo = daysAgo(30)
  const weekAgo = daysAgo(7)

  const [
    { data: clubs },
    { data: memberships },
    { data: upcomingShows },
    { data: recentOrders },
    { count: approvedArtists },
    { count: newBetaRequests },
    { data: failedEmails },
  ] = await Promise.all([
    db.from('clubs')
      .select('id, name, city, stripe_account_id, charges_enabled, payouts_enabled, payout_schedule_interval, legal_name, org_number, support_email')
      .order('name'),
    db.from('club_memberships').select('club_id'),
    db.from('shows')
      .select('id, title, date, status, club_id')
      .is('deleted_at', null)
      .eq('is_template', false)
      .gte('date', today)
      .neq('status', 'cancelled')
      .order('date'),
    db.from('orders').select('amount_total').eq('status', 'paid').gte('created_at', monthAgo),
    db.from('artists').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    db.from('club_beta_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    db.from('email_logs')
      .select('id, recipient_email, template_name, error_message, created_at')
      .eq('status', 'failed')
      .gte('created_at', weekAgo)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const clubById = new Map((clubs ?? []).map((club) => [club.id, club]))
  const clubsWithAdmins = new Set((memberships ?? []).map((membership) => membership.club_id))

  const notReady = (clubs ?? []).filter((club) => describeClubReadiness(club).some((item) => !item.done))
  const withoutAdmins = (clubs ?? []).filter((club) => !clubsWithAdmins.has(club.id))
  const awaitingPublish = (upcomingShows ?? []).filter((show) => show.status === 'fullbooked')
  const revenue = (recentOrders ?? []).reduce((sum, order) => sum + (order.amount_total ?? 0), 0)

  type Alert = { key: string; text: string; href: string; detail?: string }
  const alerts: Alert[] = [
    ...((newBetaRequests ?? 0) > 0
      ? [{
        key: 'beta',
        text: `${newBetaRequests} ${newBetaRequests === 1 ? 'new beta request' : 'new beta requests'} awaiting a reply`,
        href: '/superadmin/beta-requests',
      }]
      : []),
    ...notReady.map((club) => ({
      key: `ready-${club.id}`,
      text: `${club.name} can't sell tickets`,
      detail: describeClubReadiness(club).filter((item) => !item.done).map((item) => item.label).join(' · '),
      href: `/superadmin/clubs/${club.id}`,
    })),
    ...withoutAdmins.map((club) => ({
      key: `admins-${club.id}`,
      text: `${club.name} has no admin`,
      detail: 'Nobody can sign in and run the club.',
      href: `/superadmin/clubs/${club.id}`,
    })),
    ...awaitingPublish.map((show) => ({
      key: `publish-${show.id}`,
      text: `“${show.title}” has a full lineup but isn't published`,
      detail: `${clubById.get(show.club_id ?? '')?.name ?? 'No club'} · ${formatDate(show.date)}`,
      href: show.club_id ? `/superadmin/clubs/${show.club_id}` : '/superadmin/clubs',
    })),
    ...((failedEmails ?? []).length > 0
      ? [{
        key: 'emails',
        text: `${failedEmails!.length}${failedEmails!.length === 5 ? '+' : ''} emails failed in the last 7 days`,
        detail: `Latest: ${failedEmails![0].template_name ?? 'unknown template'} to ${failedEmails![0].recipient_email} — ${failedEmails![0].error_message ?? 'unknown error'}`,
        href: '/superadmin/overview#epost',
      }]
      : []),
  ]

  return (
    <div>
      <AdminHeader title="Overview" description="How the platform is doing, and what is waiting on someone" />

      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
        <Section title="Needs attention">
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3.5 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Nothing is waiting. Every club can sell, and no requests are unhandled.
            </div>
          ) : (
            <ul className="divide-y overflow-hidden rounded-xl border bg-card">
              {alerts.map((alert) => (
                <li key={alert.key}>
                  <Link href={alert.href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60">
                    <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{alert.text}</p>
                      {alert.detail && <p className="truncate text-xs text-muted-foreground">{alert.detail}</p>}
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Platform right now">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Clubs"
              value={String((clubs ?? []).length)}
              detail={`${(clubs ?? []).length - notReady.length} ready to sell`}
            />
            <MetricCard label="Comedians" value={String(approvedArtists ?? 0)} detail="Approved and active" />
            <MetricCard
              label="Upcoming shows"
              value={String((upcomingShows ?? []).length)}
              detail={`${(upcomingShows ?? []).filter((show) => show.status === 'published').length} published`}
            />
            <MetricCard
              label="Revenue last 30 days"
              value={formatNok(revenue)}
              detail={`${(recentOrders ?? []).length} paid ${(recentOrders ?? []).length === 1 ? 'order' : 'orders'}`}
            />
          </div>
        </Section>

        <Section title="Next shows" description="The next ten shows across all clubs.">
          {(upcomingShows ?? []).length === 0 ? (
            <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">No upcoming shows.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Show</th>
                    <th className="px-4 py-2.5 font-medium">Club</th>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(upcomingShows ?? []).slice(0, 10).map((show) => {
                    const club = clubById.get(show.club_id ?? '')
                    return (
                      <tr key={show.id} className="border-b last:border-0">
                        <td className="px-4 py-2.5 font-medium">{show.title}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {club ? (
                            <Link href={`/superadmin/clubs/${club.id}`} className="hover:text-foreground hover:underline">
                              {club.name}
                            </Link>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{formatDate(show.date)}</td>
                        <td className="px-4 py-2.5 text-right"><ShowStatusPill status={show.status as ShowStatus} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {(failedEmails ?? []).length > 0 && (
          <div id="epost" className="scroll-mt-6">
            <Section title="Failed emails" description="Last 7 days. The full log is in the email_logs table.">
              <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm">
                {failedEmails!.map((email) => (
                  <li key={email.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <span className="font-medium">{email.template_name ?? 'Unknown template'}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(email.created_at)}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {email.recipient_email} — {email.error_message ?? 'unknown error'}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}
