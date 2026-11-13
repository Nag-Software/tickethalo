'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser, getSessionProfile } from '@/lib/session'
import {
  BOOKING_SETTING_FIELDS,
  parseBookingSettings,
  type BookingSettingKey,
} from '@/lib/booking-settings'
import { saveBookingSettings } from '@/lib/booking-settings-store'

export type BookingSettingsFormState = {
  status: 'idle' | 'saved' | 'error'
  message: string | null
  /** Feltvise meldinger, slik at feilen står ved feltet den gjelder. */
  issues: Partial<Record<BookingSettingKey, string>>
  savedAt: number | null
}

/**
 * Bare superadmin.
 *
 * Layouten over sidene sjekker det samme, men en server action er et
 * kallbart endepunkt: den kan treffes uten å ha vært innom siden. Disse
 * tallene styrer hvor mange e-poster som går ut til ekte komikere, så
 * sjekken står her også.
 */
async function assertSuperadmin() {
  const user = await getAuthUser()
  if (!user) throw new Error('Not signed in.')

  const profile = await getSessionProfile(user.id)
  if (!profile || profile.role !== 'superadmin') {
    throw new Error('Only superadmins can change the booking settings.')
  }
}

export async function saveBookingSettingsAction(
  _prev: BookingSettingsFormState,
  formData: FormData,
): Promise<BookingSettingsFormState> {
  try {
    await assertSuperadmin()

    const input = Object.fromEntries(
      BOOKING_SETTING_FIELDS.map((field) => [field.key, formData.get(field.key)]),
    ) as Partial<Record<BookingSettingKey, unknown>>

    const { settings, issues } = parseBookingSettings(input)

    if (issues.length > 0) {
      return {
        status: 'error',
        message: issues.length === 1 ? 'One value must be fixed before saving.' : `${issues.length} values must be fixed before saving.`,
        issues: Object.fromEntries(issues.map((issue) => [issue.key, issue.message])),
        savedAt: null,
      }
    }

    await saveBookingSettings(createAdminClient(), settings)

    revalidatePath('/superadmin/booking')
    return { status: 'saved', message: 'Settings saved.', issues: {}, savedAt: Date.now() }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Could not save the settings.',
      issues: {},
      savedAt: null,
    }
  }
}

/**
 * Lineup-fristen for én klubb.
 *
 * Klubben setter den selv på Min klubb. Den står også her fordi det er her
 * man ser dem ved siden av hverandre — og fordi en klubb som har satt en
 * frist ingen rekker, er noe superadmin må kunne rette.
 *
 * Tomt felt betyr «bruk plattformens standard», ikke null dager.
 */
export async function setClubLineupDeadlineAction(formData: FormData): Promise<{ error: string } | undefined> {
  try {
    await assertSuperadmin()

    const clubId = String(formData.get('club_id') ?? '')
    if (!clubId) return { error: 'Missing club.' }

    const raw = String(formData.get('lineup_deadline_days') ?? '').trim()
    let value: number | null = null

    if (raw.length > 0) {
      const parsed = Number(raw)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120) {
        return { error: 'The lineup deadline must be a whole number between 1 and 120 days.' }
      }
      value = parsed
    }

    const { error } = await createAdminClient()
      .from('clubs')
      .update({ lineup_deadline_days: value })
      .eq('id', clubId)

    if (error) return { error: 'Could not save the deadline.' }

    revalidatePath('/superadmin/booking')
    return undefined
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not save the deadline.' }
  }
}
