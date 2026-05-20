import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestPathname } from '@/lib/request-pathname'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'

export const metadata = { title: 'Superadmin — humor.events' }

export default async function SuperadminLayout({ children }: { children: React.ReactNode }) {
  const pathname = await getRequestPathname()

  if (pathname.startsWith('/superadmin/login')) {
    return children
  }

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
