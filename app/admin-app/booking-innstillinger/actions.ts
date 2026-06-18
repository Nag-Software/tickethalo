'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { DEFAULT_CLUB_BOOKING_SETTINGS, parseClubBookingSettingsRow } from '@/lib/booking-scoring'

function parseMultiplier(formData: FormData, key: string, label: string) {
  const value = Number(formData.get(key))
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${label} må være mellom 0 og 1.`)
  }
  return value
}

function parsePositiveInt(formData: FormData, key: string, label: string, min: number, max: number) {
  const value = Number(formData.get(key))
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} må være mellom ${min} og ${max}.`)
  }
  return value
}

export async function updateClubBookingSettingsAction(formData: FormData) {
  const clubId = await getDefaultClubIdForAdmin()
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('club_booking_settings')
    .select('*')
    .eq('club_id', clubId)
    .maybeSingle()

  const base = existing ? parseClubBookingSettingsRow(existing) : { ...DEFAULT_CLUB_BOOKING_SETTINGS }

  const payload = {
    ...base,
    fairness_window_months: parsePositiveInt(formData, 'fairness_window_months', 'Historikk', 1, 60),
    fairness_multiplier_0: 1,
    fairness_multiplier_1: parseMultiplier(formData, 'fairness_multiplier_1', 'Etter 1 show'),
    fairness_multiplier_2: parseMultiplier(formData, 'fairness_multiplier_2', 'Etter 2 show'),
    fairness_multiplier_3: parseMultiplier(formData, 'fairness_multiplier_3', 'Etter 3 show'),
    fairness_multiplier_4_plus: parseMultiplier(formData, 'fairness_multiplier_4_plus', 'Etter 4+ show'),
    consecutive_event_multiplier: parseMultiplier(formData, 'consecutive_event_multiplier', 'To events på rad'),
    offers_per_wave: parsePositiveInt(formData, 'offers_per_wave', 'Tilbud per utsendelse', 1, 10),
    offers_per_slot: parsePositiveInt(formData, 'offers_per_slot', 'Maks tilbud i kø per spot', 1, 100),
    updated_at: new Date().toISOString(),
  }

  const { error } = await admin
    .from('club_booking_settings')
    .upsert({ club_id: clubId, ...payload }, { onConflict: 'club_id' })

  if (error) throw new Error(error.message)

  revalidatePath('/admin-app/min-klubb/bookingalgoritme')
  revalidatePath('/admin-app/booking-innstillinger')
}

export async function getClubBookingSettingsForAdmin(clubId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from('club_booking_settings')
    .select('*')
    .eq('club_id', clubId)
    .maybeSingle()

  if (data) return parseClubBookingSettingsRow(data)

  const { data: globalDefaults } = await admin
    .from('booking_scoring_config')
    .select('*')
    .eq('id', 'default')
    .maybeSingle()

  return parseClubBookingSettingsRow(globalDefaults ? {
    ...DEFAULT_CLUB_BOOKING_SETTINGS,
    quality_weight: globalDefaults.quality_weight,
    availability_bonus: globalDefaults.availability_bonus,
    role_match_bonus: globalDefaults.role_match_bonus,
    offers_per_slot: globalDefaults.offers_per_slot,
    fallback_limit: globalDefaults.fallback_limit,
  } : null)
}
