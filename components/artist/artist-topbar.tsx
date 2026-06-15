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
    <header className="sticky top-0 z-30 border-b border-black/10 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/artist-app" className="shrink-0 text-lg font-medium tracking-tight">
            humor.events
          </Link>
          <span className="hidden border border-black/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 sm:inline-flex">
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
                  'inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition',
                  active
                    ? 'bg-black text-white'
                    : 'text-zinc-600 hover:bg-zinc-100 hover:text-black',
                )}
              >
                {item.label}
                {item.badge != null && item.badge > 0 && (
                  <span className={cn(
                    'min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold',
                    active ? 'bg-[#ff6bff] text-black' : 'bg-[#ff6bff]/30 text-black',
                  )}>
                    {item.badge}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-2">
          <span className="hidden max-w-[140px] truncate text-sm text-zinc-500 lg:inline">{name}</span>
          <form action="/artist-app/logout" method="post" className="hidden sm:block">
            <button
              type="submit"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/10 px-3 text-sm text-zinc-600 transition hover:border-black hover:text-black"
            >
              <LogOut className="size-3.5" />
              Logg ut
            </button>
          </form>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-full border border-black/10 md:hidden"
            aria-label={open ? 'Lukk meny' : 'Åpne meny'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-black/10 px-4 py-3 md:hidden">
          <nav className="grid gap-1">
            {navItems.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium',
                    active ? 'bg-black text-white' : 'text-zinc-700 hover:bg-zinc-50',
                  )}
                >
                  <span>{item.label}</span>
                  {item.badge != null && item.badge > 0 && (
                    <span className="rounded-full bg-[#ff6bff] px-2 py-0.5 text-[10px] font-bold text-black">
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
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50"
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

function isActive(pathname: string, href: string) {
  if (href === '/artist-app') {
    return pathname === '/artist-app' || pathname === '/artist-app/'
  }
  return pathname.startsWith(href)
}
