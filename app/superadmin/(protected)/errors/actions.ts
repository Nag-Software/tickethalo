'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { getAuthUser } from '@/lib/session'

/** Kvitterer ut én feil. Raden blir stående, bare merket som sett. */
export async function resolveErrorAction(formData: FormData) {
  await assertSuperadmin()
  const id = String(formData.get('error_id') ?? '')
  if (!id) return { error: 'Mangler feil.' }

  const user = await getAuthUser()
  const { error } = await createAdminClient()
    .from('app_errors')
    .update({ resolved_at: new Date().toISOString(), resolved_by: user?.id ?? null })
    .eq('id', id)
    .is('resolved_at', null)

  if (error) return { error: 'Kunne ikke kvittere ut feilen.' }
  revalidatePath('/superadmin/errors')
  revalidatePath('/superadmin', 'layout')
}

/** Kvitterer ut alt som venter. Til etter at en kjent feil er rettet. */
export async function resolveAllErrorsAction() {
  await assertSuperadmin()
  const user = await getAuthUser()
  const { error } = await createAdminClient()
    .from('app_errors')
    .update({ resolved_at: new Date().toISOString(), resolved_by: user?.id ?? null })
    .is('resolved_at', null)

  if (error) return { error: 'Kunne ikke kvittere ut feilene.' }
  revalidatePath('/superadmin/errors')
  revalidatePath('/superadmin', 'layout')
}
