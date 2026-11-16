import { createAdminClient } from '@/lib/supabase/admin'
import { clubRoleValues } from '@/lib/artist-roles'
import { recalculateClubArtistScore } from '@/lib/artist-reviews'
import { customSpotTypeNames } from '@/lib/spot-types'
import { getClubSpotTypes } from '@/lib/spot-types-data'

type Db = ReturnType<typeof createAdminClient>

/**
 * Når en søker får et tilbud (Approve, eller forslaget fra søknadene).
 *
 * Tilbud går bare til klubbens egne komikere. En søker på et show åpent for
 * «Everyone» står ikke nødvendigvis på lista — et tilbud er å si ja til
 * komikeren, så koblingen lages med typen til plassen. Klubbens tidligere
 * vurderinger, om de finnes, teller fra første tilbud.
 *
 * Returnerer om koblingen ble laget nå, så Approve kan rulle den tilbake om
 * tilbudet feiler.
 */
export async function ensureClubArtistForApplicant(
  db: Db,
  { clubId, artistId, roleName }: { clubId: string; artistId: string; roleName: string | null },
): Promise<boolean> {
  const { data: review } = await db
    .from('club_artists')
    .select('artist_id')
    .eq('club_id', clubId)
    .eq('artist_id', artistId)
    .maybeSingle()
  if (review) return false

  // Typen til plassen, også når det er klubbens egen (migrasjon 100).
  const customNames = customSpotTypeNames(await getClubSpotTypes(db, clubId))
  const { error } = await db
    .from('club_artists')
    .insert({ club_id: clubId, artist_id: artistId, category: clubRoleValues(roleName, customNames) })
  // To tilbud samtidig: den andre finner raden den første la inn.
  if (error && error.code !== '23505') throw new Error(error.message)
  if (error) return false

  // Koblingen er laget; scoren er en oppfølging. Feiler den, skal Approve
  // fortsatt vite at raden er ny (og kunne fjerne den om tilbudet feiler).
  try {
    await recalculateClubArtistScore(db, clubId, artistId)
  } catch (error) {
    console.error(`[Applicants] Could not recalculate score for ${artistId} at ${clubId}:`, error)
  }
  return true
}

/**
 * Søknaden er besvart med et tilbud: godkjent, med plassen og tilbudet.
 * Bare en åpen søknad endres — en trukket eller avslått står som den er.
 */
export async function markApplicationOffered(
  db: Db,
  { showId, artistId, requirementId, offerId }: { showId: string; artistId: string; requirementId: string; offerId: string },
) {
  const { error } = await db
    .from('show_submissions')
    .update({
      status: 'accepted',
      responded_at: new Date().toISOString(),
      show_requirement_id: requirementId,
      booking_offer_id: offerId,
    })
    .eq('show_id', showId)
    .eq('artist_id', artistId)
    .in('status', ['pending', 'shortlisted'])
  if (error) console.error(`[Booking] Could not mark application for ${artistId} on ${showId}: ${error.message}`)
}
