import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { NextResponse } from 'next/server'
import type { Database } from '@/types/database'

type CookieOptions = Parameters<NextResponse['cookies']['set']>[2]

function createServerSupabaseClient(
  readCookies: () => ReturnType<Awaited<ReturnType<typeof cookies>>['getAll']>,
  writeCookies: (name: string, value: string, options: CookieOptions) => void,
) {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return readCookies()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            writeCookies(name, value, options)
          })
        },
      },
    },
  )
}

export async function createClient() {
  const cookieStore = await cookies()

  return createServerSupabaseClient(
    () => cookieStore.getAll(),
    (name, value, options) => {
      try {
        cookieStore.set(name, value, options)
      } catch {
        // Called from a Server Component — cookies can't be set
      }
    },
  )
}

export async function createRouteHandlerClient() {
  const cookieStore = await cookies()
  const responseCookies: Array<{ name: string; value: string; options: CookieOptions }> = []

  const supabase = createServerSupabaseClient(
    () => cookieStore.getAll(),
    (name, value, options) => {
      try {
        cookieStore.set(name, value, options)
      } catch {
        // Route handlers should allow this, but keep parity with createClient().
      }
      responseCookies.push({ name, value, options })
    },
  )

  return {
    supabase,
    withSessionCookies(response: NextResponse) {
      responseCookies.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options)
      })
      return response
    },
  }
}
