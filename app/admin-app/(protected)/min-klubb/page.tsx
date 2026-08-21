import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { AdminHeader } from '@/components/admin/admin-header'
import { ClubProfileForm } from '@/components/admin/club-profile-form'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function MinKlubbPage() {
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()

  const [{ data: club, error: clubError }, { data: locations }] = await Promise.all([
    db
      .from('clubs')
      .select('id, name, slug, description, logo_url, city, currency')
      .eq('id', clubId)
      .single(),
    db
      .from('club_locations')
      .select('id, name, address_line')
      .eq('club_id', clubId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (clubError || !club) {
    throw new Error('Fant ikke klubbprofilen.')
  }

  // Samme rekkefølge som resten av appen bruker når den bygger absolutte
  // lenker (se lib/actions/booking.ts).
  const origin = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')

  return (
    <div>
      <AdminHeader
        title="Min klubb"
        description="Det publikum ser på klubbsiden."
        actions={
          <Link
            href={`/clubs/${club.slug}`}
            target="_blank"
            className="inline-flex items-center text-[var(--ev-text)] gap-1 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Se klubbsiden
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        }
      />

      <div className="max-w-xl px-6 py-10 md:py-12">
        <ClubProfileForm club={club} locations={locations ?? []} clubUrl={`${origin}/clubs/${club.slug}`} />
      </div>
    </div>
  )
}
