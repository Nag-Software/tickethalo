'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BrandLogoResponsive } from '@/components/brand/brand-logo'
import { cn } from '@/lib/utils'

// `/admin-app` only ever redirects — to the login screen or, once signed in,
// to the club's default section. There is no payload worth prefetching, and a
// prefetched redirect commits as an empty screen, so we ask for none.
const navLinks = [
  { href: '/events', label: 'Events', prefetch: undefined },
  { href: '/artist-app/login', label: 'Comedian', prefetch: undefined },
  { href: '/admin-app', label: 'Comedy Club', prefetch: false },
]

/**
 * @param tone The tone of the page background behind the header.
 *
 * The header declares its own `.ev-surface`, because it is also used on pages
 * that do not sit inside such a scope (/artist-app, /booking-offer).
 * So `tone` has to be set here rather than merely inherited.
 *
 * All three links are shown at every width — with only three of them the row
 * fits on a phone, and a burger that hides three links behind a full-screen
 * overlay costs a tap for nothing. Below 360px the wordmark steps aside so
 * the links keep their room.
 */
export function PublicHeader({ transparent, tone = 'light' }: { transparent?: boolean; tone?: 'dark' | 'light' }) {
  void transparent
  const pathname = usePathname()
  const [stuck, setStuck] = useState(false)

  // The navigation floats above the content. Once we have scrolled past the
  // hero it tightens up and gets a more defined surface beneath it.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 64)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <nav
      className={cn(
        'ev-surface fixed left-4 z-[2000] flex items-center gap-1.5 animate-fade-in transition-[top] duration-300 md:left-8',
        stuck ? 'top-3' : 'top-6 md:top-8'
      )}
      data-tone={tone}
      style={{ animationFillMode: 'both' }}
    >
      {/* Logo — oransje, ikke brun: merket er det eneste fargede i headeren,
          og chippen gir det samtidig et underlag når headeren ligger over
          innhold lenger nede på siden.

          `tone="dark"` og ikke `tone={tone}`: varianten følger chippen, ikke
          siden. Fyllet er `--ev-accent-fill`, som er mørkt nok til hvitt blekk
          — og på klubbsidene bytter den token til klubbens egen farge, så et
          veldig lyst klubbmerke gir et blekt merke her. Det er samme oppførsel
          som da ordmerket var `text-white`.

          Under 360px vises bare ikonet — se BrandLogoResponsive. */}
      <Link
        href="/"
        // Fokusringen er `--ev-text` og ikke aksenten: ringen ville vært
        // usynlig i samme farge som fyllet den ligger rundt.
        className="flex h-10 items-center rounded-full bg-[var(--ev-accent-fill)] px-3 transition-transform duration-200 hover:scale-[1.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-text)] md:h-9"
      >
        <BrandLogoResponsive tone="dark" priority className="h-6" />
      </Link>

      {/* The links as one segmented pill */}
      <div
        className={cn(
          'flex items-center gap-0.5 rounded-full p-1 ring-1 ring-inset transition-colors duration-300',
          stuck
            ? 'bg-[var(--ev-bg)]/80 ring-[var(--ev-line)] backdrop-blur-md'
            : 'bg-[var(--ev-card)] ring-transparent'
        )}
      >
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            prefetch={link.prefetch}
            aria-current={isActive(link.href) ? 'page' : undefined}
            className={cn(
              'flex h-8 items-center whitespace-nowrap rounded-full px-2.5 md:h-7 text-[11.5px] font-medium transition-colors md:px-3 md:text-[12.5px]',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
              // Mørk og ikke oransje: den aktive pillen er den eneste fylte
              // flaten i headeren, og oransje her ville konkurrert med
              // aksentfargen sidene ellers bruker på handlinger.
              isActive(link.href)
                ? 'bg-[var(--ev-text)] text-[var(--ev-bg)]'
                : 'text-[var(--ev-muted)] hover:bg-[var(--ev-card-hover)] hover:text-[var(--ev-text)]'
            )}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
