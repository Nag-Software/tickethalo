import { randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { appPath } from '@/lib/app-url'
import { insertArtistProfile } from '@/lib/artist-profile-insert'
import { isEmail, type ArtistProfileFields } from '@/lib/artist-signup-form'
import { sendComedianLoginEmail } from '@/lib/email/mailer'
import { isClubRole } from '@/lib/portal-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Role } from '@/types/database'

/**
 * Komikerprofil på klubbinnloggingen.
 *
 * De fleste klubbeiere står også på scenen. I stedet for to innlogginger
 * eier samme auth-bruker begge sidene: klubben gjennom profilrollen og
 * `club_memberships`, komikeren gjennom `artists.auth_user_id`. Koblingen er
 * alltid per innlogging, aldri per klubb — en medadmin i samme klubb ser
 * ingenting av den.
 *
 * Tre veier:
 *  - `createComedianProfileForUser`: eieren har ingen komikerprofil fra før,
 *    og får en ny på innloggingen hen bruker.
 *  - `linkExistingComedianAccount`: eieren har en komikerkonto fra før. Hen
 *    beviser det med kontoens passord (aldri bare en lik e-post), profilen
 *    flyttes over, og den gamle innloggingen sperres — ikke slettes, så
 *    koblingen kan gjøres om.
 *  - `disconnectComedianProfile`: profilen får sin egen innlogging igjen —
 *    den gamle, med sitt gamle passord, eller en ny med en set-password-lenke
 *    når profilen ble laget her.
 *
 * Alle flyttinger av `auth_user_id` er betingede (`… and auth_user_id = gammel`),
 * så to samtidige forsøk aldri kan flytte samme profil to ganger, og den unike
 * delindeksen fra migrasjon 080 stopper to profiler på én innlogging.
 */

export type ComedianLinkErrorCode =
  | 'not_club_login'
  | 'already_has_profile'
  | 'invalid_credentials'
  | 'linked_to_other_club_login'
  | 'no_comedian_profile'
  | 'not_linked'
  | 'email_required'
  | 'email_invalid'
  | 'email_same_as_login'
  | 'email_taken'
  | 'conflict'
  | 'failed'

export type ComedianLinkResult<T = object> = ({ ok: true } & T) | { ok: false; code: ComedianLinkErrorCode }

export type CurrentLogin = {
  authUserId: string
  email: string
  role: Role | null | undefined
}

/** Så lenge koblingen står. `none` opphever sperren igjen. */
const BANNED_UNTIL_DISCONNECTED = '876000h'

const UNIQUE_VIOLATION = '23505'

function fail(code: ComedianLinkErrorCode): { ok: false; code: ComedianLinkErrorCode } {
  return { ok: false, code }
}

type ArtistLoginRow = {
  id: string
  auth_user_id: string | null
  full_name: string
  stage_name: string | null
  email: string
  linked_from_auth_user_id: string | null
}

async function findArtistByLogin(authUserId: string): Promise<ArtistLoginRow | null> {
  const { data } = await createAdminClient()
    .from('artists')
    .select('id, auth_user_id, full_name, stage_name, email, linked_from_auth_user_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  return (data as ArtistLoginRow | null) ?? null
}

async function readArtistLogin(artistId: string): Promise<string | null> {
  const { data } = await createAdminClient().from('artists').select('auth_user_id').eq('id', artistId).maybeSingle()
  return (data as { auth_user_id: string | null } | null)?.auth_user_id ?? null
}

/**
 * Flytter profilen fra én innlogging til en annen, men bare om den fortsatt
 * står på den vi tror. `moved: false` betyr at noen kom først.
 */
async function moveArtistLogin(input: {
  artistId: string
  from: string
  to: string
  linkedFrom: string | null
  email?: string
}): Promise<{ moved: boolean; errorCode?: string }> {
  const { data, error } = await createAdminClient()
    .from('artists')
    .update({
      auth_user_id: input.to,
      linked_from_auth_user_id: input.linkedFrom,
      ...(input.email ? { email: input.email } : {}),
    })
    .eq('id', input.artistId)
    .eq('auth_user_id', input.from)
    .select('id')

  if (error) return { moved: false, errorCode: error.code ?? 'unknown' }
  return { moved: (data ?? []).length > 0 }
}

/**
 * Sjekker passordet mot en egen klient uten lagret sesjon, så brukerens egen
 * innloggingscookie aldri røres.
 */
async function verifyPassword(email: string, password: string): Promise<{ userId: string; accessToken: string | null } | null> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  )
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) return null
  return { userId: data.user.id, accessToken: data.session?.access_token ?? null }
}

