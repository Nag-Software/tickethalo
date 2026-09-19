import Link from 'next/link'
import { Building2, ChevronRight, Plus, Search } from 'lucide-react'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ClubReadinessPill, EmptyState } from '@/components/superadmin/ui'
import { describeClubReadiness } from '@/lib/stripe-connect'
import { getOsloToday } from '@/lib/event-filters'

export const metadata = { title: 'Klubber — Superadmin' }

export default async function ClubsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = ((await searchParams).q ?? '').trim()
  const db = createAdminClient()
  const today = getOsloToday()

  // Arkiverte show (slettet av bookeren, men med salgshistorikk) telles ikke —
  // for klubben finnes de ikke lenger.
  const [{ data: clubs }, { data: memberships }, { data: shows }] = await Promise.all([
    db.from('clubs')
      .select('id, name, slug, city, created_at, stripe_account_id, charges_enabled, payouts_enabled, payout_schedule_interval, legal_name, org_number, support_email')
      .order('name'),
    db.from('club_memberships').select('club_id'),
    db.from('shows').select('club_id, date').is('deleted_at', null).eq('is_template', false),
  ])

  const admins = new Map<string, number>()
  for (const membership of memberships ?? []) admins.set(membership.club_id, (admins.get(membership.club_id) ?? 0) + 1)

  const showCounts = new Map<string, { total: number; upcoming: number }>()
  for (const show of shows ?? []) {
    if (!show.club_id) continue
    const entry = showCounts.get(show.club_id) ?? { total: 0, upcoming: 0 }
    entry.total += 1
    if (show.date >= today) entry.upcoming += 1
    showCounts.set(show.club_id, entry)
  }

  const needle = query.toLowerCase()
  const all = clubs ?? []
  const visible = needle
    ? all.filter((club) => [club.name, club.city, club.slug].some((value) => value?.toLowerCase().includes(needle)))
    : all
  const readyCount = all.filter((club) => describeClubReadiness(club).every((item) => item.done)).length

  return (
    <div>
      <AdminHeader
        title="Klubber"
        description={`${all.length} klubber · ${readyCount} klare for salg`}
        actions={
          <Button asChild size="sm">
            <Link href="/superadmin/clubs/new">
              <Plus className="size-4" />
              Ny klubb
            </Link>
          </Button>
        }
      />

      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
        {all.length === 0 ? (
          <EmptyState icon={Building2}>
            <p>Ingen klubber ennå.</p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/superadmin/clubs/new">Opprett første klubb</Link>
            </Button>
          </EmptyState>
        ) : (
          <>
            <form method="get" className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={query} placeholder="Søk på klubb eller by" className="pl-9" />
            </form>

            {visible.length === 0 ? (
              <EmptyState icon={Building2}>Ingen klubber passer søket.</EmptyState>
            ) : (
              <div className="overflow-x-auto rounded-xl border bg-card">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
                      <th className="px-4 py-2.5 font-medium">Klubb</th>
                      <th className="px-4 py-2.5 text-right font-medium">Admins</th>
                      <th className="px-4 py-2.5 text-right font-medium">Show</th>
                      <th className="px-4 py-2.5 text-right font-medium">Kommende</th>
                      {/* En klubb uten ferdig Connect-konto kan ikke selge billetter
                          — showene blir liggende upublisert. Det bør ses herfra. */}
                      <th className="px-4 py-2.5 font-medium">Billettsalg</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((club) => {
                      const missing = describeClubReadiness(club).filter((item) => !item.done)
                      const adminCount = admins.get(club.id) ?? 0
                      const counts = showCounts.get(club.id) ?? { total: 0, upcoming: 0 }
                      const href = `/superadmin/clubs/${club.id}`

                      return (
                        <tr key={club.id} className="border-b transition-colors last:border-0 hover:bg-accent/50">
                          <td className="px-4 py-3">
                            <Link href={href} className="font-medium hover:underline">
                              {club.name}
                            </Link>
                            {club.city && <span className="ml-2 text-muted-foreground">{club.city}</span>}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums ${adminCount === 0 ? 'font-medium text-amber-700' : ''}`}>
                            {adminCount}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{counts.total}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{counts.upcoming}</td>
                          <td className="px-4 py-3">
                            <ClubReadinessPill hasAccount={Boolean(club.stripe_account_id)} missing={missing} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link href={href} aria-label={`Åpne ${club.name}`} className="inline-flex text-muted-foreground hover:text-foreground">
                              <ChevronRight className="size-4" />
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
