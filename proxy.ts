import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/supabase/env'

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(({ name }) => name.startsWith('sb-'))
}

/**
 * Decodes an sb-*-auth-token cookie value into its session JSON.
 * Format: optional "base64-" prefix + base64url-encoded JSON (older clients
 * stored plain JSON). Returns null if the value can't be decoded.
 */
function decodeSupabaseSessionCookie(value: string): Record<string, unknown> | null {
  try {
    let json = value
    if (value.startsWith('base64-')) {
      const b64 = value
        .slice('base64-'.length)
        .replace(/-/g, '+')
        .replace(/_/g, '/')
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
      json = atob(padded)
    }
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Reads expires_at (unix seconds) from the Supabase auth-token cookie without
 * a network call. Handles chunked cookies (sb-...-auth-token.0, .1, ... joined
 * in numeric order). Returns null when the token can't be located or parsed —
 * callers must treat null as "needs refresh" (fail-safe).
 */
function getSessionExpiresAt(request: NextRequest): number | null {
  const chunksByBase = new Map<string, Map<number, string>>()

  for (const { name, value } of request.cookies.getAll()) {
    const match = name.match(/^(sb-.+-auth-token)(?:\.(\d+))?$/)
    if (!match) continue
    const base = match[1]
    const index = match[2] === undefined ? -1 : Number(match[2])
    const chunks = chunksByBase.get(base) ?? new Map<number, string>()
    chunks.set(index, value)
    chunksByBase.set(base, chunks)
  }

  if (chunksByBase.size === 0) return null

  let earliestExpiry: number | null = null

  for (const chunks of chunksByBase.values()) {
    // Unchunked cookie (index -1) wins; otherwise join chunks in numeric order.
    const value = chunks.has(-1)
      ? chunks.get(-1)!
      : [...chunks.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, chunk]) => chunk)
          .join('')

    const session = decodeSupabaseSessionCookie(value)
    const expiresAt = session?.expires_at
    if (typeof expiresAt !== 'number') return null

    if (earliestExpiry === null || expiresAt < earliestExpiry) {
      earliestExpiry = expiresAt
    }
  }

  return earliestExpiry
}

function isTimeoutError(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const maybeError = error as {
    name?: unknown
    message?: unknown
    code?: unknown
  }

  return (
    maybeError.name === 'TimeoutError' ||
    maybeError.code === 23 ||
    (typeof maybeError.message === 'string' &&
      /aborted due to timeout|timed out|timeout/i.test(maybeError.message))
  )
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const host = request.headers.get('host') ?? request.nextUrl.host
  const hostname = host.split(':')[0]
  const requestHeaders = new Headers(request.headers)
  const isApiPath = pathname === '/api' || pathname.startsWith('/api/')

  let resolvedPathname = pathname
  let response = NextResponse.next({ request: { headers: requestHeaders } })

  requestHeaders.set('x-humor-visible-pathname', pathname)
  requestHeaders.set('x-humor-hostname', hostname)

  if ((hostname === 'admin.localhost' || hostname.startsWith('admin.')) && !pathname.startsWith('/admin-app') && !isApiPath) {
    const url = request.nextUrl.clone()
    url.pathname = `/admin-app${pathname}`
    resolvedPathname = url.pathname
    requestHeaders.set('x-humor-pathname', resolvedPathname)
    response = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  } else if ((hostname === 'artist.localhost' || hostname.startsWith('artist.')) && !pathname.startsWith('/artist-app') && !isApiPath) {
    const url = request.nextUrl.clone()
    url.pathname = `/artist-app${pathname}`
    resolvedPathname = url.pathname
    requestHeaders.set('x-humor-pathname', resolvedPathname)
    response = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  } else {
    requestHeaders.set('x-humor-pathname', resolvedPathname)
    response = NextResponse.next({ request: { headers: requestHeaders } })
  }

  // The getUser() call below exists ONLY to refresh the Supabase session cookie
  // (server components can't write cookies, so refresh must happen here). It is
  // NOT the security boundary — layouts/pages verify auth on every render. So we
  // skip the network roundtrip when the local token is verifiably fresh: if the
  // cookie parses and expires_at is more than 120s away, no refresh is needed.
  // Any parse failure falls back to the refresh call (fail-safe).
  const expiresAt = hasSupabaseAuthCookie(request) ? getSessionExpiresAt(request) : null
  const tokenIsFresh =
    typeof expiresAt === 'number' && expiresAt * 1000 - Date.now() > 120_000

  if (hasSupabaseAuthCookie(request) && !tokenIsFresh) {
    const supabase = createServerClient(
      getSupabaseUrl(),
      getSupabasePublishableKey(),
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet, cacheHeaders) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            )
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
            if (cacheHeaders) {
              Object.entries(cacheHeaders).forEach(([key, value]) => {
                if (value) response.headers.set(key, value)
              })
            }
          },
        },
      }
    )

    try {
      await supabase.auth.getUser()
    } catch (error) {
      if (!isTimeoutError(error)) {
        console.error('[proxy] Supabase auth refresh failed:', error)
      }
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}