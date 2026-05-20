import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { ArrowLeft, Trash2, UserPlus, UserMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addClubAdminAction, removeClubAdminAction, deleteClubAction } from '../actions'

function formatCurrency(amountMinor: number) {
  return new Intl.NumberFormat('nb-NO', {
    style: 'currency',
    currency: 'NOK',
    maximumFractionDigits: 0,
  }).format(amountMinor / 100)
}

function statusLabel(status: string) {
  switch (status) {
    case 'draft':
      return 'Planlegger'
    case 'booking':
      return 'Booking'
    case 'fullbooked':
      return 'Fullbooked'
    case 'published':
      return 'Publisert'
    case 'completed':
      return 'Gjennomført'
    case 'cancelled':
      return 'Kansellert'
    default:
      return status
  }
}

export default async function ClubDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const db = createAdminClient()

  const { data: club } = await db
    .from('clubs')
    .select('id, name, slug, city, description, created_at')
    .eq('id', id)
    .single()

  if (!club) notFound()

  const { data: memberships } = await db
    .from('club_memberships')
    .select('id, profile_id, created_at, profiles(full_name, email, role)')
    .eq('club_id', id)
    .order('created_at')

  const { data: clubShows } = await db
    .from('shows')
    .select('id, title, date, status, capacity')
    .eq('club_id', id)
    .order('date', { ascending: false })

  const shows = (clubShows ?? []).slice(0, 10)
  const showIds = (clubShows ?? []).map((show) => show.id)

  const [{ data: ticketRows }, { data: orderRows }] = await Promise.all([
    showIds.length > 0
      ? db.from('tickets').select('show_id, status').in('show_id', showIds)
      : Promise.resolve({ data: [] as Array<{ show_id: string; status: string }> }),
    showIds.length > 0
      ? db.from('orders').select('show_id, amount_total, status').in('show_id', showIds)
      : Promise.resolve({ data: [] as Array<{ show_id: string | null; amount_total: number | null; status: string }> }),
  ])

  const today = new Date().toISOString().slice(0, 10)
  const totalShows = clubShows?.length ?? 0
  const upcomingShows = (clubShows ?? []).filter((show) => show.date >= today).length
  const completedShows = (clubShows ?? []).filter((show) => show.status === 'completed').length
  const publishedShows = (clubShows ?? []).filter((show) => show.status === 'published').length
  const totalCapacity = (clubShows ?? []).reduce((sum, show) => sum + (show.capacity ?? 0), 0)
  const ticketsSold = (ticketRows ?? []).filter((ticket) => ticket.status === 'valid' || ticket.status === 'used').length
  const checkedInTickets = (ticketRows ?? []).filter((ticket) => ticket.status === 'used').length
  const paidOrders = (orderRows ?? []).filter((order) => order.status === 'paid')
  const grossRevenue = paidOrders.reduce((sum, order) => sum + (order.amount_total ?? 0), 0)
  const revenuePerShow = totalShows > 0 ? Math.round(grossRevenue / totalShows) : 0
  const fillRate = totalCapacity > 0 ? Math.round((ticketsSold / totalCapacity) * 100) : 0

  const removeWithClubId = removeClubAdminAction.bind(null)

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/superadmin/clubs">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{club.name}</h1>
            {club.city && <p className="text-xs text-muted-foreground">{club.city}</p>}
          </div>
        </div>
        <form
          action={async () => {
            'use server'
            await deleteClubAction(id)
          }}
        >
          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" type="submit">
            <Trash2 className="size-4" />
          </Button>
        </form>
      </header>

      <main className="max-w-6xl p-6 space-y-8">
        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="font-medium">Klubbanalyse</h2>
            <p className="text-sm text-muted-foreground">Oversikt over aktivitet, billettsalg og inntekt for {club.name}.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard label="Brutto inntekt" value={formatCurrency(grossRevenue)} detail={`${paidOrders.length} betalte ordre`} />
            <MetricCard label="Billetter solgt" value={String(ticketsSold)} detail={totalCapacity > 0 ? `${fillRate}% av kapasitet` : 'Ingen kapasitet satt'} />
            <MetricCard label="Shows" value={String(totalShows)} detail={`${upcomingShows} kommende · ${completedShows} gjennomført`} />
            <MetricCard label="Publiserte shows" value={String(publishedShows)} detail="Aktive ute på nettsiden" />
            <MetricCard label="Check-ins" value={String(checkedInTickets)} detail="Billetter markert som brukt" />
            <MetricCard label="Snitt per show" value={formatCurrency(revenuePerShow)} detail="Brutto delt på antall shows" />
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Statusfordeling</h3>
              <span className="text-xs text-muted-foreground">Alle shows i klubben</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {['draft', 'booking', 'fullbooked', 'published', 'completed', 'cancelled'].map((status) => {
                const count = (clubShows ?? []).filter((show) => show.status === status).length
                return (
                  <div key={status} className="rounded-full border bg-background px-3 py-1.5 text-xs">
                    <span className="font-medium">{statusLabel(status)}</span>
                    <span className="ml-2 text-muted-foreground">{count}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* Add admin */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <UserPlus className="size-4 text-muted-foreground" />
            <h2 className="font-medium">Legg til admin</h2>
          </div>
          <form action={addClubAdminAction} className="flex gap-2">
            <input type="hidden" name="club_id" value={club.id} />
            <div className="flex-1 space-y-1">
              <Label htmlFor="email" className="sr-only">E-post</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="admin@klubb.no"
                required
              />
            </div>
            <Button type="submit" size="sm">Legg til</Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Brukeren må allerede ha registrert seg. Rollen settes automatisk til admin.
          </p>
        </section>

        {/* Current admins */}
        <section className="space-y-3">
          <h2 className="font-medium">Admins ({memberships?.length ?? 0})</h2>
          {!memberships || memberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen admins ennå.</p>
          ) : (
            <ul className="space-y-2">
              {memberships.map((m) => {
                const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
                return (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{profile?.full_name ?? profile?.email}</p>
                      {profile?.full_name && (
                        <p className="text-xs text-muted-foreground">{profile.email}</p>
                      )}
                    </div>
                    <form
                      action={async () => {
                        'use server'
                        await removeWithClubId(m.id, id)
                      }}
                    >
                      <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" type="submit">
                        <UserMinus className="size-3.5" />
                      </Button>
                    </form>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Recent shows */}
        <section className="space-y-3">
          <h2 className="font-medium">Siste shows</h2>
          {!shows || shows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen shows tilknyttet denne klubben ennå.</p>
          ) : (
            <ul className="space-y-1.5">
              {shows.map((show) => (
                <li key={show.id} className="flex items-center justify-between text-sm rounded border bg-card px-3 py-2">
                  <span>{show.title}</span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{new Date(show.date).toLocaleDateString('nb-NO')}</span>
                    <span>{statusLabel(show.status)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  )
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}
