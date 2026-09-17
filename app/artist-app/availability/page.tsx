import { getCurrentArtist } from '@/lib/artist-portal'
import { Chip, PageHeader, Panel } from '@/components/artist/portal-ui'
import { UnavailableCalendar } from '@/components/artist/unavailable-calendar'

export const metadata = { title: 'Availability — Tickethalo' }

const RULES = [
  'Mark the evenings you cannot do. Everything else counts as available.',
  'Tap a day to mark it. Hold and drag to mark several at once.',
  'You will never get an offer for a day you have marked.',
  'Days you are already booked are locked. Get in touch with the club to change those.',
]

export default async function AvailabilityPage() {
  const { artist, db } = await getCurrentArtist()
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: unavailable }, { data: spots }, { data: offers }] = await Promise.all([
    db.from('artist_unavailable_dates')
      .select('unavailable_date')
      .eq('artist_id', artist.id)
      .gte('unavailable_date', today)
      .order('unavailable_date'),
    db.from('confirmed_spots')
      .select('show_id')
      .eq('artist_id', artist.id)
      .in('status', ['confirmed', 'completed', 'paid']),
    db.from('booking_offers')
      .select('show_id')
      .eq('artist_id', artist.id)
      .eq('status', 'sent'),
  ])

  // Datoene ligger på showet, ikke på plassen. Ett oppslag for begge listene.
  const showIds = [...new Set([
    ...(spots ?? []).map((spot) => spot.show_id),
    ...(offers ?? []).map((offer) => offer.show_id),
  ])]

  const { data: shows } = showIds.length > 0
    ? await db.from('shows').select('id, date').in('id', showIds).gte('date', today).is('deleted_at', null)
    : { data: [] as Array<{ id: string; date: string }> }

  const dateByShow = new Map((shows ?? []).map((show) => [show.id, show.date]))
  const bookedDates = [...new Set((spots ?? []).flatMap((spot) => dateByShow.get(spot.show_id) ?? []))]
  const offerDates = [...new Set((offers ?? []).flatMap((offer) => dateByShow.get(offer.show_id) ?? []))]
  const markedDates = (unavailable ?? []).map((row) => row.unavailable_date)

  return (
    <>
      <PageHeader
        title="Availability"
        description="Mark the evenings you cannot do. You are counted as available on every other day."
        actions={
          <Chip tone={markedDates.length > 0 ? 'accent' : 'neutral'}>
            {markedDates.length === 0
              ? 'No days marked'
              : `${markedDates.length} ${markedDates.length === 1 ? 'day' : 'days'} marked`}
          </Chip>
        }
      />

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel title="Your calendar" description="Saved as you go — there is no save button.">
          <UnavailableCalendar
            initialUnavailable={markedDates}
            booked={bookedDates}
            pendingOffer={offerDates}
          />
        </Panel>

        <Panel title="How it works">
          <ul className="flex flex-col divide-y divide-[var(--ev-line)]">
            {RULES.map((rule) => (
              <li key={rule} className="py-3 text-[14px] leading-relaxed text-[var(--ev-muted)]">
                {rule}
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  )
}
