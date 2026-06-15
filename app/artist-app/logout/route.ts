import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@/lib/supabase/server'

async function signOutAndRedirect(request: Request) {
  const origin = `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host') ?? new URL(request.url).host}`
  const { supabase, withSessionCookies } = await createRouteHandlerClient()
  await supabase.auth.signOut()
  return withSessionCookies(NextResponse.redirect(new URL('/artist-app/login', origin)))
}

export async function GET(request: Request) {
  const origin = `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host') ?? new URL(request.url).host}`
  return NextResponse.redirect(new URL('/artist-app/login', origin))
}

export async function POST(request: Request) {
  return signOutAndRedirect(request)
}