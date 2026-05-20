import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { getRequestPathname } from '@/lib/request-pathname'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'
import { getClubAccess } from '@/lib/club-auth'

export const metadata = { title: 'Booking-center — humor.events' }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = await getRequestPathname()
  const adminPrefix = '/admin-app'

  if (pathname.startsWith('/admin-app/login')) {
    return children
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect(`${adminPrefix}/login`)
  }

  const destination = await getPortalDestinationForAuthUser(user.id)
  if (destination && destination !== adminPrefix && destination !== '/superadmin') {
    redirect(destination)
  }

  const db = createAdminClient()
  const { data: profile } = await db
    .from('profiles')
    .select('id, role, full_name, email')
    .eq('auth_user_id', user.id)
    .single()

  const allowed: string[] = ['superadmin', 'owner', 'admin', 'staff']
  if (!profile || !allowed.includes(profile.role)) {
    redirect(`${adminPrefix}/login?error=unauthorized`)
  }

  const clubAccess = await getClubAccess()
  const selectedClub = clubAccess.clubs.find((club) => club.id === clubAccess.selectedClubId) ?? null

  const sidebarUser = {
    email: profile.email ?? user.email ?? 'admin@humor.events',
    name: profile.full_name ?? profile.email ?? user.email ?? 'Admin',
    role: profile.role ?? 'admin',
    clubName: selectedClub?.name ?? null,
  }

  if (pathname.startsWith('/admin-app/scanner')) {
    return <div className="admin-app-shell">{children}</div>
  }

  return (
    <div className="admin-app-shell">
      <SidebarProvider>
        <AdminSidebar
          user={sidebarUser}
          clubs={clubAccess.clubs}
          selectedClubId={clubAccess.selectedClubId}
          showClubSwitcher={profile.role === 'superadmin'}
        />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </div>
  )
}
