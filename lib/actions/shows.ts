'use server'

import { createAdminClient } from '@/lib/supabase/admin'

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
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  return data
}

/*
 * `updateShowStatus` er fjernet.
 *
 * Den satte hvilken som helst status på et show, og var dermed en vei til
 * `published` utenom `automateFullbookedShow` — altså utenom kravet om full
 * lineup og ferdig Connect-oppsett. Ingenting i grensesnittet brukte den.
 * Vakten i migrasjon 053 stopper den veien i databasen, men funksjonen selv
 * hadde ingen jobb igjen.
 */
