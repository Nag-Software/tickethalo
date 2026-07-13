import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { getRequestPathname } from '@/lib/request-pathname'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'
import { getAuthUser, getAdminProfile, getClubAccess } from '@/lib/club-auth'

export const metadata = { title: 'Booking-center — humor.events' }

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = await getRequestPathname()
  const adminPrefix = '/admin-app'

  if (pathname.startsWith('/admin-app/login')) {
    return children
  }

  // Cached helpers (React cache()) — layout and page share the same auth user,
  // profile and club queries within one request render.
  const user = await getAuthUser()

  if (!user) {
    redirect(`${adminPrefix}/login`)
  }

  const profile = await getAdminProfile()

  // Query-free for admin roles since the profile role is already known.
  const destination = await getPortalDestinationForAuthUser(user.id, profile?.role ?? null)
  if (destination && destination !== adminPrefix && destination !== '/superadmin') {
    redirect(destination)
  }

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
    clubLogoUrl: selectedClub?.logo_url ?? null,
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
          showClubSwitcher={profile.role === 'superadmin' || clubAccess.clubs.length > 1}
        />
        <SidebarInset className="max-w-[2000px]">{children}</SidebarInset>
      </SidebarProvider>
    </div>
  )
}
