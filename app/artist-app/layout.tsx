import { redirect } from 'next/navigation'
import { ArtistTopbar } from '@/components/artist/artist-topbar'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestPathname } from '@/lib/request-pathname'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

const baseNavItems = [
  { label: 'Oversikt', href: '/artist-app' },
  { label: 'Tilbud', href: '/artist-app/booking-offers' },
  { label: 'Bookinger', href: '/artist-app/bookings' },
  { label: 'Tilgjengelighet', href: '/artist-app/available-dates' },
  { label: 'Profil', href: '/artist-app/profile' },
]

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
    .select('id, full_name, stage_name, email, status')
    .eq('auth_user_id', user.id)
    .single()

  if (!artist) redirect('/artist-app/signup?error=missing')

  const { count: pendingOffers } = await db
    .from('booking_offers')
    .select('id', { count: 'exact', head: true })
    .eq('artist_id', artist.id)
    .eq('status', 'sent')

  const items = baseNavItems.map((item) =>
    item.href === '/artist-app/booking-offers'
      ? { ...item, badge: pendingOffers ?? 0 }
      : item,
  )

  return (
    <div className="flex min-h-svh flex-col bg-white text-black">
      <ArtistTopbar name={artist.stage_name ?? artist.full_name} navItems={items} />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  )
}
