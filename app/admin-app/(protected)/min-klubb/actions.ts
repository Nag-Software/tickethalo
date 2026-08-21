'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { extractLogoBrandColor } from '@/lib/club-logo-color'
import { normalizeCurrency } from '@/lib/currencies'

const CLUB_MEDIA_BUCKET = 'club-media'
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024
const MAX_LOCATIONS = 20
const MAX_TEXT_LENGTH = 2000

function getOptionalText(formData: FormData, key: string) {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized.slice(0, MAX_TEXT_LENGTH) : null
}

function getRequiredText(formData: FormData, key: string, label: string) {
  const value = getOptionalText(formData, key)
  if (!value) {
    throw new Error(`${label} er påkrevd.`)
  }

  return value
}

function getLogoFile(formData: FormData) {
  const value = formData.get('logoFile')

  if (!(value instanceof File) || value.size === 0) {
    return null
  }

  if (!value.type.startsWith('image/')) {
    throw new Error('Logoen må være et bilde.')
  }

  if (value.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error('Logoen kan ikke være større enn 8 MB.')
  }

  return value
}

function getFileExtension(file: File) {
  const fromName = file.name.split('.').pop()?.trim().toLowerCase()
  if (fromName) return fromName

  const fromMime = file.type.split('/').pop()?.trim().toLowerCase()
  return fromMime || 'png'
}

/**
 * Lokasjonene sendes som parallelle felt fra klientkomponenten. `locationId` er
 * tom for rader som nettopp er lagt til i grensesnittet.
 */
type LocationInput = { id: string | null; name: string; addressLine: string | null }

function getLocations(formData: FormData): LocationInput[] {
  const ids = formData.getAll('locationId').map((value) => String(value))
  const names = formData.getAll('locationName').map((value) => String(value))
  const addresses = formData.getAll('locationAddress').map((value) => String(value))

  const locations = names
    .map((name, index) => ({
      id: ids[index]?.trim() || null,
      name: name.trim().slice(0, 200),
      addressLine: addresses[index]?.trim().slice(0, 300) || null,
    }))
    .filter((location) => location.name.length > 0)

  if (locations.length > MAX_LOCATIONS) {
    throw new Error(`En klubb kan ha maks ${MAX_LOCATIONS} lokasjoner.`)
  }

  return locations
}

async function uploadClubLogo(clubId: string, file: File, bytes: Buffer) {
  const admin = createAdminClient()
  const path = `${clubId}/logo/${Date.now()}-${crypto.randomUUID()}.${getFileExtension(file)}`

  const { error } = await admin.storage
    .from(CLUB_MEDIA_BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false })

  if (error) {
    throw new Error('Kunne ikke laste opp logoen.')
  }

  const { data } = admin.storage.from(CLUB_MEDIA_BUCKET).getPublicUrl(path)
  return data.publicUrl
}

/**
 * Skriver lokasjonslista slik den ble sendt inn: rader som er borte slettes,
 * resten oppdateres i den rekkefølgen de står. Ider fra klienten kontrolleres
 * mot klubbens egne rader før de brukes.
 */
async function syncClubLocations(clubId: string, locations: LocationInput[]) {
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('club_locations')
    .select('id')
    .eq('club_id', clubId)

  const existingIds = new Set((existing ?? []).map((row) => row.id))
  const keptIds = new Set(locations.map((location) => location.id).filter((id): id is string => Boolean(id && existingIds.has(id))))

  const removedIds = [...existingIds].filter((id) => !keptIds.has(id))
  if (removedIds.length > 0) {
    const { error } = await admin
      .from('club_locations')
      .delete()
      .eq('club_id', clubId)
      .in('id', removedIds)

    if (error) throw new Error('Kunne ikke fjerne lokasjonen.')
  }

  const updates = locations
    .map((location, index) => ({ location, index }))
    .filter(({ location }) => location.id && keptIds.has(location.id))

  const inserts = locations
    .map((location, index) => ({ location, index }))
    .filter(({ location }) => !location.id || !keptIds.has(location.id))

  const updateResults = await Promise.all(
    updates.map(({ location, index }) =>
      admin
        .from('club_locations')
        .update({ name: location.name, address_line: location.addressLine, sort_order: index })
        .eq('club_id', clubId)
        .eq('id', location.id as string),
    ),
  )

  if (updateResults.some((result) => result.error)) {
    throw new Error('Kunne ikke oppdatere lokasjonene.')
  }

  if (inserts.length > 0) {
    const { error } = await admin.from('club_locations').insert(
      inserts.map(({ location, index }) => ({
        club_id: clubId,
        name: location.name,
        address_line: location.addressLine,
        sort_order: index,
      })),
    )

    if (error) throw new Error('Kunne ikke lagre lokasjonen.')
  }
}

export async function saveClubProfileAction(formData: FormData) {
  const clubId = await getDefaultClubIdForAdmin()
  const admin = createAdminClient()

  const { data: currentClub, error: currentClubError } = await admin
    .from('clubs')
    .select('id, logo_url')
    .eq('id', clubId)
    .single()

  if (currentClubError || !currentClub) {
    throw new Error('Fant ikke valgt klubb.')
  }

  const name = getRequiredText(formData, 'name', 'Klubbnavn')
  const city = getOptionalText(formData, 'city')
  const description = getOptionalText(formData, 'description')
  // Ukjente koder faller tilbake på NOK framfor å avvise hele lagringen.
  const currency = normalizeCurrency(getOptionalText(formData, 'currency'))
  const locations = getLocations(formData)

  const logoFile = getLogoFile(formData)
  // Tomt felt betyr at logoen ble fjernet i grensesnittet.
  const keepsExistingLogo = getOptionalText(formData, 'existingLogoUrl') === currentClub.logo_url

  let logoUrl = currentClub.logo_url
  // Fargen følger logoen: ny logo gir ny farge, fjernet logo gir standardfargen.
  let brandColor: string | null | undefined = undefined

  if (logoFile) {
    const bytes = Buffer.from(await logoFile.arrayBuffer())
    logoUrl = await uploadClubLogo(clubId, logoFile, bytes)
    brandColor = await extractLogoBrandColor(bytes)
  } else if (!keepsExistingLogo) {
    logoUrl = null
    brandColor = null
  }

  const { error } = await admin
    .from('clubs')
    .update({
      name,
      city,
      description,
      currency,
      logo_url: logoUrl,
      ...(brandColor === undefined ? {} : { brand_color: brandColor }),
    })
    .eq('id', clubId)

  if (error) {
    throw new Error('Kunne ikke lagre klubbprofilen.')
  }

  await syncClubLocations(clubId, locations)

  revalidatePath('/admin-app')
  revalidatePath('/admin-app/min-klubb')
}
