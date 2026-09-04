'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClubAccess, getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { saveClubArtistReview, type ClubArtistReview } from '@/lib/club-artist-profile'
import { approveArtist } from '@/lib/actions/artist'
import { canonicalRoleValues } from '@/lib/artist-roles'
import type { ArtistStatus, ArtistType, EnergyLevel } from '@/types/database'

/**
 * Alt som eksporteres fra en `'use server'`-modul er et kallbart endepunkt, og
 * ID-en ligger i klient-bundlen for hver handling en klient-komponent bruker.
 * Uten denne sjekken kunne hvem som helst skrive om eller slette en hvilken
 * som helst komiker med ett HTTP-kall.
 *
 * Komikere er delt mellom klubbene, så det finnes ingen eier å sjekke mot —
 * kravet er at kallet kommer fra en innlogget klubbadmin.
 */
async function assertAdmin() {
  const access = await getClubAccess()
  if (!access.isSuperadmin && access.clubIds.length === 0) {
    throw new Error('Not authorised.')
  }
  return access
}

/**
 * Klubbens vurdering av komikeren.
 *
 * Skriver til `club_artists`, ikke til `artists`: roller, energi, notater og
 * flagg er denne klubbens mening (migrasjon 043). To klubber har lov til å
 * mene ulikt om hvem som er headliner, og et flagg hos én skal ikke skjule
 * komikeren for de andre.
 *
 * Skriver bare feltene skjemaet faktisk sendte — siden har to skjemaer mot
 * denne handlingen (bookingprofil og flagg), og et flaggbytte skal ikke tømme
 * roller og notater fordi de ikke sto i det skjemaet.
 */
export async function saveClubArtistReviewAction(formData: FormData) {
  await assertAdmin()
  const clubId = await getDefaultClubIdForAdmin()
  const artistId = formData.get('artist_id') as string
  const db = createAdminClient()

  const patch: Partial<ClubArtistReview> = {}

  if (formData.has('admin_energy_level')) {
    patch.admin_energy_level = ((formData.get('admin_energy_level') as string) || null) as EnergyLevel | null
  }

  // Flagget skiller «ingen roller valgt» fra «rollene ble ikke sendt» — uten
  // det kunne lista aldri tømmes igjen.
  if (formData.has('category') || formData.has('category_present')) {
    const values = canonicalRoleValues(formData.getAll('category').map((value) => String(value)))
    patch.category = values.length > 0 ? (values as ArtistType[]) : null
  }

  if (formData.has('admin_notes')) {
    patch.admin_notes = (formData.get('admin_notes') as string) || null
  }

  if (formData.has('is_flagged')) {
    const flagged = formData.get('is_flagged') === 'true'
    patch.is_flagged = flagged
    patch.flag_reason = (formData.get('flag_reason') as string) || null
    patch.flagged_at = flagged ? new Date().toISOString() : null
  }

  await saveClubArtistReview(db, clubId, artistId, patch)
  revalidatePath(`/admin-app/artists/${artistId}`)
}

/**
 * Statusen på plattformen — forbeholdt superadmin.
 *
 * `approved` styrer komikerens tilgang til sin egen portal og retten til å
 * melde seg tilgjengelig. En enkelt klubb skal ikke kunne avvise noen for
 * alle andre; vil en klubb slutte å booke en komiker, fjerner de koblingen
 * eller flagger hen hos seg.
 */
async function assertSuperadmin() {
  const access = await getClubAccess()
  if (!access.isSuperadmin) {
    throw new Error('Only a superadmin can change a comedian\'s platform status.')
  }
  return access
}

export async function updateArtistStatusAction(formData: FormData) {
  await assertSuperadmin()
  const artistId = formData.get('artist_id') as string
  const status = formData.get('status') as ArtistStatus
  const db = createAdminClient()

  await db.from('artists').update({ status }).eq('id', artistId)
  revalidatePath(`/admin-app/artists/${artistId}`)
}

export async function approveArtistAction(formData: FormData) {
  await assertSuperadmin()
  const artistId = formData.get('artist_id') as string
  await approveArtist(artistId)
  revalidatePath(`/admin-app/artists/${artistId}`)
}

export async function rejectArtistAction(formData: FormData) {
  await assertSuperadmin()
  const artistId = formData.get('artist_id') as string
  const db = createAdminClient()
  await db.from('artists').update({ status: 'rejected' }).eq('id', artistId)
  revalidatePath(`/admin-app/artists/${artistId}`)
}

export async function deleteArtistAction(formData: FormData) {
  const access = await assertAdmin()
  if (!access.isSuperadmin) throw new Error('Only a superadmin can delete a comedian from Tickethalo.')

  const artistId = formData.get('artist_id') as string
  const db = createAdminClient()
  await db.from('artists').delete().eq('id', artistId)
  revalidatePath('/admin-app/artists')
  redirect('/admin-app/artists')
}
