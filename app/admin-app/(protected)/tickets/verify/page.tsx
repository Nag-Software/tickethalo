import Link from 'next/link'
import { Check, QrCode, TriangleAlert, X } from 'lucide-react'
import { AdminHeader } from '@/components/admin/admin-header'
import { ToastActionForm } from '@/components/toast-action-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClubAccess } from '@/lib/club-auth'
import { extractTicketCode, formatTicketCode, ticketCodeCandidates } from '@/lib/tickets'
import { checkInFromVerifyAction } from './actions'

/**
 * Siden QR-koden på billetten peker på.
 *
 * Koden i e-posten er en lenke hit — den fantes bare ikke før, så hver
 * eneste billett-QR ledet til en 404. Her er den: én billett, hvem den
 * gjelder, om den er gyldig, og en knapp for å slippe folk inn når man
 * ikke står i skanneren.
 */
export default async function VerifyTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>
}) {
  const params = await searchParams
  const code = extractTicketCode(params.code ?? '')
  const candidates = ticketCodeCandidates(params.code ?? '')
  const db = createAdminClient()

  const { data: ticket } = candidates.length
    ? await db
      .from('tickets')
      .select('id, ticket_code, status, checked_in_at, holder_name, show_id, order_id')
      .in('ticket_code', candidates)
      .maybeSingle()
    : { data: null }

  const access = await getClubAccess()
  const { data: show } = ticket
    ? await db.from('shows').select('id, title, date, venue_name, club_id').eq('id', ticket.show_id).single()
    : { data: null }

  // Klubbadmin ser bare sine egne show. En superadmin ser alle.
  const allowed =
    !show ? false : access.isSuperadmin || (show.club_id != null && access.clubIds.includes(show.club_id))

  const { data: order } = ticket && allowed
    ? await db.from('orders').select('buyer_name, buyer_email').eq('id', ticket.order_id).maybeSingle()
    : { data: null }

  return (
    <div>
      <AdminHeader title="Verify ticket" />

      <div className="flex max-w-xl flex-col gap-5 p-6">
        {!code ? (
          <Message tone="warn" title="No ticket code" body="Scan the QR code on the ticket, or open the link from the ticket email." />
        ) : !ticket || !allowed ? (
          <Message
            tone="error"
            title="Unknown ticket"
            body={`No ticket with the code ${formatTicketCode(code)} belongs to your shows.`}
          />
        ) : (
          <Card size="sm">
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Ticket</p>
                  <h2 className="mt-1 truncate text-2xl font-bold tracking-tight">
                    {ticket.holder_name ?? order?.buyer_name ?? 'Unnamed ticket'}
                  </h2>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {show?.title}
                    {show?.date ? ` · ${new Date(show.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                    {show?.venue_name ? ` · ${show.venue_name}` : ''}
                  </p>
                </div>
                <StatusPill status={ticket.status} />
              </div>

              <p className="rounded-2xl bg-muted px-4 py-2.5 font-mono text-lg font-semibold tracking-[0.12em] break-all">
                {formatTicketCode(ticket.ticket_code)}
              </p>

              {ticket.status === 'valid' && (
                <ToastActionForm action={checkInFromVerifyAction} successMessage="Checked in.">
                  <input type="hidden" name="show_id" value={ticket.show_id} />
                  <input type="hidden" name="code" value={ticket.ticket_code} />
                  <Button type="submit" className="w-full">
                    <Check data-icon="inline-start" />
                    Check in
                  </Button>
                </ToastActionForm>
              )}

              {ticket.status === 'used' && ticket.checked_in_at && (
                <p className="text-xs text-muted-foreground">
                  Checked in at{' '}
                  {new Date(ticket.checked_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  {' on '}
                  {new Date(ticket.checked_in_at).toLocaleDateString('en-GB')}
                </p>
              )}

              <Button variant="outline" asChild className="w-full">
                <Link href={`/admin-app/scanner/${ticket.show_id}`}>
                  <QrCode data-icon="inline-start" />
                  Open the scanner
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'valid'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
      : status === 'used'
        ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400'
        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'

  const label = status === 'valid' ? 'Valid' : status === 'used' ? 'Checked in' : status

  return <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{label}</span>
}

function Message({ tone, title, body }: { tone: 'warn' | 'error'; title: string; body: string }) {
  const Icon = tone === 'warn' ? TriangleAlert : X

  return (
    <Card size="sm">
      <CardContent className="flex items-start gap-3">
        <Icon className={`mt-0.5 size-5 shrink-0 ${tone === 'warn' ? 'text-amber-600' : 'text-destructive'}`} />
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        </div>
      </CardContent>
    </Card>
  )
}
