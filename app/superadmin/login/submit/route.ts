import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'

export async function POST(request: Request) {
  const origin = `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host') ?? new URL(request.url).host}`
  const formData = await request.formData()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return NextResponse.redirect(new URL('/superadmin/login?error=invalid', origin), 303)
  }

  const destination = await getPortalDestinationForAuthUser(data.user.id)
  if (!destination) {
    return NextResponse.redirect(new URL('/superadmin/login?error=unauthorized', origin), 303)
  }

  return NextResponse.redirect(new URL(destination, origin), 303)
}
