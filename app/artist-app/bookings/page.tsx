import Link from 'next/link'
import { formatMoney, getCurrentArtist } from '@/lib/artist-portal'
import { cn } from '@/lib/utils'
import { Chip, Empty, PageHeader, Panel, Row } from '@/components/artist/portal-ui'

const VIEWS = [
  { value: 'upcoming', label: 'Kommende' },
  { value: 'previous', label: 'Tidligere' },
  { value: 'cancelled', label: 'Kansellerte' },
] as const

export default async function ConfirmedBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const { view = 'upcoming' } = await searchParams
  const { artist, db } = await getCurrentArtist()
  const { data: spots } = await db.from('confirmed_spots').select('*').eq('artist_id', artist.id).order('created_at', { ascending: false })
  const showIds = [...new Set((spots ?? []).map((spot) => spot.show_id))]
  const { data: shows } = showIds.length > 0
    ? await db.from('shows').select('id, title, date, start_time, venue_name').in('id', showIds)
    : { data: [] }
  const showMap = new Map((shows ?? []).map((show) => [show.id, show]))
  const today = new Date().toISOString().slice(0, 10)

  const matches = (spot: (typeof spots extends null ? never : NonNullable<typeof spots>)[number], value: string) => {
    const show = showMap.get(spot.show_id)
    if (value === 'cancelled') return spot.status === 'cancelled'
    if (value === 'previous') return spot.status !== 'cancelled' && Boolean(show?.date) && show!.date < today
    return spot.status !== 'cancelled' && (!show?.date || show.date >= today)
  }

  const filtered = (spots ?? []).filter((spot) => matches(spot, view))
  const total = filtered.reduce((sum, spot) => sum + (spot.fee_amount ?? 0), 0)
  const currency = filtered[0]?.currency ?? 'NOK'

  return (
    <>
      <PageHeader
        title="Bookinger"
        description="Bekreftede oppdrag, honorar og status."
      />

      {/* Samme chip-mønster som filtrene på den offentlige eventlisten */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
        {VIEWS.map((option) => {
          const active = view === option.value
          const count = (spots ?? []).filter((spot) => matches(spot, option.value)).length
          return (
            <Link
              key={option.value}
              href={`/artist-app/bookings?view=${option.value}`}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition-colors',
                active
                  ? 'bg-[var(--ev-accent-fill)] font-semibold text-[var(--ev-accent-ink)]'
                  : 'bg-[var(--ev-card)] text-[var(--ev-muted)] hover:bg-[var(--ev-card-hover)] hover:text-[var(--ev-text)]'
              )}
            >
              {option.label}
              <span className={cn('tabular-nums', active ? 'opacity-70' : 'text-[var(--ev-faint)]')}>
                {count}
              </span>
            </Link>
          )
        })}
      </div>

      <Panel
        title={`${filtered.length} ${filtered.length === 1 ? 'booking' : 'bookinger'}`}
        actions={
          total > 0 && view !== 'cancelled' ? (
            <span className="text-[14px] font-medium tabular-nums">
              {formatMoney(total, currency)} totalt
            </span>
          ) : undefined
        }
      >
        {filtered.length === 0 ? (
          <Empty>Ingen bookinger i denne visningen.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((spot) => {
              const show = showMap.get(spot.show_id)
              return (
                <Row key={spot.id} muted={spot.status === 'cancelled'}>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-medium">{show?.title ?? 'Show'}</p>
                    <p className="mt-0.5 truncate text-[13px] text-[var(--ev-muted)]">
                      {show?.date ? formatDate(show.date) : 'Dato kommer'}
                      {show?.start_time ? ` · ${show.start_time.slice(0, 5)}` : ''}
                      {show?.venue_name ? ` · ${show.venue_name}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={spot.status === 'confirmed' ? 'accent' : 'neutral'}>
                      {spot.status === 'confirmed' ? 'Bekreftet' : spot.status}
                    </Chip>
                    <span className="text-[14px] font-medium tabular-nums">
                      {formatMoney(spot.fee_amount, spot.currency)}
                    </span>
                  </div>
                </Row>
              )
            })}
          </div>
        )}
      </Panel>
    </>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}
