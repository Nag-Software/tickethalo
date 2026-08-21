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
 * that do not sit inside such a scope (/artist-app, /booking-offer, /signup).
 * So `tone` has to be set here rather than merely inherited.
 */
export function PublicHeader({ transparent, tone = 'light' }: { transparent?: boolean; tone?: 'dark' | 'light' }) {
  void transparent
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [stuck, setStuck] = useState(false)

  // The navigation floats above the content. Once we have scrolled past the
  // hero it tightens up and gets a more defined surface beneath it.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 64)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // The menu closes from each individual link (onClick), not from an effect on
  // pathname — setState inside an effect is flagged by the react-hooks rules.

  // Lock background scroll while the fullscreen menu is open.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <>
      <nav
        className={cn(
          'ev-surface fixed left-4 z-[2000] flex items-center gap-1.5 animate-fade-in transition-[top] duration-300 md:left-8',
          stuck ? 'top-3' : 'top-6 md:top-8'
        )}
        data-tone={tone}
        style={{ animationFillMode: 'both' }}
      >
        {/* Logo — the only dark surface in the header, so the mark is the anchor */}
        <Link
          href="/"
          className="flex h-10 items-center gap-2 rounded-full bg-[var(--ev-text)] pl-2 pr-2.5 text-[var(--ev-bg)] transition-transform duration-200 hover:scale-[1.02] md:h-9 md:pl-1.5 md:pr-3.5"
        >
          <span className="grid size-6 shrink-0 place-content-center rounded-full bg-[var(--ev-bg)]/15">
            <Logo className="size-3.5" />
          </span>
          <span className="hidden text-[12.5px] font-semibold tracking-[-0.01em] sm:block">
            Tickethalo
          </span>
        </Link>

        {/* The links as one segmented pill */}
        <div
          className={cn(
            'hidden items-center gap-0.5 rounded-full p-1 ring-1 ring-inset transition-colors duration-300 md:flex',
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
                'flex h-7 items-center rounded-full px-3 text-[12.5px] font-medium transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
                isActive(link.href)
                  ? 'bg-[var(--ev-accent-fill)] text-[var(--ev-accent-ink)]'
                  : 'text-[var(--ev-muted)] hover:bg-[var(--ev-card-hover)] hover:text-[var(--ev-text)]'
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Mobile button */}
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className={cn(
            'flex size-11 items-center justify-center rounded-full ring-1 ring-inset transition-colors md:hidden',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
            stuck
              ? 'bg-[var(--ev-bg)]/80 ring-[var(--ev-line)] backdrop-blur-md'
              : 'bg-[var(--ev-card)] ring-transparent'
          )}
        >
          <span aria-hidden className="flex flex-col items-center justify-center gap-[4px]">
            <span className="block h-[2px] w-[18px] rounded-full bg-[var(--ev-text)]" />
            <span className="block h-[2px] w-[18px] rounded-full bg-[var(--ev-text)]" />
          </span>
        </button>
      </nav>

      {/* Fullscreen menu on mobile */}
      <div
        className={cn(
          'ev-surface h-screen fixed inset-0 z-[3000] flex flex-col bg-[var(--ev-bg)] transition-opacity duration-300',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        )}
        data-tone={tone}
        aria-hidden={!open}
        onClick={(e) => {
          // Close the menu if the user clicks outside the nav links.
          if (e.target === e.currentTarget) setOpen(false)
        }}
      >
        <div className="flex items-center justify-between px-4 pt-6">
          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="flex h-10 items-center gap-2 rounded-full bg-[var(--ev-text)] pl-2 pr-4 text-[var(--ev-bg)]"
          >
            <span className="grid size-6 shrink-0 place-content-center rounded-full bg-[var(--ev-bg)]/15">
              <Logo className="size-3.5" />
            </span>
            <span className="text-[14px] font-semibold tracking-[-0.01em]">Tickethalo</span>
          </Link>

          <button
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex size-11 items-center justify-center rounded-full bg-[var(--ev-card)] transition-colors hover:bg-[var(--ev-card-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]"
          >
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path
                d="M1 1L13 13M13 1L1 13"
                stroke="var(--ev-text)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 flex-col justify-center gap-1 px-4">
          {navLinks.map((link, i) => (
            <Link
              key={link.href}
              href={link.href}
              prefetch={link.prefetch}
              onClick={() => setOpen(false)}
              aria-current={isActive(link.href) ? 'page' : undefined}
              className={cn(
                'group flex items-center justify-between rounded-2xl px-4 py-4 transition-all duration-500',
                isActive(link.href) ? 'bg-[var(--ev-card)]' : 'hover:bg-[var(--ev-card)]',
                open ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
              )}
              style={{ transitionDelay: open ? `${80 + i * 70}ms` : '0ms' }}
            >
              <span className="text-[34px] font-semibold leading-none tracking-[-0.035em] text-[var(--ev-text)]">
                {link.label}
              </span>
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden
                className="shrink-0 text-[var(--ev-faint)] transition-colors group-hover:text-[var(--ev-accent)]"
              >
                <path
                  d="M4 10H16M16 10L10 4M16 10L10 16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
          ))}
        </div>

        <p
          className="px-5 pb-8 text-[15px] text-[var(--ev-faint)] transition-opacity duration-500"
          style={{ transitionDelay: open ? '340ms' : '0ms', opacity: open ? 1 : 0 }}
        >
          Norway&rsquo;s funniest nights
        </p>
      </div>
    </>
  )
}
