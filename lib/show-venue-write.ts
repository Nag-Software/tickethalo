import { createAdminClient } from '@/lib/supabase/admin'
import { resolveVenueSelection, type VenueLocation, type VenueSelection } from '@/lib/show-venue'

type Db = ReturnType<typeof createAdminClient>

/** Samme tak som under My club (`MAX_LOCATIONS` i my-club/actions.ts). */
const MAX_LOCATIONS = 20

export async function clubLocations(db: Db, clubId: string | null): Promise<VenueLocation[]> {
  if (!clubId) return []
  const { data } = await db
    .from('club_locations')
    .select('id, name, address_line')
    .eq('club_id', clubId)
    .order('sort_order')
    .order('created_at')
  return data ?? []
}

/** Feltene show-skjemaene sender. `save_location` er avkrysningen «Save to My club». */
export function venueSelectionFromForm(formData: FormData): VenueSelection & { saveLocation: boolean } {
  return {
    venue_name: String(formData.get('venue_name') ?? ''),
    venue_address: String(formData.get('venue_address') ?? ''),
    club_location_id: String(formData.get('club_location_id') ?? '').trim() || null,
    saveLocation: String(formData.get('save_location') ?? '') === 'true',
  }
}

/**
 * Det showet skal lagre som sted. Lokasjonene leses med klubbens id, så en
 * lenke til en annen klubbs lokasjon aldri kan bli stående — admin-klienten
 * går utenom RLS, og da er det denne sjekken som gjelder.
 *
 * Med `saveLocation` lagres et nytt sted under My club og lenkes med det
 * samme. Går ikke det (taket er nådd, basen svarer ikke), lagres showet
 * likevel med teksten — stedet på showet er det bookeren bad om, lokasjonen
 * er en bekvemmelighet.
 */
export async function resolveShowVenue(
  db: Db,
  clubId: string | null,
  selection: VenueSelection & { saveLocation?: boolean },
) {
  const locations = await clubLocations(db, clubId)
  const resolved = resolveVenueSelection(selection, locations)

  if (!selection.saveLocation || resolved.club_location_id || !resolved.venue_name || !clubId) return resolved
  if (locations.length >= MAX_LOCATIONS) return resolved

  const { data: created, error } = await db
    .from('club_locations')
    .insert({
      club_id: clubId,
      name: resolved.venue_name,
      address_line: resolved.venue_address,
      sort_order: locations.length,
    })
    .select('id')
    .single()

  if (error || !created) {
    console.error(`[Shows] Could not save "${resolved.venue_name}" as a location for club ${clubId}: ${error?.message}`)
    return resolved
  }

  return { ...resolved, club_location_id: created.id }
}
