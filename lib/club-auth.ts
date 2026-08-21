import { cache } from 'react'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuthUser, getSessionProfile } from '@/lib/session'

export const ADMIN_APP_CLUB_COOKIE = 'admin_app_club_id'

export type ClubOption = {
  id: string
  name: string
  city: string | null
  logo_url: string | null
}

export type ClubAccess = {
  isSuperadmin: boolean
  clubIds: string[]
  selectedClubId: string | null
  clubs: ClubOption[]
}

const NO_ACCESS: ClubAccess = { isSuperadmin: false, clubIds: [], selectedClubId: null, clubs: [] }

/**
 * Returns club access for the currently authenticated user.
 * - Superadmin: every club, with the one picked in the club switcher selected
 * - Club admin: the clubs they are a member of
 * - No access: empty
 *
 * Cachet per request: sidene under `(protected)` kaller denne i tillegg til
 * layouten, og uten `cache()` ble brukeren, profilen og klubbene hentet på
 * nytt for hver av dem. Brukeren og profilen kommer fra `lib/session`, som
 * deler de samme oppslagene med layoutene og portal-auth.
 */
export const getClubAccess = cache(async (): Promise<ClubAccess> => {
  const user = await getAuthUser()
  if (!user) return NO_ACCESS

  const profile = await getSessionProfile(user.id)
  if (!profile) return NO_ACCESS

  // Superadmin er ikke medlem av noe — den ene ekstra spørringen tas bare her.
  if (profile.role === 'superadmin') {
    const { data: clubs } = await createAdminClient()
      .from('clubs')
      .select('id, name, city, logo_url')
      .order('name')

    return toAccess(clubs ?? [], { isSuperadmin: true, selectedFromCookie: await getSelectedClubCookie() })
  }

  return toAccess(profile.clubs, { isSuperadmin: false, selectedFromCookie: null })
})

async function getSelectedClubCookie() {
  const cookieStore = await cookies()
  return cookieStore.get(ADMIN_APP_CLUB_COOKIE)?.value ?? null
}

function toAccess(
  clubs: ClubOption[],
  { isSuperadmin, selectedFromCookie }: { isSuperadmin: boolean; selectedFromCookie: string | null },
): ClubAccess {
  const selectedClubId = clubs.some((club) => club.id === selectedFromCookie)
    ? selectedFromCookie
    : clubs[0]?.id ?? null

  return {
    isSuperadmin,
    clubIds: selectedClubId ? [selectedClubId] : [],
    selectedClubId,
    clubs,
  }
}

export async function getDefaultClubIdForAdmin() {
  const access = await getClubAccess()

  const clubId = access.selectedClubId ?? access.clubIds[0]
  if (!clubId) {
    throw new Error('Du har ikke tilgang til noen klubb.')
  }

  return clubId
}

export async function assertShowAccess(showId: string) {
  if (!showId) {
    throw new Error('Mangler show-id.')
  }

  const access = await getClubAccess()
  const db = createAdminClient()

  if (access.clubIds.length === 0) {
    throw new Error('Du har ikke tilgang til noen klubb.')
  }

  const query = db.from('shows').select('id, club_id').eq('id', showId).in('club_id', access.clubIds)

  const { data: show } = await query.maybeSingle()

  if (!show) {
    throw new Error('Du har ikke tilgang til dette showet.')
  }

  return show
}

export async function assertRequirementAccess(showId: string, requirementId: string) {
  if (!requirementId) {
    throw new Error('Mangler show-krav.')
  }

  await assertShowAccess(showId)
  const db = createAdminClient()
  const { data: requirement } = await db
    .from('show_requirements')
    .select('id, show_id, quantity, compensation_type, compensation_amount')
    .eq('id', requirementId)
    .eq('show_id', showId)
    .maybeSingle()

  if (!requirement) {
    throw new Error('Denne lineup-plassen tilhører ikke showet.')
  }

  return requirement
}

/**
 * Ordren tilhører klubbens show. Brukes av refusjon — klubben er selger og
 * er ansvarlig for refusjoner på egne arrangementer, men bare på sine egne.
 */
export async function assertOrderAccess(orderId: string) {
  if (!orderId) {
    throw new Error('Mangler ordre-id.')
  }

  const access = await getClubAccess()
  if (access.clubIds.length === 0) {
    throw new Error('Du har ikke tilgang til noen klubb.')
  }

  const db = createAdminClient()
  const { data: order } = await db
    .from('orders')
    .select('id, show_id, club_id, status')
    .eq('id', orderId)
    .in('club_id', access.clubIds)
    .maybeSingle()

  if (!order) {
    throw new Error('Du har ikke tilgang til denne ordren.')
  }

  return order
}

export async function assertOfferAccess(showId: string, offerId: string) {
  if (!offerId) {
    throw new Error('Mangler tilbud.')
  }

  await assertShowAccess(showId)
  const db = createAdminClient()
  const { data: offer } = await db
    .from('booking_offers')
    .select('id, show_id, show_requirement_id, artist_id, status')
    .eq('id', offerId)
    .eq('show_id', showId)
    .maybeSingle()

  if (!offer) {
    throw new Error('Tilbudet tilhører ikke dette showet.')
  }

  return offer
}

export async function assertSpotAccess(showId: string, spotId: string) {
  if (!spotId) {
    throw new Error('Mangler lineup-spot.')
  }

  await assertShowAccess(showId)
  const db = createAdminClient()
  const { data: spot } = await db
    .from('confirmed_spots')
    .select('id, show_id, show_requirement_id, artist_id, fee_amount, currency, status')
    .eq('id', spotId)
    .eq('show_id', showId)
    .maybeSingle()

  if (!spot) {
    throw new Error('Spotten tilhører ikke dette showet.')
  }

  return spot
}
