import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getArtistForAuthUser } from '@/lib/session'
import { inviteJoinPath, joinClubViaInvite } from '@/lib/club-invite'

/**
 * Siste steg av invitasjonslenken: legger den innloggede komikeren på
 * klubbens liste og sender hen tilbake til lenken, som nå viser utfallet.
 *
 * Registreringen og innloggingen sender hit som `next`, så tokenet følger
 * med uten egne felt i skjemaene. Det er en GET, og det er bevisst: den gjør
 * ikke mer enn klubben selv kan gjøre fra katalogen, og den gjør det samme om
 * den kalles én eller ti ganger.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const origin = `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host') ?? new URL(request.url).host}`
  const back = NextResponse.redirect(new URL(inviteJoinPath(token), origin), 303)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return back

  const artist = await getArtistForAuthUser(user.id)
  if (!artist) return back

  try {
    await joinClubViaInvite(createAdminClient(), artist.id, token)
  } catch (error) {
    // Kontoen finnes uansett. Lenken viser «Join»-knappen igjen, så
    // komikeren kan prøve på nytt uten å registrere seg en gang til.
    console.error('[Invite] Could not join club:', error)
  }

  return back
}
