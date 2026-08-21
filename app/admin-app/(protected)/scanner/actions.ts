'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { assertShowAccess } from '@/lib/club-auth'

export type CheckInResult =
  | { notFound: true }
  | { alreadyUsed: true; checkedInAt: string | null }
  | { invalid: true; status: string }
  | { ok: true; ticketId: string; buyerName: string | null; buyerEmail: string | null }

export async function checkInByCode(showId: string, rawCode: string): Promise<CheckInResult> {
  await assertShowAccess(showId)
  const code = rawCode.trim().toUpperCase()
  if (!code) return { notFound: true }

  const db = createAdminClient()
  const { data: ticket } = await db
    .from('tickets')
    .select('id, ticket_code, status, checked_in_at, order_id, show_id')
    .eq('show_id', showId)
    .eq('ticket_code', code)
    .maybeSingle()

  if (!ticket) return { notFound: true }
  if (ticket.status === 'used') return { alreadyUsed: true, checkedInAt: ticket.checked_in_at }
  if (ticket.status !== 'valid') return { invalid: true, status: ticket.status }

  await db
    .from('tickets')
    .update({ status: 'used', checked_in_at: new Date().toISOString() })
    .eq('id', ticket.id)

  const { data: order } = await db
    .from('orders')
    .select('buyer_name, buyer_email')
    .eq('id', ticket.order_id)
    .maybeSingle()

  revalidatePath(`/admin-app/scanner/${ticket.show_id}`)

  return {
    ok: true,
    ticketId: ticket.id,
    buyerName: order?.buyer_name ?? null,
    buyerEmail: order?.buyer_email ?? null,
  }
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
  buyer_name: string | null
  buyer_email: string | null
}

export async function getTicketsForShow(showId: string): Promise<TicketRow[]> {
  await assertShowAccess(showId)
  const db = createAdminClient()
  const { data: tickets } = await db
    .from('tickets')
    .select('id, ticket_code, status, checked_in_at, order_id')
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
    buyer_name: orderMap[t.order_id]?.buyer_name ?? null,
    buyer_email: orderMap[t.order_id]?.buyer_email ?? null,
  }))
}
