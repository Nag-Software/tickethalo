import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { ScannerClient } from './scanner-client'
import { getTicketsForShow } from '../actions'
import { assertShowAccess } from '@/lib/club-auth'

export default async function ShowScannerPage({
  params,
}: {
  params: Promise<{ showId: string }>
}) {
  const { showId } = await params
  await assertShowAccess(showId)
  const db = createAdminClient()

  const { data: show } = await db
    .from('shows')
    .select('id, title, date, venue_name, venue_address')
    .eq('id', showId)
    .maybeSingle()

  if (!show) notFound()

  const tickets = await getTicketsForShow(showId)

  return (
    <ScannerClient
      showId={show.id}
      showTitle={show.title}
      showInfo={[show.date, show.venue_name ?? show.venue_address].filter(Boolean).join(' · ')}
      initialTickets={tickets}
    />
  )
}
