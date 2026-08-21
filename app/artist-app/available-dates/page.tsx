import { ToastActionForm } from '@/components/toast-action-form'
import { toggleAvailabilityAction } from '../actions'
import { getCurrentArtist } from '@/lib/artist-portal'
import { Chip, Empty, PageHeader, Panel, Row, portalButton } from '@/components/artist/portal-ui'

const RULES = [
  'Max three upcoming dates can be prioritized at the same time.',
  'The system prioritizes selected dates, but may still send offers if you match a show.',
  'Only select dates that actually fit. If you say yes and drop later, the profile may be deprioritized.',
]

export default async function AvailableDatesPage() {
  const { artist, db } = await getCurrentArtist()
  const canChooseDates = artist.status === 'approved' && (artist.admin_score ?? 0) >= 6
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: shows }, { data: availability }] = await Promise.all([
    db.from('shows').select('id, title, date, venue_name, status').gte('date', today).in('status', ['booking', 'published']).order('date'),
    db.from('artist_availability').select('*').eq('artist_id', artist.id).gte('available_date', today).order('available_date'),
  ])

  const selected = new Set((availability ?? []).map((item) => item.available_date))
  const selectedCount = selected.size

  return (
    <>
      <PageHeader
        title="Availability"
        description="Choose up to three dates you would prefer to be booked on."
        actions={
          <Chip tone={selectedCount > 0 ? 'accent' : 'neutral'}>{selectedCount} of 3 selected</Chip>
        }
      />

      {!canChooseDates && (
        <p
          className="bg-[var(--ev-card)] px-5 py-4 text-[14px] leading-relaxed"
          style={{ borderRadius: 'var(--ev-r-art)' }}
        >
          The profile must be approved before you can select dates. You can see which evenings are open in
          the meantime.
        </p>
      )}

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title="Upcoming show dates">
          {(shows ?? []).length === 0 ? (
            <Empty>No upcoming show dates are open for booking.</Empty>
          ) : (
            <div className="flex flex-col gap-2">
              {(shows ?? []).map((show) => {
                const checked = selected.has(show.date)
                const disabled = !canChooseDates || (!checked && selectedCount >= 3)

                return (
                  <ToastActionForm key={show.id} action={toggleAvailabilityAction}>
                    <input type="hidden" name="available_date" value={show.date} />
                    <Row>
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium">{formatDate(show.date)}</p>
                        <p className="mt-0.5 truncate text-[13px] text-[var(--ev-muted)]">
                          {show.title}
                          {show.venue_name ? ` · ${show.venue_name}` : ''}
                        </p>
                      </div>
                      <button
                        type="submit"
                        disabled={disabled}
                        className={checked ? portalButton.primary : portalButton.secondary}
                      >
                        {checked ? 'Selected' : 'Select'}
                      </button>
                    </Row>
                  </ToastActionForm>
                )
              })}
            </div>
          )}
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}
