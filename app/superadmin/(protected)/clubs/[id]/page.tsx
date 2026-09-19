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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { describeClubReadiness } from '@/lib/stripe-connect'
import { getOsloToday } from '@/lib/event-filters'
import { addClubAdminAction, deleteClubAction, removeClubAdminAction } from '../actions'
import type { ShowStatus } from '@/types/database'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATUS_ORDER: ShowStatus[] = ['draft', 'booking', 'fullbooked', 'published', 'completed', 'cancelled']

export default async function ClubDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID_PATTERN.test(id)) notFound()

  const db = createAdminClient()

  // Arkiverte show (slettet av bookeren, men med salgshistorikk) holdes utenfor
  // tallene og lista. De har bare refunderte ordrer, så inntekt og solgte
  // billetter blir de samme — men de telles for seg, så de ikke blir borte.
  const [{ data: club }, { data: memberships }, { data: clubShows }, { count: archivedShows }] = await Promise.all([
    db.from('clubs')
      .select('id, name, slug, city, description, created_at, support_email, stripe_account_id, charges_enabled, payouts_enabled, payout_schedule_interval, legal_name, org_number')
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
        description={[club.city, `Opprettet ${formatDate(club.created_at)}`].filter(Boolean).join(' · ')}
        actions={
          <>
            {/* Setter klubben i klubbvelgeren og åpner portalen som den klubben. */}
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin-app/select-club?club=${club.id}&next=${encodeURIComponent('/admin-app/shows')}`}>
                <ExternalLink className="size-4" />
                Åpne i klubbportalen
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/clubs/${club.slug}`} target="_blank">Offentlig side</Link>
            </Button>
          </>
        }
      />

      <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
        <Button variant="ghost" size="sm" asChild className="-mb-4 -ml-2 w-fit text-muted-foreground">
          <Link href="/superadmin/clubs">
            <ChevronLeft className="size-4" />
            Klubber
          </Link>
        </Button>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard label="Brutto inntekt" value={formatNok(grossRevenue)} detail={`${paidOrders.length} betalte ordrer`} />
          <MetricCard
            label="Billetter solgt"
            value={String(ticketsSold)}
            detail={totalCapacity > 0 ? `${fillRate} % av kapasiteten · ${checkedIn} sjekket inn` : `${checkedIn} sjekket inn`}
          />
          <MetricCard
            label="Show"
            value={String(allShows.length)}
            detail={`${upcoming.length} kommende${(archivedShows ?? 0) > 0 ? ` · ${archivedShows} arkivert` : ''}`}
          />
          <MetricCard
            label="Snitt per show"
            value={formatNok(allShows.length > 0 ? Math.round(grossRevenue / allShows.length) : 0)}
            detail="Brutto delt på antall show"
          />
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* ── Kan klubben selge? ─────────────────────────── */}
          <Section
            title="Billettsalg"
            description="Et show kan ikke publiseres før alt her er på plass. Klubben fullfører det selv under Finances."
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
                Stripe-konto: <code className="rounded bg-muted px-1 py-0.5">{club.stripe_account_id}</code>
              </p>
            )}
          </Section>

          {/* ── Hvem driver klubben ────────────────────────── */}
          <Section
            title={`Admins (${memberships?.length ?? 0})`}
            description="Brukeren må allerede ha registrert seg. Rollen settes automatisk til admin."
          >
            {!memberships || memberships.length === 0 ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                Ingen admins ennå — ingen kan logge inn og drive klubben.
              </p>
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                {memberships.map((membership) => {
                  const profile = Array.isArray(membership.profiles) ? membership.profiles[0] : membership.profiles
                  const label = profile?.full_name ?? profile?.email ?? 'Ukjent bruker'
                  return (
                    <li key={membership.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{label}</p>
                        {profile?.full_name && <p className="truncate text-xs text-muted-foreground">{profile.email}</p>}
                      </div>
                      <ConfirmActionButton
                        action={removeClubAdminAction}
                        fields={{ membership_id: membership.id, club_id: club.id }}
                        confirmMessage={`Fjerne ${label} som admin for ${club.name}?`}
                        successMessage={`${label} er fjernet.`}
                        variant="ghost"
                        size="icon"
                        aria-label={`Fjern ${label}`}
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <UserMinus className="size-3.5" />
                      </ConfirmActionButton>
                    </li>
                  )
                })}
              </ul>
            )}

            <ToastActionForm action={addClubAdminAction} successMessage="Admin lagt til." className="flex gap-2">
              <input type="hidden" name="club_id" value={club.id} />
              <Label htmlFor="admin-email" className="sr-only">E-post</Label>
              <Input id="admin-email" name="email" type="email" placeholder="admin@klubb.no" required />
              <Button type="submit" size="sm" className="h-9">Legg til</Button>
            </ToastActionForm>
          </Section>
        </div>

        <Section
          title="Show"
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
              Ingen show tilknyttet denne klubben ennå.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Show</th>
                    <th className="px-4 py-2.5 font-medium">Dato</th>
                    <th className="px-4 py-2.5 text-right font-medium">Solgt</th>
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
            <p className="text-xs text-muted-foreground">Viser alle kommende og de åtte siste spilte showene.</p>
          )}
        </Section>

        {/* ── Faresone ─────────────────────────────────────── */}
        <Section
          title="Slett klubb"
          description="Fjerner klubben, admin-tilgangene og klubbens oppsett. En klubb med ordrer kan ikke slettes — regnskapet må bli stående."
        >
          <ConfirmActionButton
            action={deleteClubAction}
            fields={{ club_id: club.id }}
            confirmMessage={`Slette ${club.name} for godt? Dette kan ikke angres.`}
            variant="outline"
            size="sm"
            className="w-fit border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" />
            Slett {club.name}
          </ConfirmActionButton>
        </Section>
      </div>
    </div>
  )
}
