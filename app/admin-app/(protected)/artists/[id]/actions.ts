'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClubAccess } from '@/lib/club-auth'
import { approveArtist } from '@/lib/actions/artist'
import { canonicalRoleValues } from '@/lib/artist-roles'
import { normalizeLanguages } from '@/lib/languages'
import type { Artist, EnergyLevel, ArtistGender, ArtistStatus } from '@/types/database'

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
 * Vurderingen av komikeren — skriver bare feltene skjemaet sendte.
 *
 * Siden har tre skjemaer mot denne handlingen (status, bookingprofil, flagg).
 * Skrev den alle feltene hver gang, ville et statusbytte tømt score, roller og
 * notater fordi de ikke sto i det skjemaet.
 */
export async function saveArtistAdminReview(formData: FormData) {
  await assertAdmin()
  const artistId = formData.get('artist_id') as string
  const db = createAdminClient()

  const update: Partial<Artist> = {}

  if (formData.has('admin_score')) {
    const score = formData.get('admin_score')
    update.admin_score = score ? Number(score) : null
  }

  if (formData.has('admin_energy_level')) {
    update.admin_energy_level = ((formData.get('admin_energy_level') as string) || null) as EnergyLevel | null
  }

  if (formData.has('gender')) {
    update.gender = ((formData.get('gender') as string) || null) as ArtistGender | null
  }

  // Flagget skiller «ingen roller valgt» fra «rollene ble ikke sendt» — uten
  // det kunne lista aldri tømmes igjen.
  if (formData.has('category') || formData.has('category_present')) {
    const categoryValues = canonicalRoleValues(formData.getAll('category').map((value) => String(value)))
    update.category = categoryValues.length > 0 ? categoryValues : null
  }

  if (formData.has('admin_notes')) {
    update.admin_notes = (formData.get('admin_notes') as string) || null
  }

  if (formData.has('status')) {
    update.status = formData.get('status') as ArtistStatus
  }

  if (formData.has('is_flagged')) {
    update.is_flagged = formData.get('is_flagged') === 'true'
    update.flag_reason = (formData.get('flag_reason') as string) || null
  }

  if (Object.keys(update).length > 0) {
    await db.from('artists').update(update).eq('id', artistId)
  }

  revalidatePath(`/admin-app/artists/${artistId}`)
}

export async function approveArtistAction(formData: FormData) {
  await assertAdmin()
  const artistId = formData.get('artist_id') as string
  const score = Number(formData.get('admin_score') ?? 0)
  const energy = (((formData.get('admin_energy_level') as string) || 'uncertain') as EnergyLevel)
  await approveArtist(artistId, { admin_score: score, admin_energy_level: energy })
  revalidatePath(`/admin-app/artists/${artistId}`)
}

export async function rejectArtistAction(formData: FormData) {
  await assertAdmin()
  const artistId = formData.get('artist_id') as string
  const db = createAdminClient()
  await db.from('artists').update({ status: 'rejected' }).eq('id', artistId)
  revalidatePath(`/admin-app/artists/${artistId}`)
}

export async function updateArtistProfile(formData: FormData) {
  await assertAdmin()
  const artistId = formData.get('artist_id') as string
  if (!artistId) throw new Error('artist_id is missing')
  const db = createAdminClient()

  const socialLinksRaw = formData.get('social_links') as string | null
  let social_links: Record<string, string> | null = null
  if (socialLinksRaw) {
    try { social_links = JSON.parse(socialLinksRaw) } catch { social_links = null }
  }
  const categoryValues = canonicalRoleValues(formData.getAll('category').map((value) => String(value)))

  const update: Partial<Artist> = {}
  if (formData.has('full_name')) update.full_name = (formData.get('full_name') as string).trim()
  if (formData.has('stage_name')) update.stage_name = (formData.get('stage_name') as string).trim() || null
  if (formData.has('email')) update.email = (formData.get('email') as string).trim()
  if (formData.has('phone')) update.phone = (formData.get('phone') as string).trim() || null
  if (formData.has('category') || formData.has('category_present')) update.category = categoryValues.length > 0 ? categoryValues : null
  if (formData.has('language') || formData.has('language_present')) {
    const languages = normalizeLanguages(formData.getAll('language').map((value) => String(value)))
    update.languages = languages.length > 0 ? languages : null
  }
  if (formData.has('bio')) update.bio = (formData.get('bio') as string).trim() || null
  if (formData.has('gender')) update.gender = ((formData.get('gender') as string).trim() || null) as Artist['gender']
  if (formData.has('social_links')) update.social_links = social_links

  await db.from('artists').update(update).eq('id', artistId)
  revalidatePath(`/admin-app/artists/${artistId}`)
}

/**
 * Sletter komikeren fra plattformen — ikke fra én klubb.
 *
 * Raden henger sammen med bookinger, tilbud og billetter hos alle klubbene
 * komikeren har spilt for, så den er forbeholdt superadmin. En klubb som er
 * ferdig med noen fjerner koblingen sin i stedet (`club_artists`).
 */
export async function deleteArtistAction(formData: FormData) {
  const access = await assertAdmin()
  if (!access.isSuperadmin) throw new Error('Only a superadmin can delete a comedian from Tickethalo.')

  const artistId = formData.get('artist_id') as string
  const db = createAdminClient()
  await db.from('artists').delete().eq('id', artistId)
  revalidatePath('/admin-app/artists')
  redirect('/admin-app/artists')
}
