'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { canonicalRoleValues } from '@/lib/artist-roles'
import { lookupCountry } from '@/lib/geo'
import { normalizeLanguages } from '@/lib/languages'
import type { Artist, ArtistGender, ArtistStatus, ArtistType, EnergyLevel } from '@/types/database'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES: ArtistStatus[] = ['approved', 'inactive', 'rejected', 'pending_review', 'flagged']
const GENDERS: ArtistGender[] = ['woman', 'man', 'non_binary', 'prefer_not_to_say']
const ENERGY: EnergyLevel[] = ['high', 'medium', 'low', 'uncertain']
const SOCIAL_KEYS = ['instagram', 'tiktok', 'facebook', 'website', 'showcase'] as const

export type SuperadminArtistResult = { ok: true } | { error: string }

/**
 * Superadmin redigerer hele komikerraden.
 *
 * Med vilje løsere enn komikerens eget skjema: lenker lagres som de er
 * skrevet, WhatsApp-nummeret uten formatsjekk og samtykke kan settes direkte.
 * Det er her feil rettes opp, og da må alt kunne skrives inn. Det eneste som
 * sjekkes er det som ellers ville brutt koden som leser feltet — koder for
 * land, språk, roller, kjønn, status og energi.
 */
export async function updateArtistAsSuperadminAction(formData: FormData): Promise<SuperadminArtistResult> {
  try {
    await assertSuperadmin()

    const id = String(formData.get('artist_id') ?? '')
    if (!UUID_PATTERN.test(id)) return { error: 'Mangler komiker.' }

    const db = createAdminClient()
    const { data: artist } = await db
      .from('artists')
      .select('id, auth_user_id, email, whatsapp_consent_at, flagged_at, is_flagged')
      .eq('id', id)
      .maybeSingle()
    if (!artist) return { error: 'Fant ikke komikeren.' }

    const fullName = text(formData, 'full_name')
    if (!fullName) return { error: 'Fullt navn kan ikke være tomt.' }

    const email = text(formData, 'email')?.toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Ugyldig e-post.' }

    const countryText = text(formData, 'country')?.toUpperCase() ?? null
    if (countryText && !lookupCountry(countryText)) return { error: 'Ukjent land.' }

    const status = String(formData.get('status') ?? '') as ArtistStatus
    if (!STATUSES.includes(status)) return { error: 'Ugyldig status.' }

    const genderText = text(formData, 'gender')
    const gender = genderText ? (GENDERS.find((value) => value === genderText) ?? null) : null
    if (genderText && !gender) return { error: 'Ugyldig kjønn.' }

    const energyText = text(formData, 'admin_energy_level')
    const energy = energyText ? (ENERGY.find((value) => value === energyText) ?? null) : null
    if (energyText && !energy) return { error: 'Ugyldig energinivå.' }

    const scoreText = text(formData, 'admin_score')
    const adminScore = scoreText == null ? null : Number(scoreText.replace(',', '.'))
    if (adminScore != null && !Number.isFinite(adminScore)) return { error: 'Admin-score må være et tall.' }

    const languages = normalizeLanguages(formData.getAll('language').map(String))
    const roles = canonicalRoleValues(formData.getAll('category').map(String)) as ArtistType[]

    const socialLinks: Record<string, string> = {}
    for (const key of SOCIAL_KEYS) {
      const value = text(formData, `social_${key}`)
      if (value) socialLinks[key] = value
    }

    // Samtykket beholder datoen det først ble gitt; tas krysset bort, er det borte.
    const whatsappConsent = formData.get('whatsapp_consent') === 'on'
    const whatsappConsentAt = whatsappConsent ? (artist.whatsapp_consent_at ?? new Date().toISOString()) : null

    const isFlagged = formData.get('is_flagged') === 'on'
    const flaggedAt = isFlagged ? (artist.is_flagged ? artist.flagged_at : new Date().toISOString()) : null

    // Nytt bilde: opplastet fil vinner over URL-feltet.
    let profileImageUrl = text(formData, 'profile_image_url') ?? null
    const imageFile = formData.get('profile_image_file')
    if (imageFile instanceof File && imageFile.size > 0) {
      if (!imageFile.type.startsWith('image/')) return { error: 'Profilbildet må være et bilde.' }
      const ext = (imageFile.name.split('.').pop() ?? 'jpg').toLowerCase()
      const path = `${artist.auth_user_id ?? artist.id}/profile-${Date.now()}.${ext}`
      const { error: uploadError } = await db.storage.from('artist-images').upload(path, imageFile, { upsert: true })
      if (uploadError) return { error: 'Kunne ikke laste opp bildet.' }
      profileImageUrl = db.storage.from('artist-images').getPublicUrl(path).data.publicUrl
    }

    const update: Partial<Artist> = {
      full_name: fullName,
      stage_name: text(formData, 'stage_name') ?? null,
      email,
      phone: text(formData, 'phone') ?? null,
      whatsapp_number: text(formData, 'whatsapp_number')?.replace(/\D/g, '') || null,
      whatsapp_consent_at: whatsappConsentAt,
      bank_account_number: text(formData, 'bank_account_number') ?? null,
      profile_image_url: profileImageUrl,
      bio: text(formData, 'bio') ?? null,
      category: roles.length > 0 ? roles : null,
      city: text(formData, 'city') ?? null,
      country: countryText,
      languages: languages.length > 0 ? languages : null,
      gender,
      social_links: Object.keys(socialLinks).length > 0 ? socialLinks : null,
      status,
      admin_score: adminScore,
      admin_energy_level: energy,
      admin_notes: text(formData, 'admin_notes') ?? null,
      is_flagged: isFlagged,
      flag_reason: isFlagged ? (text(formData, 'flag_reason') ?? null) : null,
      flagged_at: flaggedAt,
    }

    // Innloggingen først: avviser Supabase adressen (f.eks. fordi en annen
    // konto har den), skal ikke raden og innloggingen ende med hver sin.
    const emailChanged = email !== artist.email.toLowerCase()
    const syncLogin = formData.get('sync_login_email') === 'on'
    if (emailChanged && syncLogin && artist.auth_user_id) {
      const { error: authError } = await db.auth.admin.updateUserById(artist.auth_user_id, {
        email,
        email_confirm: true,
      })
      if (authError) return { error: `Innloggings-e-posten ble ikke endret: ${authError.message}` }
      await db.from('profiles').update({ email }).eq('auth_user_id', artist.auth_user_id)
    }

    const { error } = await db.from('artists').update(update).eq('id', id)
    if (error) return { error: `Kunne ikke lagre: ${error.message}` }

    revalidatePath(`/superadmin/artists/${id}`)
    revalidatePath('/superadmin/artists')
    revalidatePath(`/admin-app/artists/${id}`)
    revalidatePath('/admin-app/artists')
    return { ok: true }
  } catch (error) {
    return { error: error instanceof Error && error.message ? error.message : 'Noe gikk galt.' }
  }
}

function text(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? '').trim()
  return value.length > 0 ? value : undefined
}
