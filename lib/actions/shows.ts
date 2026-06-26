'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import type { ShowStatus } from '@/types/database'

/**
 * 6.4 Create show (draft)
 */
export async function createShow(input: {
  title: string
  slug: string
  date: string
  description?: string
  start_time?: string
  end_time?: string
  venue_address?: string
  capacity?: number
  ticket_price?: number
  currency?: string
  club_id?: string | null
  poster_mode?: 'framed' | 'ai_generated' | 'template'
}) {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('shows')
    .insert({
      title: input.title,
      slug: input.slug,
      date: input.date,
      description: input.description ?? null,
      start_time: input.start_time ?? null,
      end_time: input.end_time ?? null,
      venue_name: null,
      venue_address: input.venue_address ?? null,
      capacity: input.capacity ?? null,
      ticket_price: input.ticket_price ?? null,
      currency: input.currency ?? 'NOK',
      club_id: input.club_id ?? null,
      status: 'draft',
      ...(input.poster_mode ? { poster_mode: input.poster_mode } : {}),
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return data
}

/**
 * Update show status
 */
export async function updateShowStatus(showId: string, status: ShowStatus) {
  const admin = createAdminClient()
  const { error } = await admin.from('shows').update({ status }).eq('id', showId)
  if (error) throw new Error(error.message)
}
