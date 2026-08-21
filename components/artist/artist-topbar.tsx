'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { label: 'Oversikt', href: '/artist-app', exact: true },
  { label: 'Bookinger', href: '/artist-app/bookings' },
  { label: 'Utbetaling', href: '/artist-app/economy' },
  { label: 'Profil', href: '/artist-app/profile' },
]

export function ArtistTopbar({ name, email }: { name: string; email: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href || pathname === `${href}/` : pathname.startsWith(href)

  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <header className="ev-surface sticky top-0 z-40 border-b border-[var(--ev-line)] bg-[var(--ev-bg)]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-6 lg:px-8">
        <Link
          href="/artist-app"
          className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-[var(--ev-text)] pl-3 pr-3.5 text-[var(--ev-bg)] transition-transform duration-200 hover:scale-[1.02]"
        >
          <span className="text-[12.5px] font-semibold tracking-[-0.01em]">Tickethalo</span>
          <span className="text-[11px] text-[var(--ev-bg)]/60">Portal</span>
        </Link>

        {/* Lenkene som én segmentert pille, som på de offentlige sidene */}
        <nav className="hidden items-center gap-0.5 rounded-full bg-[var(--ev-card)] p-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href, item.exact) ? 'page' : undefined}
              className={cn(
                'flex h-7 items-center rounded-full px-3.5 text-[12.5px] font-medium transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
                isActive(item.href, item.exact)
                  ? 'bg-[var(--ev-accent-fill)] text-[var(--ev-accent-ink)]'
                  : 'text-[var(--ev-muted)] hover:bg-[var(--ev-card-hover)] hover:text-[var(--ev-text)]'
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden max-w-[180px] truncate text-[13px] text-[var(--ev-muted)] lg:inline">
            {name}
          </span>

          <form action="/artist-app/logout" method="post" className="hidden md:block">
            <button
              type="submit"
              className="flex size-9 items-center justify-center rounded-full text-[var(--ev-muted)] transition-colors hover:bg-[var(--ev-card-hover)] hover:text-[var(--ev-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]"
              aria-label="Logg ut"
              title="Logg ut"
            >
              <LogOut className="size-4" />
            </button>
          </form>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? 'Lukk meny' : 'Åpne meny'}
            className="grid size-9 shrink-0 place-content-center rounded-full bg-[var(--ev-card)] text-[12px] font-semibold text-[var(--ev-muted)] transition-colors hover:bg-[var(--ev-card-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] md:hidden"
          >
            {initials || '·'}
          </button>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-t border-[var(--ev-line)] px-4 py-2 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href, item.exact) ? 'page' : undefined}
            className={cn(
              'flex h-9 shrink-0 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors',
              isActive(item.href, item.exact)
                ? 'bg-[var(--ev-accent-fill)] text-[var(--ev-accent-ink)]'
                : 'text-[var(--ev-muted)] hover:bg-[var(--ev-card)] hover:text-[var(--ev-text)]'
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Mobilmeny — utvider headeren i stedet for å dekke hele skjermen,
          fordi portalen er et arbeidsverktøy og konteksten bør bli stående. */}
      {open && (
        <div className="border-t border-[var(--ev-line)] px-4 pb-4 pt-3 md:hidden">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[13px] text-[var(--ev-faint)]">{email}</span>
            <form action="/artist-app/logout" method="post">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)]"
              >
                <LogOut className="size-4" /> Logg ut
              </button>
            </form>
          </div>
        </div>
      )}
    </header>
  )
}
