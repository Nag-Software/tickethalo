import { redirect } from 'next/navigation'
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

  return <>{children}</>
}
