import { AdminHeader } from '@/components/admin/admin-header'
import { ArtistPrioritizationTable } from '@/components/admin/artist-prioritization-table'
import { ClubBookingSettingsForm } from '@/components/admin/club-booking-settings-form'
import { getClubBookingSettingsForAdmin } from '@/app/admin-app/booking-innstillinger/actions'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { loadClubBookingStats } from '@/lib/club-booking-settings'
import { loadClubArtistPriorities, parsePriorityRoleParam } from '@/lib/club-booking-priorities'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function MinKlubbBookingalgoritmePage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>
}) {
  const params = await searchParams
  const clubId = await getDefaultClubIdForAdmin()
  const admin = createAdminClient()
  const settings = await getClubBookingSettingsForAdmin(clubId)
  const roleName = parsePriorityRoleParam(params.role)

  const [{ totalClubEvents }, priorities] = await Promise.all([
    loadClubBookingStats(admin, clubId, settings),
    loadClubArtistPriorities(admin, clubId, settings, roleName),
  ])

  return (
    <div>
      <AdminHeader title="Bookingalgoritme" description="Autobooking og prioritering for denne klubben." />
      <div className="space-y-12 p-6">
        <ClubBookingSettingsForm settings={settings} totalClubEvents={totalClubEvents} />
        <ArtistPrioritizationTable priorities={priorities} />
      </div>
    </div>
  )
}
