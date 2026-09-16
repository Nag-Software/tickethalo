import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function handleAuthCallback(request: Request, portalPrefix: string) {
  const url = new URL(request.url)
  const next = normalizeNext(url.searchParams.get('next'), portalPrefix)
  const code = url.searchParams.get('code')

  if (!code) return redirectTo(url, `${portalPrefix}/forgot-password?error=callback`)

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) return redirectTo(url, `${portalPrefix}/forgot-password?error=callback`)
  return redirectTo(url, next)
}

function normalizeNext(value: string | null, portalPrefix: string) {
  return value?.startsWith(`${portalPrefix}/`) ? value : `${portalPrefix}/reset-password`
}

function redirectTo(url: URL, path: string) {
  return NextResponse.redirect(new URL(path, url.origin))
}