import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies
    .getAll()
    .some(({ name }) => name.startsWith('sb-') && name.includes('-auth-token'))
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

/** Section indexes that hold no content and only forward to a default section. */
const SECTION_INDEXES: Record<string, string> = {
  '/admin-app': '/admin-app/shows',
  '/superadmin': '/superadmin/clubs',
}

/** The admin index as it is addressed through the `admin.` subdomain. */
const ADMIN_HOST_INDEXES: Record<string, string> = {
  '/': '/shows',
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

  // `/admin-app` and `/superadmin` are section indexes that hold no content of
  // their own — they only point at a default section. That hop happens here,
  // before anything renders, because a page and its layout render in the same
  // RSC pass: an index that redirects from the page while the layout's auth
  // gate redirects to the login screen puts two competing redirects in one
  // flight payload, and the router refetches forever instead of committing.
  const isAdminHost = hostname === 'admin.localhost' || hostname.startsWith('admin.')
  const barePathname = stripTrailingSlash(pathname)
  const indexTarget = isAdminHost
    ? ADMIN_HOST_INDEXES[barePathname]
    : SECTION_INDEXES[barePathname]
  if (indexTarget && !isApiPath) {
    const url = request.nextUrl.clone()
    url.pathname = indexTarget
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

  if (hasSupabaseAuthCookie(request)) {
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