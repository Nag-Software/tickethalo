import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestPathname } from '@/lib/request-pathname'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'
import { ArtistTopbar } from '@/components/artist/artist-topbar'

export const metadata = { title: 'Komikerportal — humor.events' }

export default async function ArtistLayout({ children }: { children: React.ReactNode }) {
  const pathname = await getRequestPathname()
  const isPublicRoute = pathname.startsWith('/artist-app/login') || pathname.startsWith('/artist-app/signup')

  if (isPublicRoute) return children

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    if (pathname === '/artist-app' || pathname === '/artist-app/') return children
    redirect(`/artist-app/login?next=${encodeURIComponent(pathname)}`)
  }

  const destination = await getPortalDestinationForAuthUser(user.id)
  if (destination && destination !== '/artist-app' && !destination.startsWith('/artist-app?') && !destination.startsWith('/artist-app/')) {
    redirect(destination)
  }

  const db = createAdminClient()
  const { data: artist } = await db
    .from('artists')
    .select('full_name, stage_name, email, status')
    .eq('auth_user_id', user.id)
    .single()

  if (!artist) redirect('/artist-app/signup?error=missing')

  return (
    <div
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <ArtistTopbar name={artist.stage_name ?? artist.full_name} email={artist.email} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-7 px-4 py-7 md:px-6 md:py-9 lg:px-8">
        {children}
      </main>
    </div>
  )
}
