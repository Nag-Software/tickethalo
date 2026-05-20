import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getRequestPathname } from '@/lib/request-pathname'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'

const navItems = [
  { label: 'Oversikt', href: '/artist-app' },
  { label: 'Tilbud', href: '/artist-app/booking-offers' },
  { label: 'Bookinger', href: '/artist-app/bookings' },
  { label: 'Profil', href: '/artist-app/profile' },
]

export const metadata = { title: 'Artistportal — humor.events' }

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
    <div className="flex min-h-svh flex-col bg-white text-black">
      <ArtistTopbar pathname={pathname} name={artist.stage_name ?? artist.full_name} />
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  )
}

function ArtistTopbar({ pathname, name }: { pathname: string; name: string }) {
  return (
    <header className="sticky top-0 z-30 border-b-2 border-zinc-950 bg-zinc-950 px-4 text-white md:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between py-4">
        <div className="flex items-center gap-4">
          <Link href="/artist-app" className="text-xl font-bold tracking-tight">
            humor.events
          </Link>
          <span className="hidden border border-white/25 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-white/75 md:inline-flex">
            Komikerportal
          </span>
        </div>
        <nav className="flex items-center gap-5 text-sm text-white/55">
          {navItems.map((item) => {
            const active = item.href === '/artist-app'
              ? pathname === '/artist-app' || pathname === '/artist-app/'
              : pathname.startsWith(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? 'font-medium text-[#ff6bff] transition-colors' : 'transition-colors hover:text-white'}
              >
                {item.label}
              </Link>
            )
          })}
        </nav>
        <span className="hidden text-sm text-white/40 md:inline">{name}</span>
      </div>
    </header>
  )
}