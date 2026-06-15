import Link from 'next/link'
import {
  ArtistBadge,
  ArtistEmpty,
  ArtistNotice,
  ArtistPage,
  ArtistPageHeader,
  artistPrimaryButtonClass,
  artistSecondaryButtonClass,
  formatArtistDate,
} from '@/components/artist/artist-ui'
import { ToastActionForm } from '@/components/toast-action-form'
import {
  ARTIST_AVAILABILITY_SHOW_STATUSES,
  MAX_ARTIST_AVAILABILITY_DATES,
} from '@/lib/artist-availability'
import { toggleAvailabilityAction } from '../actions'
import { canArtistManageAvailability, getCurrentArtist } from '@/lib/artist-portal'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadClubBookingSettings } from '@/lib/club-booking-settings'

export default async function AvailableDatesPage() {
  const { artist, db } = await getCurrentArtist()
  const today = new Date().toISOString().slice(0, 10)
  const canManage = await canArtistManageAvailability(artist, db)

  const [{ data: shows }, { data: availability }] = await Promise.all([
    db
      .from('shows')
      .select('id, title, date, venue_name, status, club_id')
      .gte('date', today)
      .in('status', [...ARTIST_AVAILABILITY_SHOW_STATUSES])
      .order('date'),
    db.from('artist_availability').select('*').eq('artist_id', artist.id).gte('available_date', today).order('available_date'),
  ])

  const selectedRows = availability ?? []
  const selected = new Set(selectedRows.map((item) => item.available_date))
  const selectedCount = selected.size
  const slotsLeft = MAX_ARTIST_AVAILABILITY_DATES - selectedCount
  const showDates = new Set((shows ?? []).map((show) => show.date))

  const admin = createAdminClient()
  const settings = await loadClubBookingSettings(admin, null)
  const bonusPoints = settings.availability_bonus

  return (
    <ArtistPage>
      <ArtistPageHeader
        title="Tilgjengelighet"
        description={`${selectedCount} av ${MAX_ARTIST_AVAILABILITY_DATES} datoer valgt`}
      />

      {!canManage ? (
        <ArtistNotice tone="warning">
          Profilen din må godkjennes av bookingteamet før du kan markere datoer. Status nå: {formatStatusLabel(artist.status)}.
        </ArtistNotice>
      ) : (
        <ArtistNotice tone="neutral">
          Marker opptil {MAX_ARTIST_AVAILABILITY_DATES} datoer du er tilgjengelig. Hver markert dato gir
          {' '}<strong>+{bonusPoints} poeng</strong> i bookingalgoritmen når et show faller på samme dag.
        </ArtistNotice>
      )}

      {canManage && slotsLeft > 0 && (
        <section className="mb-8 border border-black/10 p-4">
          <h2 className="text-sm font-medium">Legg til dato</h2>
          <p className="mt-1 text-sm text-zinc-500">Velg en fremtidig dato du er tilgjengelig, også uten planlagt show.</p>
          <ToastActionForm
            action={toggleAvailabilityAction}
            successMessage="Dato lagt til."
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">Dato</span>
              <input
                type="date"
                name="available_date"
                min={today}
                required
                className="h-10 border border-black/15 bg-white px-3 text-sm outline-none focus:border-black"
              />
            </label>
            <button type="submit" className={artistPrimaryButtonClass}>
              Marker tilgjengelig
            </button>
          </ToastActionForm>
        </section>
      )}

      {selectedCount > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium text-zinc-500">Dine valgte datoer</h2>
          <ul className="mt-3 divide-y divide-black/10 border-y border-black/10">
            {selectedRows.map((row) => {
              const show = (shows ?? []).find((entry) => entry.date === row.available_date)
              return (
                <li key={row.id}>
                  <ToastActionForm
                    action={toggleAvailabilityAction}
                    successMessage="Dato fjernet."
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <input type="hidden" name="available_date" value={row.available_date} />
                    <div>
                      <p className="font-medium">{formatArtistDate(row.available_date, 'weekday')}</p>
                      <p className="mt-0.5 text-sm text-zinc-500">
                        {show
                          ? `${show.title}${show.venue_name ? ` · ${show.venue_name}` : ''}`
                          : showDates.has(row.available_date)
                            ? 'Show på denne datoen'
                            : 'Egenvalgt dato'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {canManage && <ArtistBadge variant="accent">+{bonusPoints} i score</ArtistBadge>}
                      <button type="submit" className={artistSecondaryButtonClass} disabled={!canManage}>
                        Fjern
                      </button>
                    </div>
                  </ToastActionForm>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-medium">Show med åpen booking</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            {slotsLeft > 0
              ? `Du kan velge ${slotsLeft} dato${slotsLeft === 1 ? '' : 'er'} til.`
              : canManage
                ? 'Du har valgt maks antall datoer. Fjern en for å legge til en ny.'
                : 'Du kan velge datoer når profilen er godkjent.'}
          </p>
        </div>

        {(shows ?? []).length === 0 ? (
          <ArtistEmpty text="Ingen kommende show er åpne for booking akkurat nå. Bruk «Legg til dato» over for å markere når du er ledig." />
        ) : (
          <ul className="divide-y divide-black/10 border-y border-black/10">
            {(shows ?? []).map((show) => {
              const checked = selected.has(show.date)
              const disabled = !canManage || (!checked && selectedCount >= MAX_ARTIST_AVAILABILITY_DATES)

              return (
                <li key={show.id} className={checked ? 'bg-[#ff6bff]/5' : undefined}>
                  <ToastActionForm
                    action={toggleAvailabilityAction}
                    successMessage={checked ? 'Dato fjernet.' : 'Dato lagt til.'}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"
                  >
                    <input type="hidden" name="available_date" value={show.date} />
                    <div>
                      <p className="font-medium">{formatArtistDate(show.date, 'weekday')}</p>
                      <p className="mt-0.5 text-sm text-zinc-500">
                        {show.title}{show.venue_name ? ` · ${show.venue_name}` : ''}
                      </p>
                    </div>
                    <button
                      type="submit"
                      disabled={disabled}
                      className={checked ? artistPrimaryButtonClass : artistSecondaryButtonClass}
                    >
                      {checked ? 'Valgt' : 'Marker tilgjengelig'}
                    </button>
                  </ToastActionForm>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <p className="mt-6 text-sm text-zinc-500">
        Du kan fortsatt få tilbud på andre datoer, men markerte datoer prioriteres i matchingen.
        {' '}
        <Link href="/artist-app/booking-offers" className="underline underline-offset-4 hover:text-[#ff6bff]">
          Se tilbud
        </Link>
      </p>
    </ArtistPage>
  )
}

function formatStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending_review: 'Under vurdering',
    approved: 'Godkjent',
    rejected: 'Avslått',
    inactive: 'Inaktiv',
    flagged: 'Flagget',
  }
  return labels[status] ?? status
}
