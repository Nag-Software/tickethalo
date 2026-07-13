import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Resolves which portal an authenticated user belongs to.
 * Pass `knownRole` (the profile role, or null when the user has no profile)
 * when the caller already has the profile loaded — the admin-role happy path
 * then costs zero extra queries. Leave it undefined to look the role up here.
 */
export async function getPortalDestinationForAuthUser(
  authUserId: string,
  knownRole?: string | null,
): Promise<string | null> {
  const db = createAdminClient()

  let role: string | null
  if (knownRole !== undefined) {
    role = knownRole
  } else {
    const { data: profile } = await db
      .from('profiles')
      .select('role')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
    role = profile?.role ?? null
  }

  if (role === 'superadmin') return '/superadmin'
  if (role === 'owner' || role === 'admin' || role === 'staff') return '/admin-app'

  const { data: artist } = await db
    .from('artists')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (artist) return '/artist-app'
  if (role === 'artist') return '/artist-app/signup?error=missing'

  return null
}
