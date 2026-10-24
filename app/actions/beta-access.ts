'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { isValidEmail } from '@/lib/email-address'

export type BetaRequestResult = { error: string } | { ok: true }

/**
 * «Request beta access» from the comedy club portal. Clubs cannot sign up on
 * their own during the beta, so this is the queue superadmin works through in
 * /superadmin/beta-requests.
 */
export async function requestClubBetaAccessAction(formData: FormData): Promise<BetaRequestResult> {
  const clubName = String(formData.get('club_name') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim().toLowerCase()
  const source = String(formData.get('source') ?? '').trim() || null

  // Returned, not thrown: Next redacts thrown server action messages in
  // production, which would leave the user with a generic failure message.
  if (!clubName) return { error: 'Enter the name of your club.' }
  if (clubName.length > 120) return { error: 'That club name is too long.' }
  // Lengden først: isValidEmail avviser også for lange adresser, og da skal de få riktig grunn.
  if (email.length > 254) return { error: 'That email address is too long.' }
  if (!isValidEmail(email)) return { error: 'Enter a valid email address.' }

  const db = createAdminClient()
  // Same club asking twice is one request, not two — the latest name and
  // source win, and the status superadmin has already set stays untouched.
  const { error } = await db
    .from('club_beta_requests')
    .upsert(
      { club_name: clubName, email, source, updated_at: new Date().toISOString() },
      { onConflict: 'email' },
    )

  if (error) {
    console.error('club_beta_requests upsert failed', error)
    return { error: 'We could not register your request right now. Please try again.' }
  }

  return { ok: true }
}
