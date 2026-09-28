'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { assertShowAccess, getClubAccess } from '@/lib/club-auth'
import { ticketCodeCandidates } from '@/lib/tickets'

export type CheckInResult =
  | { notFound: true }
  /** Ekte billett, men til et annet av klubbens show. */
  | { wrongShow: true; showTitle: string; showDate: string; holderName: string | null }
  | { alreadyUsed: true; checkedInAt: string | null; holderName: string | null }
  | { invalid: true; status: string }
  | {
    ok: true
    ticketId: string
    ticketCode: string
    /** Navnet billetten gjelder — det som skal sies høyt i døra. */
    holderName: string | null
    buyerName: string | null
    buyerEmail: string | null
  }

/**
 * Sjekker inn én billett.
 *
 * Innsjekkingen er én betinget oppdatering, ikke les-så-skriv: to telefoner
 * som skanner samme billett i samme sekund ville begge sett `valid` og begge
 * sluppet folk inn. Her er det bare den som faktisk endret raden fra `valid`
 * som får «ok» — den andre får «allerede brukt».
 */
export async function checkInByCode(showId: string, rawCode: string): Promise<CheckInResult> {
  await assertShowAccess(showId)
  const candidates = ticketCodeCandidates(rawCode)
  if (candidates.length === 0) return { notFound: true }

  const db = createAdminClient()

  // Eksakt match mot små/store varianter av koden — se `ticketCodeCandidates`
  // for hvorfor det ikke er et `ilike`.
  const { data: ticket } = await db
    .from('tickets')
    .select('id, ticket_code, status, checked_in_at, order_id, show_id, holder_name')
    .eq('show_id', showId)
    .in('ticket_code', candidates)
    .maybeSingle()

  if (!ticket) return wrongShowOrNotFound(candidates)
  if (ticket.status === 'used') {
    return { alreadyUsed: true, checkedInAt: ticket.checked_in_at, holderName: ticket.holder_name }
  }
  if (ticket.status !== 'valid') return { invalid: true, status: ticket.status }

  const { data: claimed } = await db
    .from('tickets')
    .update({ status: 'used', checked_in_at: new Date().toISOString() })
    .eq('id', ticket.id)
    .eq('status', 'valid')
    .select('id, checked_in_at')
    .maybeSingle()

  if (!claimed) {
    // Noen andre rakk den mellom lesingen og skrivingen.
    const { data: current } = await db
      .from('tickets')
      .select('checked_in_at')
      .eq('id', ticket.id)
      .maybeSingle()

    return { alreadyUsed: true, checkedInAt: current?.checked_in_at ?? null, holderName: ticket.holder_name }
  }

  const { data: order } = await db
    .from('orders')
    .select('buyer_name, buyer_email')
    .eq('id', ticket.order_id)
    .maybeSingle()

  revalidatePath(`/admin-app/scanner/${ticket.show_id}`)

  return {
    ok: true,
    ticketId: ticket.id,
    ticketCode: ticket.ticket_code,
    holderName: ticket.holder_name,
    buyerName: order?.buyer_name ?? null,
    buyerEmail: order?.buyer_email ?? null,
  }
}

/**
 * Koden finnes ikke på dette showet. Er den en ekte billett til et annet av
 * klubbens show, skal døra få vite det: «Ukjent kode» får en vakt til å avvise
 * en betalende gjest som bare har møtt opp på feil dato — eller står i feil
 * kø på en kveld med to show. Andre klubbers billetter forblir ukjente.
 */
async function wrongShowOrNotFound(candidates: string[]): Promise<CheckInResult> {
  const db = createAdminClient()
  const { data: ticket } = await db
    .from('tickets')
    .select('show_id, holder_name')
    .in('ticket_code', candidates)
    .maybeSingle()
  if (!ticket) return { notFound: true }

  const { data: show } = await db
    .from('shows')
    .select('title, date, club_id')
    .eq('id', ticket.show_id)
    .maybeSingle()
  if (!show?.club_id) return { notFound: true }

  const access = await getClubAccess()
  if (!access.isSuperadmin && !access.clubIds.includes(show.club_id)) return { notFound: true }

  return { wrongShow: true, showTitle: show.title, showDate: show.date, holderName: ticket.holder_name }
}

export async function uncheckIn(ticketId: string, showId: string): Promise<{ ok: boolean }> {
  await assertShowAccess(showId)
  const db = createAdminClient()
  await db
    .from('tickets')
    .update({ status: 'valid', checked_in_at: null })
    .eq('id', ticketId)
    .eq('show_id', showId)
    .eq('status', 'used')

  revalidatePath(`/admin-app/scanner/${showId}`)
  return { ok: true }
}

export type TicketRow = {
  id: string
  ticket_code: string
  status: 'valid' | 'used' | 'refunded' | 'cancelled'
  checked_in_at: string | null
  /** Navnet billetten gjelder. Null på billetter kjøpt før migrasjon 036. */
  holder_name: string | null
  buyer_name: string | null
  buyer_email: string | null
}

export async function getTicketsForShow(showId: string): Promise<TicketRow[]> {
  await assertShowAccess(showId)
  const db = createAdminClient()
  const { data: tickets } = await db
    .from('tickets')
    .select('id, ticket_code, status, checked_in_at, order_id, holder_name')
    .eq('show_id', showId)
    .order('created_at')
    .limit(2000)

  if (!tickets?.length) return []

  const orderIds = [...new Set(tickets.map(t => t.order_id))]
  const { data: orders } = await db
    .from('orders')
    .select('id, buyer_name, buyer_email')
    .in('id', orderIds)

  const orderMap = Object.fromEntries((orders ?? []).map(o => [o.id, o]))

  return tickets.map(t => ({
    id: t.id,
    ticket_code: t.ticket_code,
    status: t.status as TicketRow['status'],
    checked_in_at: t.checked_in_at,
    holder_name: t.holder_name,
    buyer_name: orderMap[t.order_id]?.buyer_name ?? null,
    buyer_email: orderMap[t.order_id]?.buyer_email ?? null,
  }))
}
