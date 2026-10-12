'use server'

import { revalidatePath } from 'next/cache'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Legger oppstartsguiden bort for klubben som er valgt. Klubben kommer fra
 * innloggingen, aldri fra skjemaet — ellers kunne hvem som helst skjult
 * guiden for en annen klubb.
 */
export async function dismissSetupGuideAction(): Promise<{ error: string } | undefined> {
  try {
    const clubId = await getDefaultClubIdForAdmin()
    const { error } = await createAdminClient()
      .from('clubs')
      .update({ setup_guide_dismissed_at: new Date().toISOString() })
      .eq('id', clubId)
    if (error) return { error: 'Could not hide the guide. Try again in a moment.' }
    revalidatePath('/admin-app', 'layout')
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not hide the guide.' }
  }
}
