import { redirect } from 'next/navigation'
import { SuperadminSidebar } from '@/components/superadmin/superadmin-sidebar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'
import { getAuthUser, getSessionProfile } from '@/lib/session'

export default async function SuperadminProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthUser()

  if (!user) {
    redirect('/superadmin/login')
  }

  const destination = await getPortalDestinationForAuthUser(user.id)
  if (destination && destination !== '/superadmin') {
    redirect(destination)
  }

  const profile = await getSessionProfile(user.id)

  if (!profile || profile.role !== 'superadmin') {
    redirect('/superadmin/login?error=unauthorized')
  }

  // Tallene i menyen er det som venter på noen. De hentes her og ikke på hver
  // side, så en søknad som kommer inn synes uansett hvor i superadmin du står.
  const db = createAdminClient()
  const [{ count: newBetaRequests }, { count: artistsToReview }] = await Promise.all([
    db.from('club_beta_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    db.from('artists').select('id', { count: 'exact', head: true }).in('status', ['pending_review', 'flagged']),
  ])

  return (
    <div lang="nb" className="admin-app-shell">
      <SidebarProvider>
        <SuperadminSidebar
          email={profile.email ?? user.email ?? ''}
          badges={{ beta: newBetaRequests ?? 0, artists: artistsToReview ?? 0 }}
        />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </div>
  )
}
