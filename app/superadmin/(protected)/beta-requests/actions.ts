'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import type { ClubBetaRequestStatus } from '@/types/database'

const STATUSES: ClubBetaRequestStatus[] = ['new', 'contacted', 'approved', 'declined']

// ─────────────────────────────────────────────────────────────
// Sett status på en betasøknad
// ─────────────────────────────────────────────────────────────
export async function setBetaRequestStatusAction(formData: FormData) {
  await assertSuperadmin()
  const id = formData.get('id') as string
  const status = formData.get('status') as ClubBetaRequestStatus

  if (!id) throw new Error('Missing request.')
  // Statusen kommer fra en knapp i skjemaet, men check-constrainten i databasen
  // avviser bare med en rå Postgres-feil — vi stopper den her i stedet.
  if (!STATUSES.includes(status)) throw new Error('Invalid status.')

  const db = createAdminClient()
  const { error } = await db
    .from('club_beta_requests')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error('Could not update the request.')

  revalidatePath('/superadmin/beta-requests')
  revalidatePath('/superadmin', 'layout')
}

// ─────────────────────────────────────────────────────────────
// Slett en betasøknad
// ─────────────────────────────────────────────────────────────
export async function deleteBetaRequestAction(formData: FormData) {
  await assertSuperadmin()
  const id = formData.get('id') as string
  if (!id) throw new Error('Missing request.')

  const db = createAdminClient()
  await db.from('club_beta_requests').delete().eq('id', id)

  revalidatePath('/superadmin/beta-requests')
  revalidatePath('/superadmin', 'layout')
}
