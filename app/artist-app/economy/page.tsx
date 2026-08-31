import { formatMoney, getCurrentArtist } from '@/lib/artist-portal'
import { Empty, PageHeader, Panel, Row } from '@/components/artist/portal-ui'
import { clubInvoiceRecipient } from '@/lib/fee-invoices'
import type { ArtistFeeInvoiceStatus } from '@/types/database'

/**
 * Hvor langt fakturaen er kommet, med komikerens ord. Statusene i databasen
 * er vår saksgang; her er det bare to spørsmål som betyr noe: har vi fått
 * fakturaen, og er den betalt.
 */
const INVOICE_STATUS: Record<ArtistFeeInvoiceStatus, string> = {
  issued: 'Waiting for your invoice',
  received: 'Invoice received',
  approved: 'Approved for payment',
  paid: 'Paid',
  rejected: 'On hold — the club will be in touch',
}

export default async function EconomyPage() {
  const { artist, db } = await getCurrentArtist()
  const { data: spots } = await db
    .from('confirmed_spots')
    .select('*')
    .eq('artist_id', artist.id)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })

  const showIds = [...new Set((spots ?? []).map((spot) => spot.show_id))]
  const { data: shows } = showIds.length > 0
    ? await db.from('shows').select('id, title, date, venue_name, club_id').in('id', showIds)
    : { data: [] }
  const showMap = new Map((shows ?? []).map((show) => [show.id, show]))

  // Klubben er den som skal faktureres, og adressen står i eposten som gikk
  // ut etter showet. E-poster blir borte; portalen skal kunne svare på
  // «hvor sender jeg den?» uten at noen må lete i innboksen.
  const clubIds = [...new Set((shows ?? []).map((show) => show.club_id).filter((id): id is string => Boolean(id)))]
  const { data: clubRows } = clubIds.length > 0
    ? await db.from('clubs').select('id, name, legal_name, org_number, invoice_email, support_email').in('id', clubIds)
    : { data: [] }
  const clubMap = new Map((clubRows ?? []).map((club) => [club.id, clubInvoiceRecipient(club)]))

  // Referansen fakturaen skal merkes med. Uten den kommer fakturaen ikke
  // gjennom kontrollen vår, så den hører hjemme ved siden av beløpet — ikke
  // bare i eposten som ble sendt en gang.
  const spotIds = (spots ?? []).map((spot) => spot.id)
  const { data: invoiceRows } = spotIds.length > 0
    ? await db.from('artist_fee_invoices').select('spot_id, reference, status').in('spot_id', spotIds)
    : { data: [] as Array<{ spot_id: string; reference: string; status: ArtistFeeInvoiceStatus }> }
  const invoiceMap = new Map((invoiceRows ?? []).map((row) => [row.spot_id, row]))
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = (spots ?? [])
    .filter((spot) => !showMap.get(spot.show_id)?.date || showMap.get(spot.show_id)!.date >= today)
    .sort((a, b) => (showMap.get(a.show_id)?.date ?? '').localeCompare(showMap.get(b.show_id)?.date ?? ''))
  const previous = (spots ?? []).filter((spot) => {
    const date = showMap.get(spot.show_id)?.date
    return date != null && date < today
  })
  const total = (items: typeof spots) => (items ?? []).reduce((sum, spot) => sum + (spot.fee_amount ?? 0), 0)
  const currency = spots?.[0]?.currency ?? 'NOK'

  return (
    <>
      <PageHeader
        title="Payouts"
        description="See what you can invoice per confirmed show, and who to send the invoice to."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Summary label="Upcoming" value={formatMoney(total(upcoming), currency)} detail={`${upcoming.length} ${upcoming.length === 1 ? 'show' : 'shows'}`} />
        <Summary label="Previous" value={formatMoney(total(previous), currency)} detail={`${previous.length} completed`} />
      </div>

      <Panel title="How to get paid">
        <div className="flex flex-col gap-2 text-[14px] leading-relaxed text-[var(--ev-muted)]">
          <p>
            Once a show is settled you get an email with the amount, a reference and the club&apos;s
            invoicing address. The club pays you directly — Tickethalo works out what you are owed
            from the agreement and the ticket sales.
          </p>
          <p>
            {/* Sagt rett ut, fordi det er det som skiller en faktura som blir
                betalt fra en som blir liggende. */}
            Put the reference on the invoice and keep the amount exactly as stated — clubs only pay
            invoices that match a reference we have issued, to the account number registered on
            your profile.
          </p>
        </div>
      </Panel>

      <Panel title="Fee per show">
        {(spots ?? []).length === 0 ? (
          <Empty>Confirmed shows and fees will appear here.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {(spots ?? []).map((spot) => {
              const show = showMap.get(spot.show_id)
              const invoice = invoiceMap.get(spot.id)
              const recipient = show?.club_id ? clubMap.get(show.club_id) : null
              return (
                <Row key={spot.id}>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium">{show?.title ?? 'Show'}</p>
                    <p className="mt-0.5 truncate text-[13px] text-[var(--ev-muted)]">
                      {show?.date ? formatDate(show.date) : 'Date coming'}
                      {show?.venue_name ? ` · ${show.venue_name}` : ''}
                    </p>
                    {invoice && (
                      <>
                        <p className="mt-1 truncate text-[13px] text-[var(--ev-muted)]">
                          <span className="font-mono">{invoice.reference}</span>
                          {' · '}
                          {INVOICE_STATUS[invoice.status]}
                        </p>
                        {recipient && (
                          <p className="mt-0.5 truncate text-[13px] text-[var(--ev-muted)]">
                            Invoice {recipient.name}
                            {recipient.email ? ` · ${recipient.email}` : ' · ask the club for an address'}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                  <span className="shrink-0 text-[15px] font-semibold tabular-nums">
                    {formatMoney(spot.fee_amount, spot.currency)}
                  </span>
                </Row>
              )
            })}
          </div>
        )}
      </Panel>
    </>
  )
}

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-[var(--ev-text)] px-5 py-5 text-[var(--ev-bg)]" style={{ borderRadius: 'var(--ev-r-card)' }}>
      <p className="text-[13px] opacity-70">{label}</p>
      <p className="mt-1 text-[1.7rem] font-semibold leading-tight tabular-nums">{value}</p>
      <p className="mt-1 text-[13px] opacity-70">{detail}</p>
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}