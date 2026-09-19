'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import type { ArtistStatus } from '@/types/database'

/**
 * Statusene superadmin kan sette. `pending_review` og `flagged` er med vilje
 * ikke her: komikere godkjennes automatisk, og flagging er klubbens egen sak
 * (migrasjon 043). Dette er nødbremsen, ikke en godkjenningskø.
 */
const SETTABLE: ArtistStatus[] = ['approved', 'inactive', 'rejected']

export type ArtistStatusResult = { ok: true } | { error: string }

/**
 * Moderering — tar en komiker ut av plattformen, eller slipper hen inn igjen.
 *
 * `inactive` og `rejected` fjerner komikeren fra egen portal og fra bookingen
 * hos alle klubber samtidig. Derfor ligger dette under superadmin og ikke på
 * klubbens komikerprofil, der det sto før.
 */
export async function setArtistStatusAction(formData: FormData): Promise<ArtistStatusResult> {
  try {
    await assertSuperadmin()

    const artistId = String(formData.get('artist_id') ?? '')
    const status = String(formData.get('status') ?? '') as ArtistStatus
    if (!artistId) return { error: 'Mangler komiker.' }
    if (!SETTABLE.includes(status)) return { error: 'Ugyldig status.' }

    const { error } = await createAdminClient().from('artists').update({ status }).eq('id', artistId)
    if (error) return { error: 'Kunne ikke oppdatere statusen.' }

    revalidatePath('/superadmin/artists')
    revalidatePath('/superadmin/overview')
    revalidatePath(`/admin-app/artists/${artistId}`)
    revalidatePath('/admin-app/artists')
    return { ok: true }
  } catch (error) {
    return { error: error instanceof Error && error.message ? error.message : 'Noe gikk galt.' }
  }
}
