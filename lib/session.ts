import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Role } from '@/types/database'

/**
 * Request-scoped lookups of "who is asking".
 *
 * Hver runde til Supabase koster 200–300 ms herfra, og en admin-navigering
 * gjorde åtte av dem på rad: proxyen hentet brukeren, layouten hentet den på
 * nytt, portal-auth slo opp profilen, layouten slo den opp igjen, og
 * `getClubAccess` gjorde begge deler en tredje gang før den hentet klubbene.
 * Databasen svarte på under et millisekund hver gang — tiden gikk i ventingen.
 *
 * `cache()` gjør oppslagene til én per request uansett hvor mange steder i
 * treet som spør, og profilen hentes med klubbene i samme spørring. Da er en
 * navigering nede i ett auth-kall og én spørring før siden selv gjør noe.
 */

export type SessionClub = {
  id: string
  name: string
  city: string | null
  logo_url: string | null
}

export type SessionProfile = {
  id: string
  role: Role
  full_name: string | null
  email: string
  /** Klubbene profilen er medlem av. Superadmin ser alle — se `getClubAccess`. */
  clubs: SessionClub[]
}

/** Den innloggede brukeren, validert mot Supabase. Ett kall per request. */
export const getAuthUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

/**
 * Profil + klubbmedlemskap i én spørring.
 *
 * PostgREST-innbaking (`club_memberships(clubs(...))`) sparer to runder mot
 * databasen. Radtypene må settes for hånd: `Relationships` i den genererte
 * Database-typen er tom, så supabase-js kan ikke utlede formen på det
 * innbakte treet selv.
 */
export const getSessionProfile = cache(async (authUserId: string): Promise<SessionProfile | null> => {
  const db = createAdminClient()

  const { data } = await db
    .from('profiles')
    .select('id, role, full_name, email, club_memberships(clubs(id, name, city, logo_url))')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (!data) return null

  const row = data as unknown as {
    id: string
    role: Role
    full_name: string | null
    email: string
    club_memberships: Array<{ clubs: SessionClub | SessionClub[] | null }> | null
  }

  const clubs = (row.club_memberships ?? [])
    .flatMap((membership) => (Array.isArray(membership.clubs) ? membership.clubs : [membership.clubs]))
    .filter((club): club is SessionClub => Boolean(club?.id && club?.name))

  return {
    id: row.id,
    role: row.role,
    full_name: row.full_name,
    email: row.email,
    clubs,
  }
})

/** Komikerraden som hører til brukeren, når det finnes en. */
export const getArtistForAuthUser = cache(async (authUserId: string) => {
  const db = createAdminClient()

  const { data } = await db
    .from('artists')
    .select('id, full_name, stage_name, email, status')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  return data
})
