'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { resetClubInviteToken } from '@/lib/club-invite'

/**
 * Bytter klubbens invitasjonslenke. Klubben leses av innloggingen, aldri av
 * skjemaet — ellers kunne hvem som helst ha slått av en annen klubbs lenke.
 */
export async function resetInviteLinkAction(): Promise<{ error?: string } | void> {
  try {
    const clubId = await getDefaultClubIdForAdmin()
    await resetClubInviteToken(createAdminClient(), clubId)
    revalidatePath('/admin-app/artists')
  } catch (error) {
    console.error('[Invite] Could not reset link:', error)
    return { error: 'Could not reset the link right now. Try again in a moment.' }
  }
}
