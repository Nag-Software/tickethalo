'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const Logo = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14" className={className}>
    <path
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="0.5"
      fillRule="evenodd"
      d="M1.83645 1.83645C3.06046 0.612432 4.82797 0 7 0s3.9395 0.612432 5.1636 1.83645C13.3876 3.06046 14 4.82797 14 7s-0.6124 3.9395-1.8364 5.1636C10.9395 13.3876 9.17203 14 7 14s-3.93954-0.6124-5.16355-1.8364C0.612432 10.9395 0 9.17203 0 7s0.612432-3.93954 1.83645-5.16355ZM5.0769 4.98816c0-0.34518-0.27982-0.625-0.625-0.625-0.34517 0-0.625 0.27982-0.625 0.625v0.7c0 0.34518 0.27983 0.625 0.625 0.625 0.34518 0 0.625-0.27982 0.625-0.625v-0.7Zm5.0962 0c0-0.34518-0.27983-0.625-0.625-0.625-0.34518 0-0.625 0.27982-0.625 0.625v0.7c0 0.34518 0.27982 0.625 0.625 0.625 0.34517 0 0.625-0.27982 0.625-0.625v-0.7Zm0.1787 2.42929c0.3217 0.12505 0.4812 0.48724 0.3561 0.80897-0.2805 0.72182-0.75537 1.29603-1.40641 1.68306-0.64416 0.38292-1.4264 0.56282-2.30149 0.56282-0.34518 0-0.625-0.2798-0.625-0.62501 0-0.34518 0.27982-0.625 0.625-0.625 0.7083 0 1.25628-0.14564 1.66273-0.38728 0.39956-0.23753 0.69571-0.58697 0.88012-1.06143 0.12505-0.32173 0.48725-0.48117 0.80895-0.35613Z"
      clipRule="evenodd"
    />
  </svg>
)

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
      {/* Logo — oransje, ikke brun: merket er det eneste fargede i headeren.
          Blekket er den mørke teksten og ikke hvitt, fordi hvitt på #ff5b24
          bare gir 3.0:1 og ordmerket er 12px. */}
      <Link
        href="/"
        className="flex h-10 items-center gap-2 rounded-full bg-[var(--ev-accent-fill)] md:h-9 pl-1.5 pr-2.5 text-[var(--ev-text)] transition-transform duration-200 hover:scale-[1.02] md:pr-3.5"
      >
        <span className="grid size-6 text-white shrink-0 place-content-center rounded-full bg-[var(--ev-text)]/15">
          <Logo className="size-3.5" />
        </span>
        <span className="hidden text-white text-[12px] font-semibold tracking-[-0.01em] min-[360px]:block md:text-[13px]">
          Tickethalo
        </span>
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
              // Mørk og ikke oransje: logoen har tatt oransjen, og to oransje
              // piller ved siden av hverandre leser som én flate.
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
