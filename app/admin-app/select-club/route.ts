import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ADMIN_APP_CLUB_COOKIE, getClubAccess } from '@/lib/club-auth'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const clubId = url.searchParams.get('club')
  const nextPath = normalizeNext(url.searchParams.get('next'))
  const origin = `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host') ?? url.host}`

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/admin-app/login', origin), 303)
  }

  const access = await getClubAccess()
  const validClub = access.clubs.find((club) => club.id === clubId)

  if (!validClub) {
    return NextResponse.redirect(new URL('/admin-app/shows', origin), 303)
  }

  const response = NextResponse.redirect(new URL(nextPath, origin), 303)
  response.cookies.set(ADMIN_APP_CLUB_COOKIE, validClub.id, {
    path: '/admin-app',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  })
  return response
}

function normalizeNext(value: string | null) {
  if (!value) return '/admin-app/shows'
  return value.startsWith('/admin-app') ? value : '/admin-app/shows'
}