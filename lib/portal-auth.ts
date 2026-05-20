import { createAdminClient } from '@/lib/supabase/admin'

export async function getPortalDestinationForAuthUser(authUserId: string): Promise<string | null> {
  const db = createAdminClient()

  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (profile?.role === 'superadmin') return '/superadmin'
  if (profile?.role === 'owner' || profile?.role === 'admin' || profile?.role === 'staff') return '/admin-app'

  const { data: artist } = await db
    .from('artists')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (artist) return '/artist-app'
  if (profile?.role === 'artist') return '/artist-app/signup?error=missing'

  return null
}