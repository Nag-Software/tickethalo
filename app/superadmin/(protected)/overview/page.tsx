import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { MetricCard, Section, ShowStatusPill, formatDate, formatNok } from '@/components/superadmin/ui'
import { describeClubReadiness } from '@/lib/stripe-connect'
import { getOsloToday } from '@/lib/event-filters'
import type { ShowStatus } from '@/types/database'

export const metadata = { title: 'Oversikt — Superadmin' }

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
        text: `${newBetaRequests} ${newBetaRequests === 1 ? 'ny betasøknad' : 'nye betasøknader'} venter på svar`,
        href: '/superadmin/beta-requests',
      }]
      : []),
    ...notReady.map((club) => ({
      key: `ready-${club.id}`,
      text: `${club.name} kan ikke selge billetter`,
      detail: describeClubReadiness(club).filter((item) => !item.done).map((item) => item.label).join(' · '),
      href: `/superadmin/clubs/${club.id}`,
    })),
    ...withoutAdmins.map((club) => ({
      key: `admins-${club.id}`,
      text: `${club.name} har ingen admin`,
      detail: 'Ingen kan logge inn og drive klubben.',
      href: `/superadmin/clubs/${club.id}`,
    })),
    ...awaitingPublish.map((show) => ({
      key: `publish-${show.id}`,
      text: `«${show.title}» har full lineup, men er ikke publisert`,
      detail: `${clubById.get(show.club_id ?? '')?.name ?? 'Uten klubb'} · ${formatDate(show.date)}`,
      href: show.club_id ? `/superadmin/clubs/${show.club_id}` : '/superadmin/clubs',
    })),
    ...((failedEmails ?? []).length > 0
      ? [{
        key: 'emails',
        text: `${failedEmails!.length}${failedEmails!.length === 5 ? '+' : ''} e-poster feilet siste 7 dager`,
        detail: `Sist: ${failedEmails![0].template_name ?? 'ukjent mal'} til ${failedEmails![0].recipient_email} — ${failedEmails![0].error_message ?? 'ukjent feil'}`,
        href: '/superadmin/overview#epost',
      }]
      : []),
  ]

  return (
    <div>
      <AdminHeader title="Oversikt" description="Hva står til på plattformen, og hva venter på noen" />

      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
        <Section title="Trenger oppmerksomhet">
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3.5 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-emerald-600" />
              Ingenting venter. Alle klubber kan selge, og ingen søknader ligger ubehandlet.
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

        <Section title="Plattformen nå">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Klubber"
              value={String((clubs ?? []).length)}
              detail={`${(clubs ?? []).length - notReady.length} klare for salg`}
            />
            <MetricCard label="Komikere" value={String(approvedArtists ?? 0)} detail="Godkjent og aktive" />
            <MetricCard
              label="Kommende show"
              value={String((upcomingShows ?? []).length)}
              detail={`${(upcomingShows ?? []).filter((show) => show.status === 'published').length} publisert`}
            />
            <MetricCard
              label="Omsetning siste 30 dager"
              value={formatNok(revenue)}
              detail={`${(recentOrders ?? []).length} betalte ordrer`}
            />
          </div>
        </Section>

        <Section title="Neste show" description="De ti neste showene på tvers av klubbene.">
          {(upcomingShows ?? []).length === 0 ? (
            <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">Ingen kommende show.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Show</th>
                    <th className="px-4 py-2.5 font-medium">Klubb</th>
                    <th className="px-4 py-2.5 font-medium">Dato</th>
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
            <Section title="E-poster som feilet" description="Siste 7 dager. Hele loggen ligger i tabellen email_logs.">
              <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm">
                {failedEmails!.map((email) => (
                  <li key={email.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <span className="font-medium">{email.template_name ?? 'Ukjent mal'}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(email.created_at)}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {email.recipient_email} — {email.error_message ?? 'ukjent feil'}
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
