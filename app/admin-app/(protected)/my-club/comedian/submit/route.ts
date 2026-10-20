import { NextResponse } from 'next/server'
import { parseArtistSignupForm, toSignupErrorCode } from '@/lib/artist-signup-form'
import { createComedianProfileForUser } from '@/lib/comedian-link'
import { getAuthUser, getSessionProfile } from '@/lib/session'

const formPath = '/admin-app/my-club/comedian/new'

/**
 * «Create comedian profile» under My club. Samme skjema som den offentlige
 * registreringen, men profilen havner på innloggingen brukeren alt har.
 * Layouten beskytter ikke route handlers, så innloggingen sjekkes her.
 */
export async function POST(request: Request) {
  const origin = `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host') ?? new URL(request.url).host}`
  const redirect = (path: string) => NextResponse.redirect(new URL(path, origin), 303)

  const user = await getAuthUser()
  if (!user) return redirect('/admin-app/login')
  const profile = await getSessionProfile(user.id)

  try {
    const { email, profile: fields } = await parseArtistSignupForm(await request.formData(), 'existing-account')
    const result = await createComedianProfileForUser(
      { authUserId: user.id, email: profile?.email ?? user.email ?? '', role: profile?.role },
      { email, profile: fields }
    )

    if (!result.ok) {
      return redirect(result.code === 'already_has_profile' ? '/artist-app' : `${formPath}?error=${result.code}`)
    }

    return redirect('/artist-app')
  } catch (error) {
    console.error(error)
    return redirect(`${formPath}?error=${toSignupErrorCode(error)}`)
  }
}
