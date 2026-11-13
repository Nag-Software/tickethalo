import { createAdminClient } from '@/lib/supabase/admin'
import { AdminHeader } from '@/components/admin/admin-header'
import { loadBookingSettings } from '@/lib/booking-settings-store'
import { BookingSettingsForm } from './booking-settings-form'
import { ClubDeadlineForm } from './club-deadline-form'

export const metadata = { title: 'Booking engine — Superadmin' }

/**
 * Innstillingene bookingmotoren kjører på.
 *
 * Alt her er tall som endrer hvordan ekte tilbud går ut til ekte komikere:
 * hvor mange, hvor fort, og hvem som står først i køen. Derfor står grensene
 * ved hvert felt, og verdier utenfor dem avvises i stedet for å klippes.
 *
 * Beskrivelsen av hva tallene gjør, står i docs/booking-algoritmen.md.
 */
export default async function BookingSettingsPage() {
  const db = createAdminClient()

  const [settings, { data: clubs }] = await Promise.all([
    loadBookingSettings(db),
    db.from('clubs').select('id, name, city, lineup_deadline_days').order('name'),
  ])

  return (
    <div>
      <AdminHeader title="Booking engine" description="Parameters for the whole platform" />

      <div className="mx-auto max-w-4xl px-6 py-8">
        <section className="mb-8">
          <h2 className="text-base font-semibold">How offers go out</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            The engine sends offers in waves: the best get the first chance, and the number steps up every morning
            until the spot is filled or the cap is reached. As the lineup deadline approaches, all offers go out at
            once. Changes here apply to every club on the next run — what has already been sent stays.
          </p>
        </section>

        <BookingSettingsForm settings={settings} />

        <section className="mt-12">
          <h2 className="text-base font-semibold">Lineup deadline per club</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Clubs set their own deadline under My club. An empty field means the club follows the platform
            default, which is currently {settings.lineup_deadline_days} days.
          </p>

          <div className="mt-4 overflow-hidden rounded-xl border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-medium">Club</th>
                  <th className="px-4 py-2.5 text-left font-medium">Deadline</th>
                  <th className="px-4 py-2.5 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {(clubs ?? []).map((club) => (
                  <tr key={club.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{club.name}</span>
                      {club.city && <span className="ml-2 text-muted-foreground">{club.city}</span>}
                    </td>
                    <td colSpan={2} className="px-4 py-2">
                      <ClubDeadlineForm
                        clubId={club.id}
                        clubName={club.name}
                        value={club.lineup_deadline_days}
                        placeholder={settings.lineup_deadline_days}
                      />
                    </td>
                  </tr>
                ))}
                {(clubs ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-muted-foreground">
                      No clubs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
