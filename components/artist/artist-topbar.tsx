'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LogOut, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

type NavItem = {
  label: string
  href: string
  badge?: number
}

export function ArtistTopbar({
  name,
  navItems,
}: {
  name: string
  navItems: NavItem[]
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/artist-app" className="font-heading shrink-0 text-lg font-semibold tracking-tight">
            humor.events
          </Link>
          <span className="hidden rounded-full border border-border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground sm:inline-flex">
            Komiker
          </span>
        </div>

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {item.label}
                {item.badge != null && item.badge > 0 && (
                  <span className={cn(
                    'min-w-5 rounded-full px-1.5 py-0.5 text-center text-xs font-bold',
                    active ? 'bg-white/25 text-white' : 'bg-vipps-orange-0 text-vipps-orange-80',
                  )}>
                    {item.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-2">
          <span className="hidden max-w-[140px] truncate text-sm text-muted-foreground lg:inline">{name}</span>
          <form action="/artist-app/logout" method="post" className="hidden sm:block">
            <button
              type="submit"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              <LogOut className="size-3.5" />
              Logg ut
            </button>
          </form>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-full border border-border md:hidden"
            aria-label={open ? 'Lukk meny' : 'Åpne meny'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border px-4 py-3 md:hidden">
          <nav className="grid gap-1">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-semibold',
                    active ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-muted',
                  )}
                >
                  <span>{item.label}</span>
                  {item.badge != null && item.badge > 0 && (
                    <span className="rounded-full bg-vipps-orange px-2 py-0.5 text-xs font-bold text-white">
                      {item.badge}
                    </span>
                  )}
                </Link>
              )
            })}
            <form action="/artist-app/logout" method="post" className="mt-2">
              <button
                type="submit"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted"
              >
                <LogOut className="size-4" />
                Logg ut
              </button>
            </form>
          </nav>
        </div>
      )}
    </header>
  )
}

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false
  if (href === '/artist-app') {
    return pathname === '/artist-app' || pathname === '/artist-app/'
  }
  return pathname.startsWith(href)
}
