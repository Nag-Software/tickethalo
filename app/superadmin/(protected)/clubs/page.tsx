import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { Building2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isClubPayoutReady } from '@/lib/stripe-connect'

export const metadata = { title: 'Klubber — Superadmin' }


export default async function ClubsPage() {
  const db = createAdminClient()

  const { data: clubs } = await db
    .from('clubs')
    .select('id, name, slug, city, created_at, stripe_account_id, charges_enabled, payouts_enabled, legal_name, org_number')
    .order('name')

  const clubIds = (clubs ?? []).map((c) => c.id)
  const { data: membershipCounts } = clubIds.length
    ? await db
        .from('club_memberships')
        .select('club_id')
        .in('club_id', clubIds)
    : { data: [] }

  const { data: showCounts } = clubIds.length
    ? await db
        .from('shows')
        .select('club_id')
        .in('club_id', clubIds)
    : { data: [] }

  const memberMap = new Map<string, number>()
  const showMap = new Map<string, number>()
  for (const m of membershipCounts ?? []) {
    memberMap.set(m.club_id, (memberMap.get(m.club_id) ?? 0) + 1)
  }
  for (const s of showCounts ?? []) {
    if (s.club_id) showMap.set(s.club_id, (showMap.get(s.club_id) ?? 0) + 1)
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Klubber</h1>
          <span className="text-sm text-muted-foreground">Tickethalo superadmin</span>
        </div>
        <div className="flex items-center gap-3">
          <form action="/superadmin/logout" method="post">
            <button type="submit" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Logg ut
            </button>
          </form>
          <Button asChild size="sm">
            <Link href="/superadmin/clubs/new">
              <Plus className="size-4" />
              Ny klubb
            </Link>
          </Button>
        </div>
      </header>

      <main className="p-6">
        {(!clubs || clubs.length === 0) ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground">
            <Building2 className="size-10 opacity-30" />
            <p className="text-sm">Ingen klubber ennå.</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/superadmin/clubs/new">Opprett første klubb</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {clubs.map((club) => {
              const ready = isClubPayoutReady(club)
              const hasAccount = Boolean(club.stripe_account_id)

              return (
              <Link
                key={club.id}
                href={`/superadmin/clubs/${club.id}`}
                className="block rounded-lg border bg-card p-5 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-medium">{club.name}</span>
                  {club.city && (
                    <span className="text-xs text-muted-foreground shrink-0">{club.city}</span>
                  )}
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground mt-2">
                  <span>{memberMap.get(club.id) ?? 0} admin{(memberMap.get(club.id) ?? 0) !== 1 ? 's' : ''}</span>
                  <span>{showMap.get(club.id) ?? 0} show{(showMap.get(club.id) ?? 0) !== 1 ? 's' : ''}</span>
                </div>
                {/* En klubb uten ferdig Connect-konto kan ikke selge billetter
                    — showene blir liggende upublisert. Det bør ses herfra. */}
                <div className="mt-3">
                  {ready ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      Klar for salg
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      {hasAccount ? 'Oppsett ikke fullført' : 'Ingen Stripe-konto'}
                    </span>
                  )}
                </div>
              </Link>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
