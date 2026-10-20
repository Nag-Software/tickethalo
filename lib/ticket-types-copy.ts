import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Kopierer billettypene fra et show til et annet: navn, pris, rabatt, antall,
 * kode og salgsperiode. Egne datoer (custom) kopieres ikke — de hører til
 * det gamle showet — og typen får i stedet standarden, til showet starter.
 */
export async function copyTicketTypes(fromShowId: string, toShowId: string): Promise<number> {
  const admin = createAdminClient()
  const { data: types, error } = await admin
    .from('show_ticket_types')
    .select('name, price, discount_bps, quantity, promo_code, sales_end_mode, sales_end_days, position')
    .eq('show_id', fromShowId)
    .is('archived_at', null)
    .order('position')
  if (error) throw new Error(error.message)
  if (!types || types.length === 0) return 0

  const { error: insertError } = await admin.from('show_ticket_types').insert(
    types.map((type) => ({
      ...type,
      show_id: toShowId,
      sales_end_mode: type.sales_end_mode === 'custom' ? 'event_start' : type.sales_end_mode,
    })),
  )
  if (insertError) throw new Error(`The event was created, but its ticket types could not be copied: ${insertError.message}`)
  return types.length
}
