import { randomBytes } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { canonicalRoleValues } from '@/lib/artist-roles'
import { addArtistToClub } from '@/lib/club-roster'
import type { ArtistType } from '@/types/database'

type Db = ReturnType<typeof createAdminClient>

/**
 * Klubbens invitasjonslenke for komikere (ClickUp 869fn3w36, migrasjon 095).
 *
 * Lenken er `/artist-app/join/<token>`. Den som registrerer seg eller logger
 * inn derfra, sendes via `/artist-app/join/<token>/accept` (som `next`) og
 * havner på klubbens liste. Lenken legger bare komikeren *til* — den skjuler
 * hen ikke for noen: katalogen («Discover comedians») utelater bare
 * komikerne den klubben som ser på alt har.
 *
 * Tokenet er hele hemmeligheten. Den som har lenken kan legge seg selv til,
 * ingenting mer — og klubben kan bytte den når den har spredd seg for langt.
 */

/** 24 tilfeldige byte, 32 tegn base64url: ikke gjettbart, og trygt i en URL. */
export function generateInviteToken(): string {
  return randomBytes(24).toString('base64url')
}

/** Ser ut som et token vi har laget. Alt annet slås av før databasen spørres. */
export function isInviteTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{32}$/.test(token)
}

export function inviteJoinPath(token: string) {
  return `/artist-app/join/${token}`
}

/** Dit innloggingen og registreringen sender komikeren etterpå (`next`). */
export function inviteAcceptPath(token: string) {
  return `${inviteJoinPath(token)}/accept`
}

/**
 * Klubbens token, laget første gang noen ser etter det.
 *
 * To faner som åpner Comedians-siden samtidig skal ende med samme lenke, så
 * innsettingen hopper over en rad som fantes, og vi leser det som ble stående.
 *
 * Den nye raden leses fra svaret på innsettingen, ikke med `readToken` en gang
 * til: Next husker like GET-kall gjennom én render, så det andre oppslaget
 * ville fått det første, tomme svaret tilbake. Taper vi kappløpet, leses
 * raden med et annet utvalg kolonner — en annen URL, og dermed et nytt kall.
 */
export async function getOrCreateClubInviteToken(db: Db, clubId: string): Promise<string> {
  const existing = await readToken(db, clubId)
  if (existing) return existing

  const { data, error } = await db
    .from('club_artist_invites')
    .upsert({ club_id: clubId, token: generateInviteToken() }, { onConflict: 'club_id', ignoreDuplicates: true })
    .select('token')
  if (error) throw new Error(error.message)
  if (data?.[0]) return data[0].token

  const { data: winner, error: winnerError } = await db
    .from('club_artist_invites')
    .select('token, created_at')
    .eq('club_id', clubId)
    .maybeSingle()
  if (winnerError) throw new Error(winnerError.message)
  if (!winner) throw new Error('Invite token was not stored')
  return winner.token
}

/** Nytt token. Den gamle lenken virker ikke lenger fra dette øyeblikket. */
export async function resetClubInviteToken(db: Db, clubId: string): Promise<string> {
  const token = generateInviteToken()
  const { error } = await db
    .from('club_artist_invites')
    .upsert({ club_id: clubId, token, created_at: new Date().toISOString() }, { onConflict: 'club_id' })
  if (error) throw new Error(error.message)
  return token
}

export type InviteClub = { id: string; name: string; logo_url: string | null }

/** Klubben bak lenken, eller null når tokenet er ukjent eller byttet ut. */
export async function resolveClubInvite(db: Db, token: string): Promise<InviteClub | null> {
  if (!isInviteTokenShape(token)) return null

  const { data: invite, error } = await db
    .from('club_artist_invites')
    .select('club_id')
    .eq('token', token)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!invite) return null

  const { data: club, error: clubError } = await db
    .from('clubs')
    .select('id, name, logo_url')
    .eq('id', invite.club_id)
    .maybeSingle()
  if (clubError) throw new Error(clubError.message)
  return club ?? null
}

export type JoinResult =
  | { status: 'joined'; club: InviteClub }
  | { status: 'already'; club: InviteClub }
  | { status: 'invalid' }

/**
 * Legger komikeren på listen til klubben bak lenken.
 *
 * Trygt å kalle flere ganger: står komikeren alt der — fordi hen trykket to
 * ganger, eller fordi klubben hentet hen fra katalogen — skjer ingenting, og
 * rollene klubben har satt blir stående.
 *
 * Rollene er komikerens egne fra registreringen. Klubben kan endre dem, men
 * uten noen rolle matcher komikeren ingen show-krav og ville stått usynlig i
 * booking — derfor stand-up når komikeren ikke har oppgitt noe.
 */
export async function joinClubViaInvite(db: Db, artistId: string, token: string): Promise<JoinResult> {
  const club = await resolveClubInvite(db, token)
  if (!club) return { status: 'invalid' }

  const { data: artist, error } = await db
    .from('artists')
    .select('category')
    .eq('id', artistId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!artist) return { status: 'invalid' }

  const { added } = await addArtistToClub(db, {
    clubId: club.id,
    artistId,
    category: inviteRoles(artist.category),
    joinedViaInvite: true,
    keepExisting: true,
  })

  return { status: added ? 'joined' : 'already', club }
}

export function inviteRoles(category: string[] | null | undefined): ArtistType[] {
  const roles = canonicalRoleValues(category ?? [])
  return roles.length > 0 ? roles : ['stand-up']
}

/** Om komikeren står på klubbens liste — for å vise riktig knapp på lenken. */
export async function isOnClubRoster(db: Db, clubId: string, artistId: string): Promise<boolean> {
  const { data, error } = await db
    .from('club_artists')
    .select('id')
    .eq('club_id', clubId)
    .eq('artist_id', artistId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

/** Hvor mange på klubbens liste som kom inn via lenken. */
export async function countInviteJoins(db: Db, clubId: string): Promise<number> {
  const { count, error } = await db
    .from('club_artists')
    .select('id', { count: 'exact', head: true })
    .eq('club_id', clubId)
    .eq('joined_via_invite', true)
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function readToken(db: Db, clubId: string): Promise<string | null> {
  const { data, error } = await db
    .from('club_artist_invites')
    .select('token')
    .eq('club_id', clubId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.token ?? null
}
