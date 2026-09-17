import { createAdminClient } from '@/lib/supabase/admin'
import {
  clampBookingSettings,
  DEFAULT_BOOKING_SETTINGS,
  type BookingSettings,
} from '@/lib/booking-settings'

type Db = ReturnType<typeof createAdminClient>

/**
 * Raden med innstillinger, lest og skrevet.
 *
 * Ligger for seg selv fordi `lib/booking-settings.ts` skal kunne testes uten
 * en database — grensene og skjemavalideringen der er rene funksjoner.
 *
 * Alt som leses klippes gjennom `clampBookingSettings`. Kolonnene kan endres
 * utenom superadmin-siden, og motoren skal aldri regne på et tall den ikke
 * kjenner grensene til.
 */

export async function loadBookingSettings(db: Db = createAdminClient()): Promise<BookingSettings> {
  const { data, error } = await db
    .from('booking_scoring_config')
    .select('*')
    .eq('id', 'default')
    .maybeSingle()

  if (error) {
    // Bookingen skal ikke stoppe fordi en innstillingsrad ikke svarer.
    // Standardene er de samme som står i databasen.
    console.error(`[Booking] Could not read booking settings: ${error.message}`)
    return DEFAULT_BOOKING_SETTINGS
  }

  return clampBookingSettings(data as Partial<Record<keyof BookingSettings, unknown>> | null)
}

export async function saveBookingSettings(db: Db, settings: BookingSettings): Promise<void> {
  const safe = clampBookingSettings(settings)

  const { error } = await db
    .from('booking_scoring_config')
    .upsert({ id: 'default', ...safe, updated_at: new Date().toISOString() }, { onConflict: 'id' })

  if (error) throw new Error(error.message)
}
