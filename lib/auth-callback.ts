import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * To veier inn:
 *  - `code`: «Glemt passord» startet i nettleseren (PKCE), og Supabase sender
 *    brukeren hit med en kode som byttes mot en sesjon.
 *  - `token_hash` + `type`: lenker vi lager selv på serveren, som
 *    velkomst-e-posten til en ny klubb (`lib/club-onboarding.ts`). De har
 *    ingen code verifier i nettleseren, så tokenet verifiseres direkte.
 */
export async function handleAuthCallback(request: Request, portalPrefix: string) {
  const url = new URL(request.url)
  const next = normalizeNext(url.searchParams.get('next'), portalPrefix)
  const code = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const type = otpType(url.searchParams.get('type'))

  if (!code && !(tokenHash && type)) return redirectTo(url, `${portalPrefix}/forgot-password?error=callback`)

  const supabase = await createClient()
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ type: type!, token_hash: tokenHash! })

  if (error) return redirectTo(url, `${portalPrefix}/forgot-password?error=callback`)
  return redirectTo(url, next)
}

type OtpType = 'recovery' | 'invite' | 'magiclink'

function otpType(value: string | null): OtpType | null {
  return value === 'recovery' || value === 'invite' || value === 'magiclink' ? value : null
}

function normalizeNext(value: string | null, portalPrefix: string) {
  return value?.startsWith(`${portalPrefix}/`) ? value : `${portalPrefix}/reset-password`
}

function redirectTo(url: URL, path: string) {
  return NextResponse.redirect(new URL(path, url.origin))
}