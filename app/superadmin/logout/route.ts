import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const origin = `${request.headers.get('x-forwarded-proto') ?? 'http'}://${request.headers.get('host') ?? new URL(request.url).host}`
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/superadmin/login', origin))
}
