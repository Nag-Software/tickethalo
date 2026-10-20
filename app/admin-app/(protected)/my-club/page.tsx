import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { AdminHeader } from '@/components/admin/admin-header'
import { ClubProfileForm } from '@/components/admin/club-profile-form'
import { ComedianProfileLink, type LinkedComedian } from '@/components/admin/comedian-profile-link'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { appUrl } from '@/lib/app-url'
import { loadBookingSettings } from '@/lib/booking-settings-store'
import { isClubRole } from '@/lib/portal-auth'
import { getAuthUser, getSessionProfile } from '@/lib/session'

export default async function MyClubPage() {
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()

  const [{ data: club, error: clubError }, { data: locations }, settings, comedianCard] = await Promise.all([
    db
      .from('clubs')
      .select('id, name, slug, description, logo_url, city, currency, lineup_deadline_days')
      .eq('id', clubId)
      .single(),
    db
      .from('club_locations')
      .select('id, name, address_line')
      .eq('club_id', clubId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    loadBookingSettings(db),
    loadComedianCard(),
  ])

  if (clubError || !club) {
    throw new Error('Club profile not found.')
  }

  const origin = appUrl()

  return (
    <div>
      <AdminHeader
        title="My club"
        description="What the audience sees on the club page."
        actions={
          <Link
            href={`/clubs/${club.slug}`}
            target="_blank"
            className="inline-flex items-center text-[var(--ev-text)] gap-1 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
          >
            View club page
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        }
      />

      <div className="max-w-4xl mx-auto px-6 py-10 md:py-12">
        <ClubProfileForm
          club={club}
          locations={locations ?? []}
          clubUrl={`${origin}/clubs/${club.slug}`}
          defaultLineupDeadlineDays={settings.lineup_deadline_days}
        />
        {comedianCard.show ? (
          <div className="mt-8">
            <ComedianProfileLink comedian={comedianCard.comedian} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Komikerkortet gjelder innloggingen som ser på siden, ikke klubben.
 * Superadmin ser det ikke: superadmin holdes utenfor komikerportalen.
 */
async function loadComedianCard(): Promise<{ show: boolean; comedian: LinkedComedian | null }> {
  const user = await getAuthUser()
  if (!user) return { show: false, comedian: null }
  const profile = await getSessionProfile(user.id)
  if (!isClubRole(profile?.role)) return { show: false, comedian: null }

  const db = createAdminClient()
  const { data: artist } = await db
    .from('artists')
    .select('full_name, stage_name, email, linked_from_auth_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (!artist) return { show: true, comedian: null }

  let ownLoginEmail: string | null = null
  if (artist.linked_from_auth_user_id) {
    const { data } = await db.auth.admin.getUserById(artist.linked_from_auth_user_id)
    ownLoginEmail = data?.user?.email ?? null
  }

  return {
    show: true,
    comedian: { name: artist.stage_name ?? artist.full_name, email: artist.email, ownLoginEmail },
  }
}
