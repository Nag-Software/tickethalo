import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { needsSessionRefresh } from '@/lib/session-cookie'

function getSupabaseAuthCookieValue(request: NextRequest) {
  // Store sesjoner deles i `…-auth-token.0`, `.1`. Navnene sorterer riktig
  // så lenge det er under ti biter, og det er det alltid.
  const chunks = request.cookies
    .getAll()
    .filter(({ name }) => name.startsWith('sb-') && name.includes('-auth-token'))
    .sort((a, b) => a.name.localeCompare(b.name))

  if (chunks.length === 0) return null
  return chunks.map(({ value }) => value).join('')
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

/**
 * Routes that hold no content of their own and only forward somewhere else,
 * keyed and valued by their internal (non-subdomain) path.
 *
 * These hops belong here, ahead of rendering, rather than in a `page.tsx` that
 * calls `redirect()`. A page and its layout render in the same RSC pass, so a
 * redirecting page underneath a portal's auth gate puts two competing
 * redirects into one flight payload — the target of the page's redirect and
 * the login screen — and the router refetches forever instead of committing.
 */
const SECTION_INDEXES: Record<string, string> = {
  '/admin-app': '/admin-app/shows',
  '/admin-app/artist-economy': '/admin-app/shows',
  // Renamed when the club portal moved to English. Kept so links people
  // already have keep landing on the right page.
  '/admin-app/min-klubb': '/admin-app/my-club',
  '/admin-app/okonomi': '/admin-app/finances',
  '/superadmin': '/superadmin/clubs',
  '/artist-app/settings': '/artist-app/profile',
  '/artist-app/booking-offers': '/artist-app/bookings',
  '/artist-app/invoices': '/artist-app',
}

function stripTrailingSlash(value: string) {
  return value.length > 1 && value.endsWith('/') ? value.slice(0, -1) : value
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const host = request.headers.get('host') ?? request.nextUrl.host
  const hostname = host.split(':')[0]
  const requestHeaders = new Headers(request.headers)
  const isApiPath = pathname === '/api' || pathname.startsWith('/api/')

  const isAdminHost = hostname === 'admin.localhost' || hostname.startsWith('admin.')
  const isArtistHost = hostname === 'artist.localhost' || hostname.startsWith('artist.')

  // The portals answer both at `/admin-app/…` and, through their own
  // subdomain, at `/…`. Resolve to the internal path so SECTION_INDEXES is
  // written once, then send the visitor to the target as *they* address it.
  const barePathname = stripTrailingSlash(pathname)
  const hostPrefix = isAdminHost ? '/admin-app' : isArtistHost ? '/artist-app' : ''
  const isHostScoped = hostPrefix !== '' && !barePathname.startsWith(hostPrefix)
  const internalPathname = isHostScoped
    ? `${hostPrefix}${barePathname === '/' ? '' : barePathname}`
    : barePathname

  const indexTarget = SECTION_INDEXES[internalPathname]
  if (indexTarget && !isApiPath) {
    const url = request.nextUrl.clone()
    url.pathname = isHostScoped ? indexTarget.slice(hostPrefix.length) || '/' : indexTarget
    return NextResponse.redirect(url)
  }

  let resolvedPathname = pathname
  let response = NextResponse.next({ request: { headers: requestHeaders } })

  requestHeaders.set('x-tickethalo-visible-pathname', pathname)
  requestHeaders.set('x-tickethalo-hostname', hostname)

  if ((hostname === 'admin.localhost' || hostname.startsWith('admin.')) && !pathname.startsWith('/admin-app') && !isApiPath) {
    const url = request.nextUrl.clone()
    url.pathname = `/admin-app${pathname}`
    resolvedPathname = url.pathname
    requestHeaders.set('x-tickethalo-pathname', resolvedPathname)
    response = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  } else if ((hostname === 'artist.localhost' || hostname.startsWith('artist.')) && !pathname.startsWith('/artist-app') && !isApiPath) {
    const url = request.nextUrl.clone()
    url.pathname = `/artist-app${pathname}`
    resolvedPathname = url.pathname
    requestHeaders.set('x-tickethalo-pathname', resolvedPathname)
    response = NextResponse.rewrite(url, { request: { headers: requestHeaders } })
  } else {
    requestHeaders.set('x-tickethalo-pathname', resolvedPathname)
    response = NextResponse.next({ request: { headers: requestHeaders } })
  }

  const authCookie = getSupabaseAuthCookieValue(request)

  if (authCookie && needsSessionRefresh(authCookie)) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) =>
              request.cookies.set(name, value)
            )
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
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