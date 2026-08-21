import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'

export default async function SuperadminProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/superadmin/login')
  }

  const destination = await getPortalDestinationForAuthUser(user.id)
  if (destination && destination !== '/superadmin') {
    redirect(destination)
  }

  const db = createAdminClient()
  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()

  if (!profile || profile.role !== 'superadmin') {
    redirect('/superadmin/login?error=unauthorized')
  }

  return <>{children}</>
}
