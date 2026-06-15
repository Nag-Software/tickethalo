import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getSupabaseUrl } from '@/lib/supabase/env'

let _adminClient: SupabaseClient<Database> | null = null

/**
 * Service-role client — bypasses RLS. Lazy singleton (stateless: no session, no token refresh).
 * Must only be used in server-side code (API routes, server actions, webhooks).
 */
export function createAdminClient(): SupabaseClient<Database> {
  if (!_adminClient) {
    _adminClient = createClient<Database>(
      getSupabaseUrl(),
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )
  }
  return _adminClient
}
