import { redirect } from 'next/navigation'
import { AdminSidebar } from '@/components/admin/admin-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { getRequestPathname } from '@/lib/request-pathname'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'
import { getClubAccess } from '@/lib/club-auth'
import { getAuthUser, getSessionProfile } from '@/lib/session'

export default async function AdminProtectedLayout({ children }: { children: React.ReactNode }) {
  const pathname = await getRequestPathname()
  const adminPrefix = '/admin-app'

  const user = await getAuthUser()

  if (!user) {
    redirect(`${adminPrefix}/login`)
  }

  // Profilen, portalvalget og klubbtilgangen deler ett oppslag: alle tre går
  // gjennom de request-cachede funksjonene i `lib/session`.
  const profile = await getSessionProfile(user.id)

  const destination = await getPortalDestinationForAuthUser(user.id)
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
    email: profile.email ?? user.email ?? 'admin@tickethalo.com',
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
          showClubSwitcher={profile.role === 'superadmin'}
        />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </div>
  )
}