/** Ny komikerprofil på innloggingen brukeren alt har. */
export async function createComedianProfileForUser(
  current: CurrentLogin,
  input: { email: string; profile: ArtistProfileFields }
): Promise<ComedianLinkResult<{ artistId: string }>> {
  if (!isClubRole(current.role)) return fail('not_club_login')
  if (await findArtistByLogin(current.authUserId)) return fail('already_has_profile')

  try {
    const artist = await insertArtistProfile(createAdminClient(), {
      authUserId: current.authUserId,
      email: input.email,
      profile: input.profile,
    })
    return { ok: true, artistId: artist.id }
  } catch (error) {
    // Dobbeltklikk: den første lagde profilen, delindeksen stoppet den andre.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return fail('already_has_profile')
    throw error
  }
}

/** Flytter en eksisterende komikerprofil over på klubbinnloggingen. */
export async function linkExistingComedianAccount(
  current: CurrentLogin,
  credentials: { email: string; password: string }
): Promise<ComedianLinkResult<{ artistId: string }>> {
  if (!isClubRole(current.role)) return fail('not_club_login')
  if (await findArtistByLogin(current.authUserId)) return fail('already_has_profile')

  const email = credentials.email.trim().toLowerCase()
  if (!email || !credentials.password) return fail('invalid_credentials')

  const verified = await verifyPassword(email, credentials.password)
  if (!verified) return fail('invalid_credentials')

  const oldUserId = verified.userId
  // Brukeren skrev inn klubbinnloggingen sin. Den har ingen komikerprofil
  // (sjekket over), så det finnes ingenting å koble.
  if (oldUserId === current.authUserId) return fail('no_comedian_profile')

  const admin = createAdminClient()

  // En klubbinnlogging eier sine egne klubber. Den sperres aldri herfra,
  // selv om den har en komikerprofil — den må kobles fra der den står.
  const { data: oldProfile } = await admin.from('profiles').select('role').eq('auth_user_id', oldUserId).maybeSingle()
  const oldRole = (oldProfile as { role: Role } | null)?.role
  if (isClubRole(oldRole) || oldRole === 'superadmin') return fail('linked_to_other_club_login')

  const artist = await findArtistByLogin(oldUserId)
  if (!artist) return fail('no_comedian_profile')

  const move = await moveArtistLogin({ artistId: artist.id, from: oldUserId, to: current.authUserId, linkedFrom: oldUserId })
  if (move.errorCode === UNIQUE_VIOLATION) return fail('already_has_profile')
  if (move.errorCode) return fail('failed')
  if (!move.moved) {
    // Et samtidig forsøk fra samme bruker kom først — da er målet nådd.
    return (await readArtistLogin(artist.id)) === current.authUserId
      ? { ok: true, artistId: artist.id }
      : fail('conflict')
  }

  const { error: banError } = await admin.auth.admin.updateUserById(oldUserId, { ban_duration: BANNED_UNTIL_DISCONNECTED })
  if (banError) {
    // Uten sperren ville den gamle innloggingen stått igjen uten profil, og
    // «missing profile» er ikke et svar noen forstår. Flytt tilbake.
    console.error(`[ComedianLink] Could not disable the old comedian login ${oldUserId}: ${banError.message}`)
    await moveArtistLogin({ artistId: artist.id, from: current.authUserId, to: oldUserId, linkedFrom: null })
    return fail('failed')
  }

  // Sesjonen vi nettopp åpnet for å sjekke passordet, og alle andre den
  // gamle innloggingen har. Sperren stopper nye; dette tar de som finnes.
  if (verified.accessToken) {
    const { error: signOutError } = await admin.auth.admin.signOut(verified.accessToken, 'global')
    if (signOutError) console.error(`[ComedianLink] Could not sign out the old comedian login ${oldUserId}: ${signOutError.message}`)
  }

  return { ok: true, artistId: artist.id }
}

