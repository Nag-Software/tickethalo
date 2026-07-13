import { cache } from 'react'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

/**
 * Authenticated Supabase user for the current request. Wrapped in React cache()
 * so layout, page and nested server components share ONE auth roundtrip per render.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

/**
 * Profile row for the authenticated user. Cached per request render so the
 * layout role-gate and getClubAccess() share a single profiles query.
 */
export const getAdminProfile = cache(async () => {
  const user = await getAuthUser()
  if (!user) return null

  const db = createAdminClient()
  const { data } = await db
    .from('profiles')
    .select('id, role, full_name, email')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  return data
})

/**
 * Returns club access for the currently authenticated user.
 * - Superadmin: { isSuperadmin: true, clubIds: null } (all-access)
 * - Club admin: { isSuperadmin: false, clubIds: [...] }
 * - No access: { isSuperadmin: false, clubIds: [] }
 *
 * Cached per request render — repeated calls (layout + page + actions in the
 * same render) reuse the same auth user, profile and club queries.
 */
export const getClubAccess = cache(async (): Promise<ClubAccess> => {
  const profile = await getAdminProfile()
  if (!profile) return { isSuperadmin: false, clubIds: [], selectedClubId: null, clubs: [] }

  const db = createAdminClient()

  if (profile.role === 'superadmin') {
    const { data: clubs } = await db
      .from('clubs')
      .select('id, name, city, logo_url')
      .order('name')

    const clubOptions = clubs ?? []
    const cookieStore = await cookies()
    const cookieValue = cookieStore.get(ADMIN_APP_CLUB_COOKIE)?.value ?? null
    const fallbackClubId = clubOptions[0]?.id ?? null
    const selectedClubId = clubOptions.some((club) => club.id === cookieValue)
      ? cookieValue
      : fallbackClubId

    return {
      isSuperadmin: true,
      clubIds: selectedClubId ? [selectedClubId] : [],
      selectedClubId,
      clubs: clubOptions,
    }
  }

  const { data: memberships } = await db
    .from('club_memberships')
    .select('club_id, clubs(id, name, city, logo_url)')
    .eq('profile_id', profile.id)

  const clubs = (memberships ?? [])
    .map((membership) => Array.isArray(membership.clubs) ? membership.clubs[0] : membership.clubs)
    .filter((club): club is ClubOption => Boolean(club?.id && club?.name))

  // Honour the club switcher for multi-club admins. Without this the selected club is
  // hard-pinned to clubs[0], so an admin who belongs to several clubs can never view
  // or manage any club but their first, and /admin-app/select-club is a no-op.
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(ADMIN_APP_CLUB_COOKIE)?.value ?? null
  const selectedClubId = clubs.some((club) => club.id === cookieValue)
    ? cookieValue
    : clubs[0]?.id ?? null

  return {
    isSuperadmin: false,
    clubIds: selectedClubId ? [selectedClubId] : [],
    selectedClubId,
    clubs,
  }
})

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
