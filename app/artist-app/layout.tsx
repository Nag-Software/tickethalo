import { redirect } from 'next/navigation'
import { getRequestPathname } from '@/lib/request-pathname'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'
import { getArtistForAuthUser, getAuthUser } from '@/lib/session'
import { ArtistTopbar } from '@/components/artist/artist-topbar'

export const metadata = { title: 'Comedian Portal — Tickethalo' }

export default async function ArtistLayout({ children }: { children: React.ReactNode }) {
  const pathname = await getRequestPathname()
  const isPublicRoute = pathname.startsWith('/artist-app/login') || pathname.startsWith('/artist-app/signup')

  if (isPublicRoute) return children

  const user = await getAuthUser()

  if (!user) {
    if (pathname === '/artist-app' || pathname === '/artist-app/') return children
    redirect(`/artist-app/login?next=${encodeURIComponent(pathname)}`)
  }

  const destination = await getPortalDestinationForAuthUser(user.id)
  if (destination && destination !== '/artist-app' && !destination.startsWith('/artist-app?') && !destination.startsWith('/artist-app/')) {
    redirect(destination)
  }

  // Samme oppslag som `getPortalDestinationForAuthUser` nettopp gjorde — det
  // er cachet per request, så det koster ingen ny runde.
  const artist = await getArtistForAuthUser(user.id)

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
