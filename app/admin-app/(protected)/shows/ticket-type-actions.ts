'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertShowAccess } from '@/lib/club-auth'
import { type AdminTicketType, type TicketTypeFormValues, fromFormValues } from '@/lib/admin-ticket-types'
import { ticketTypeError } from '@/lib/ticket-types'

type SaveResult = { error: string } | { type: AdminTicketType }
type RemoveResult = { error: string } | { removed: 'deleted' | 'archived' }

const ADMIN_TYPE_COLUMNS =
  'id, name, price, discount_bps, quantity, promo_code, sales_end_mode, sales_end_days, sales_end_at, position' as const

/**
 * Lagrer én billettype: ny når `typeId` mangler. Editoren lagrer automatisk,
 * så svaret er raden slik den ble stående — eller en feil bookeren kan rette.
 */
export async function saveTicketTypeAction(
  showId: string,
  typeId: string | null,
  values: TicketTypeFormValues,
): Promise<SaveResult> {
  await assertShowAccess(showId)
  const db = createAdminClient()

  const { data: show, error: showError } = await db
    .from('shows')
    .select('id, date, start_time, end_time, currency')
    .eq('id', showId)
    .maybeSingle()
  if (showError) throw new Error(showError.message)
  if (!show) return { error: 'This show no longer exists.' }

  const input = fromFormValues(values)
  const problem = ticketTypeError(input, { currency: show.currency, show })
  if (problem) return { error: problem }

  const sold = typeId ? await soldCount(typeId) : 0
  // Billettene som er solgt, er solgt. Antallet kan ikke settes under dem.
  if (input.quantity !== null && input.quantity < sold) {
    return { error: `${sold} tickets of this type are already sold, so the amount can't be lower than that.` }
  }

  const row = {
    name: input.name,
    price: input.price as number,
    discount_bps: input.discount_bps,
    quantity: input.quantity,
    promo_code: input.promo_code,
    sales_end_mode: input.sales_end_mode,
    sales_end_days: input.sales_end_days,
    sales_end_at: input.sales_end_at,
  }

  if (typeId) {
    const { data: current } = await db
      .from('show_ticket_types')
      .select('name')
      .eq('id', typeId)
      .eq('show_id', showId)
      .is('archived_at', null)
      .maybeSingle()
    if (!current) return { error: 'This ticket type no longer exists. Reload the page.' }

    const { data, error } = await db
      .from('show_ticket_types')
      .update({
        ...row,
        // Navnet står på betalingssiden («Show · Type»). Et nytt navn gir et
        // nytt Stripe-produkt ved neste kjøp; prisen settes uansett per kjøp.
        ...(current.name !== input.name ? { stripe_product_id: null } : {}),
      })
      .eq('id', typeId)
      .eq('show_id', showId)
      .select(ADMIN_TYPE_COLUMNS)
      .single()
    if (error) throw new Error(error.message)

    revalidatePath(`/admin-app/shows/${showId}`)
    return { type: { ...(data as Omit<AdminTicketType, 'sold'>), sold } }
  }

  const { data: last } = await db
    .from('show_ticket_types')
    .select('position')
    .eq('show_id', showId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data, error } = await db
    .from('show_ticket_types')
    .insert({ ...row, show_id: showId, position: (last?.position ?? -1) + 1 })
    .select(ADMIN_TYPE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)

  revalidatePath(`/admin-app/shows/${showId}`)
  return { type: { ...(data as Omit<AdminTicketType, 'sold'>), sold: 0 } }
}

/**
 * Fjerner en billettype. Uten salg slettes den; med salg arkiveres den —
 * billettene og ordrelinjene peker på den, og den skal fortsatt stå på dem.
 * Et publisert show beholder minst én type: uten er det ingenting å selge.
 */
export async function removeTicketTypeAction(showId: string, typeId: string): Promise<RemoveResult> {
  await assertShowAccess(showId)
  const db = createAdminClient()

  const [{ data: show }, { data: types }] = await Promise.all([
    db.from('shows').select('status').eq('id', showId).maybeSingle(),
    db.from('show_ticket_types').select('id').eq('show_id', showId).is('archived_at', null),
  ])
  if (!(types ?? []).some((type) => type.id === typeId)) return { error: 'This ticket type no longer exists. Reload the page.' }
  if (show?.status === 'published' && (types ?? []).length <= 1) {
    return { error: 'A published show needs at least one ticket type. Add another one first.' }
  }

  const { count } = await db.from('tickets').select('id', { count: 'exact', head: true }).eq('ticket_type_id', typeId)

  if ((count ?? 0) > 0) {
    const { error } = await db
      .from('show_ticket_types')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', typeId)
      .eq('show_id', showId)
    if (error) throw new Error(error.message)
    revalidatePath(`/admin-app/shows/${showId}`)
    return { removed: 'archived' }
  }

  // En ordre uten billetter (kansellert, refundert) kan fortsatt ha en linje
  // som peker hit. Den beholder navnet sitt (`type_name`); lenken blir null.
  const { error } = await db.from('show_ticket_types').delete().eq('id', typeId).eq('show_id', showId)
  if (error) throw new Error(error.message)
  revalidatePath(`/admin-app/shows/${showId}`)
  return { removed: 'deleted' }
}

async function soldCount(typeId: string) {
  const { count } = await createAdminClient()
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('ticket_type_id', typeId)
    .in('status', ['valid', 'used'])
  return count ?? 0
}