/**
 * Gir komikerprofilen sin egen innlogging igjen.
 *
 * Var profilen koblet fra en egen komikerkonto, får den kontoen profilen
 * tilbake og sperren opphevet — komikeren logger inn med det gamle passordet.
 * Ble den laget her, finnes det ingen gammel innlogging: da lages en ny på
 * `newEmail`, og komikeren får en lenke som setter passordet.
 */
export async function disconnectComedianProfile(
  current: CurrentLogin,
  input: { newEmail?: string | null } = {}
): Promise<ComedianLinkResult<{ restoredLogin: boolean; loginEmail: string | null; emailSent: boolean }>> {
  const artist = await findArtistByLogin(current.authUserId)
  if (!artist) return fail('not_linked')

  const admin = createAdminClient()

  if (artist.linked_from_auth_user_id) {
    const oldUserId = artist.linked_from_auth_user_id
    const { data: old } = await admin.auth.admin.getUserById(oldUserId)

    if (old?.user) {
      const move = await moveArtistLogin({ artistId: artist.id, from: current.authUserId, to: oldUserId, linkedFrom: null })
      if (move.errorCode) return fail('failed')
      if (!move.moved) return fail('conflict')

      const { error: unbanError } = await admin.auth.admin.updateUserById(oldUserId, { ban_duration: 'none' })
      if (unbanError) {
        console.error(`[ComedianLink] Could not re-enable the comedian login ${oldUserId}: ${unbanError.message}`)
        await moveArtistLogin({ artistId: artist.id, from: oldUserId, to: current.authUserId, linkedFrom: oldUserId })
        return fail('failed')
      }

      return { ok: true, restoredLogin: true, loginEmail: old.user.email ?? null, emailSent: false }
    }
    // Den gamle innloggingen er slettet siden. Da er det som om profilen
    // ble laget her.
  }

  const email = (input.newEmail ?? '').trim().toLowerCase()
  if (!email) return fail('email_required')
  if (!isEmail(email)) return fail('email_invalid')
  if (email === current.email.trim().toLowerCase()) return fail('email_same_as_login')

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: randomBytes(32).toString('base64url'),
    email_confirm: true,
  })
  if (createError || !created.user) {
    if (/already (been )?registered|already exists/i.test(createError?.message ?? '')) return fail('email_taken')
    console.error(`[ComedianLink] Could not create a comedian login for ${email}: ${createError?.message ?? 'no user'}`)
    return fail('failed')
  }
  const newUserId = created.user.id

  const { error: profileError } = await admin
    .from('profiles')
    .insert({ auth_user_id: newUserId, email, full_name: artist.full_name, role: 'artist' })
  const move = profileError
    ? { moved: false, errorCode: profileError.code ?? 'unknown' }
    : await moveArtistLogin({ artistId: artist.id, from: current.authUserId, to: newUserId, linkedFrom: null, email })

  if (!move.moved) {
    // Profilraden forsvinner med brukeren (`on delete cascade`).
    await admin.auth.admin.deleteUser(newUserId)
    return fail(move.errorCode ? 'failed' : 'conflict')
  }

  // Herfra står profilen på den nye innloggingen. Feiler lenken eller
  // e-posten, gir «Forgot password» i komikerportalen en ny.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email })
  if (linkError) console.error(`[ComedianLink] Could not generate a set-password link for ${email}: ${linkError.message}`)
  const hashedToken = link?.properties?.hashed_token

  let emailSent = false
  if (hashedToken) {
    const result = await sendComedianLoginEmail({
      email,
      full_name: artist.stage_name ?? artist.full_name,
      set_password_url: comedianSetPasswordUrl(hashedToken),
    })
    emailSent = result.success
  }

  return { ok: true, restoredLogin: false, loginEmail: email, emailSent }
}

/** Samme vei som klubbens velkomstlenke — se `setPasswordUrl` i `lib/club-onboarding.ts`. */
export function comedianSetPasswordUrl(hashedToken: string): string {
  const params = new URLSearchParams({ token_hash: hashedToken, type: 'recovery', next: '/artist-app/reset-password' })
  return appPath(`/artist-app/auth/callback?${params.toString()}`)
}
