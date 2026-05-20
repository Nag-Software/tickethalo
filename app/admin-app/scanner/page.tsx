import { createAdminClient } from '@/lib/supabase/admin'
import Link from 'next/link'
import { getClubAccess } from '@/lib/club-auth'

export default async function ScannerPickShowPage() {
  const db = createAdminClient()
  const clubAccess = await getClubAccess()
  let query = db
    .from('shows')
    .select('id, title, date, venue_name, venue_address, status')
    .in('status', ['published', 'fullbooked', 'completed', 'booking'])
    .order('date', { ascending: false })
    .limit(50)

  if (clubAccess.clubIds.length === 0) {
    query = query.eq('id', '00000000-0000-0000-0000-000000000000')
  } else {
    query = query.in('club_id', clubAccess.clubIds)
  }

  const { data: shows } = await query

  const STATUS_LABEL: Record<string, string> = {
    published: 'Publisert',
    fullbooked: 'Lineup klar',
    completed: 'Gjennomført',
    booking: 'Booker',
  }
  const STATUS_COLOR: Record<string, string> = {
    published: 'bg-emerald-900 text-emerald-300',
    fullbooked: 'bg-purple-900 text-purple-300',
    completed: 'bg-zinc-700 text-zinc-300',
    booking: 'bg-amber-900 text-amber-300',
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-white p-4">
      <div className="max-w-md mx-auto pt-4">
        <div className="mb-6">
          <h1 className="text-xl font-bold">🎫 Billett-scanner</h1>
          <p className="text-sm text-zinc-400 mt-1">Velg et show for å åpne dörscanderen</p>
        </div>

        <div className="space-y-2">
          {(shows ?? []).map(show => (
            <Link
              key={show.id}
              href={`/admin-app/scanner/${show.id}`}
              className="flex items-center gap-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 px-4 py-3.5 transition-colors active:bg-zinc-600"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{show.title}</div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  {[show.date, show.venue_name ?? show.venue_address].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[show.status] ?? 'bg-zinc-700 text-zinc-300'}`}>
                {STATUS_LABEL[show.status] ?? show.status}
              </span>
            </Link>
          ))}

          {!(shows ?? []).length && (
            <div className="text-center py-16 text-zinc-600 text-sm">
              Ingen aktive shows funnet
            </div>
          )}
        </div>

        <div className="mt-8 text-center">
          <Link href="/admin-app" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
            ← Tilbake til admin
          </Link>
        </div>
      </div>
    </div>
  )
}
