import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'
import { LAST_PORTAL_COOKIE, parsePortalSide } from '@/lib/portal-side'

export async function POST(request: Request) {
  const origin = `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host') ?? new URL(request.url).host}`
  const adminPrefix = '/admin-app'
  const formData = await request.formData()
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return NextResponse.redirect(new URL(`${adminPrefix}/login?error=invalid`, origin), 303)
  }

  // En klubbeier som også er komiker lander der hen var sist.
  const lastPortal = parsePortalSide((await cookies()).get(LAST_PORTAL_COOKIE)?.value)
  const destination = await getPortalDestinationForAuthUser(data.user.id, lastPortal)
  if (!destination) {
    return NextResponse.redirect(new URL(`${adminPrefix}/login?error=unauthorized`, origin), 303)
  }

  if (destination === '/superadmin') {
    return NextResponse.redirect(new URL(adminPrefix, origin), 303)
  }

  return NextResponse.redirect(new URL(destination, origin), 303)
}
