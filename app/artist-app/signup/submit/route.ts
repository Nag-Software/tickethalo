import { NextResponse } from 'next/server'
import { registerArtist } from '@/lib/actions/artist'
import { createClient } from '@/lib/supabase/server'
import { parseArtistSignupForm, toSignupErrorCode } from '@/lib/artist-signup-form'
import { signupNext } from '../next'

const signupPath = '/artist-app/signup'

export async function POST(request: Request) {
  const origin = `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host') ?? new URL(request.url).host}`
  const formData = await request.formData()
  const next = signupNext(String(formData.get('next') ?? ''))

  try {
    const { email, password = '', profile } = await parseArtistSignupForm(formData, 'new-account')

    await registerArtist({ email, password, ...profile })

    const supabase = await createClient()
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      console.error('Artist signup succeeded but automatic sign-in failed:', signInError)
      const login = `/artist-app/login?error=signup_login${next ? `&next=${encodeURIComponent(next)}` : ''}`
      return NextResponse.redirect(new URL(login, origin), 303)
    }

    return NextResponse.redirect(new URL(next ?? '/artist-app', origin), 303)
  } catch (error) {
    console.error(error)
    const code = toSignupErrorCode(error)
    const retry = `${signupPath}?error=${code}${next ? `&next=${encodeURIComponent(next)}` : ''}`
    return NextResponse.redirect(new URL(retry, origin), 303)
  }
}
