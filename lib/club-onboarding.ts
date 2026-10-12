import { randomBytes } from 'node:crypto'
import { appPath } from '@/lib/app-url'
import { sendClubWelcomeEmail } from '@/lib/email/mailer'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Kontoen klubben logger inn med.
 *
 * Klubber kan ikke registrere seg selv i betaen: de søker, og superadmin
 * oppretter klubben. Før måtte klubben i tillegg registrere en bruker på
 * egen hånd før superadmin kunne legge den til som admin — et steg ingen
 * visste om, og «Fant ingen bruker med e-post …» var alt superadmin fikk.
 *
 * Nå lages kontoen her, i samme kall som klubben: en Supabase-bruker med et
 * tilfeldig passord ingen kjenner, en profil med rollen admin, og
 * medlemskapet i klubben. Klubben får en e-post med en lenke som setter
 * passordet — samme vei som «Glemt passord», bare at den starter hos oss.
 *
 * Finnes brukeren fra før (en komiker som også driver klubb, eller en klubb
 * som alt har én), legges bare medlemskapet til, og e-posten peker på
 * innloggingen i stedet for på passordvalget.
 */

export type ProvisionedClubAdmin = {
  /** True når kontoen ble opprettet nå; false når brukeren fantes fra før. */
  created: boolean
  profileId: string
  emailSent: boolean
  /** Hvorfor e-posten ikke gikk, når den ikke gjorde det. Kontoen finnes uansett. */
  emailError?: string
}

const SET_PASSWORD_PATH = '/admin-app/reset-password'
const LOGIN_PATH = '/admin-app/login'

/**
 * Lenken i velkomst-e-posten. Bygd av `hashed_token` fra Supabase, ikke av
 * action-lenken deres: den går via Supabase sitt verify-endepunkt og ender i
 * en PKCE-utveksling som trenger en code verifier nettleseren aldri fikk.
 * `token_hash` byttes i stedet direkte i vår callback (`lib/auth-callback.ts`).
 */
export function setPasswordUrl(hashedToken: string): string {
  const params = new URLSearchParams({ token_hash: hashedToken, type: 'recovery', next: SET_PASSWORD_PATH })
  return appPath(`/admin-app/auth/callback?${params.toString()}`)
}

/** Et passord ingen får se: klubben setter sitt eget via lenken. */
function throwawayPassword() {
  return randomBytes(32).toString('base64url')
}

export async function provisionClubAdmin(input: {
  clubId: string
  clubName: string
  email: string
}): Promise<ProvisionedClubAdmin> {
  const admin = createAdminClient()
  const email = input.email.trim().toLowerCase()

  const { data: existing } = await admin
    .from('profiles')
    .select('id, role')
    .eq('email', email)
    .maybeSingle()

  let profileId: string
  let created = false
  let hashedToken: string | null = null

  if (existing) {
    profileId = existing.id
    // Superadmin og eier beholder rollen sin; alle andre blir admin, slik
    // «Legg til admin» alltid har gjort.
    if (existing.role === 'artist' || existing.role === 'staff') {
      await admin.from('profiles').update({ role: 'admin' }).eq('id', existing.id)
    }
  } else {
    const authUserId = await createOrFindAuthUser(email)
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .insert({ auth_user_id: authUserId, email, role: 'admin' })
      .select('id')
      .single()
    if (profileError || !profile) {
      throw new Error(`Kunne ikke opprette profilen for ${email}: ${profileError?.message ?? 'ingen rad'}`)
    }
    profileId = profile.id
    created = true

    // Lenken som setter passordet. Feiler den, finnes kontoen likevel, og
    // «Glemt passord» på innloggingssiden gir klubben en ny lenke.
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email })
    if (linkError) console.error(`[ClubOnboarding] Could not generate a set-password link for ${email}: ${linkError.message}`)
    hashedToken = link?.properties?.hashed_token ?? null
  }

  const { error: membershipError } = await admin
    .from('club_memberships')
    .insert({ club_id: input.clubId, profile_id: profileId })
  // 23505: medlemskapet finnes alt. Det er målet, ikke en feil.
  if (membershipError && membershipError.code !== '23505') {
    throw new Error(`Kunne ikke gi ${email} tilgang til klubben: ${membershipError.message}`)
  }

  const result = await sendClubWelcomeEmail({
    email,
    club_name: input.clubName,
    set_password_url: hashedToken ? setPasswordUrl(hashedToken) : null,
    login_url: appPath(LOGIN_PATH),
  })

  return { created, profileId, emailSent: result.success, emailError: result.success ? undefined : result.error }
}

/**
 * Auth-brukeren for e-posten. Normalt ny; men en bruker kan finnes i Supabase
 * uten profil hos oss (en registrering som stoppet halvveis). Da gir
 * `createUser` «already registered», og ID-en hentes via en lenke i stedet —
 * `generateLink` svarer med brukeren den gjelder.
 */
async function createOrFindAuthUser(email: string): Promise<string> {
  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: throwawayPassword(),
    email_confirm: true,
  })
  if (!error && data.user) return data.user.id

  const alreadyRegistered = /already (been )?registered|already exists/i.test(error?.message ?? '')
  if (!alreadyRegistered) throw new Error(`Kunne ikke opprette brukeren for ${email}: ${error?.message ?? 'ukjent feil'}`)

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email })
  if (linkError || !link?.user) {
    throw new Error(`Brukeren ${email} finnes alt hos Supabase, men kunne ikke slås opp: ${linkError?.message ?? 'ingen bruker'}`)
  }
  return link.user.id
}
