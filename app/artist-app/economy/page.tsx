import { formatMoney, getCurrentArtist } from '@/lib/artist-portal'
import { Empty, PageHeader, Panel, Row } from '@/components/artist/portal-ui'

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
    ? await db.from('shows').select('id, title, date, venue_name').in('id', showIds)
    : { data: [] }
  const showMap = new Map((shows ?? []).map((show) => [show.id, show]))
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
        title="Utbetaling"
        description="Se hva du kan fakturere per bekreftet show."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Summary label="Kommende" value={formatMoney(total(upcoming), currency)} detail={`${upcoming.length} ${upcoming.length === 1 ? 'show' : 'show'}`} />
        <Summary label="Tidligere" value={formatMoney(total(previous), currency)} detail={`${previous.length} gjennomført`} />
      </div>

      <Panel title="Honorar per show">
        {(spots ?? []).length === 0 ? (
          <Empty>Bekreftede show og honorar dukker opp her.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {(spots ?? []).map((spot) => {
              const show = showMap.get(spot.show_id)
              return (
                <Row key={spot.id}>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium">{show?.title ?? 'Show'}</p>
                    <p className="mt-0.5 truncate text-[13px] text-[var(--ev-muted)]">
                      {show?.date ? formatDate(show.date) : 'Dato kommer'}
                      {show?.venue_name ? ` · ${show.venue_name}` : ''}
                    </p>
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
  return new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}