import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import type { Database } from '@/types/database'
import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/supabase/env'

type CookieOptions = Parameters<NextResponse['cookies']['set']>[2]
type ResponseCookie = { name: string; value: string; options: CookieOptions }

function createServerSupabaseClient(
  readCookies: () => ReturnType<Awaited<ReturnType<typeof cookies>>['getAll']>,
  writeCookies: (cookiesToSet: ResponseCookie[]) => void,
) {
  return createServerClient<Database>(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        getAll() {
          return readCookies()
        },
        setAll(cookiesToSet) {
          writeCookies(
            cookiesToSet.map(({ name, value, options }) => ({ name, value, options })),
          )
        },
      },
    },
  )
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerSupabaseClient(
    () => cookieStore.getAll(),
    (cookiesToSet) => {
      try {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options)
        })
      } catch {
        // Called from a Server Component — cookies can't be set
      }
    },
  )
}

export async function createRouteHandlerClient() {
  const cookieStore = await cookies()
  const responseCookies: ResponseCookie[] = []

  const supabase = createServerSupabaseClient(
    () => cookieStore.getAll(),
    (cookiesToSet) => {
      try {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options)
        })
      } catch {
        // Route handlers should allow this, but keep parity with createClient().
      }
      responseCookies.push(...cookiesToSet)
    },
  )

  return {
    supabase,
    hasSessionCookies() {
      return responseCookies.some(({ name, value }) => value && name.startsWith('sb-'))
    },
    withSessionCookies(response: NextResponse) {
      responseCookies.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options)
      })
      return response
    },
  }
}

export async function waitForSignedInCookies(
  supabase: Awaited<ReturnType<typeof createRouteHandlerClient>>['supabase'],
) {
  await new Promise<void>((resolve) => {
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      subscription.unsubscribe()
      resolve()
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        queueMicrotask(finish)
      }
    })

    setTimeout(finish, 3_000)
  })
}
