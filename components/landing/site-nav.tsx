'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BrandLogoResponsive } from '@/components/brand/brand-logo'
import { cn } from '@/lib/utils'

/**
 * EKSPERIMENTELL (branch experimental/landing-v2) — ikke merge til main.
 *
 * Én navbar for alle offentlige sider: forsiden bruker den i flyten,
 * `PublicHeader` legger den fast i toppen på resten.
 *
 * Mobil først: under `sm` er det bare plass til merket, «Comedians» og
 * hovedknappen. «For clubs» og «Sell tickets» går begge til /arranger, så
 * klubbene mister ingenting på smal skjerm.
 */
export function SiteNav({
  className,
  actions,
}: {
  className?: string
  /**
   * Erstatter «Sell tickets» — /arranger viser «Log in» og «Request access»
   * her. Da viker «Comedians» på mobil, så knappene får plass.
   */
  actions?: React.ReactNode
}) {
  const pathname = usePathname() ?? '/'
  const on = (...prefixes: string[]) => prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  const comedians = on('/artist-app', '/artists')
  const clubs = on('/arranger', '/admin-app')

  const link =
    'inline-flex h-10 items-center rounded-full px-3 text-[14px] font-semibold transition-colors sm:px-4 ' +
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]'

  return (
    <div className={cn('mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-2 px-4 sm:h-20 md:px-10', className)}>
      <Link
        href="/"
        aria-label="Tickethalo home"
        className="flex h-9 shrink-0 items-center rounded-full bg-[var(--ev-accent-fill)] px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-text)]"
      >
        <BrandLogoResponsive tone="dark" priority className="h-5" />
      </Link>

      <nav aria-label="Main" className="flex items-center gap-0.5 sm:gap-1">
        <Link
          href="/artist-app/login"
          aria-current={comedians ? 'page' : undefined}
          className={cn(
            link,
            actions && 'hidden sm:inline-flex',
            comedians ? 'text-[var(--ev-text)]' : 'text-[var(--ev-muted)] hover:text-[var(--ev-text)]'
          )}
        >
          <span className="sm:hidden">Comedians</span>
          <span className="hidden sm:inline">For comedians</span>
        </Link>
        <Link
          href="/arranger"
          aria-current={clubs ? 'page' : undefined}
          className={cn(link, 'hidden sm:inline-flex', clubs ? 'text-[var(--ev-text)]' : 'text-[var(--ev-muted)] hover:text-[var(--ev-text)]')}
        >
          For clubs
        </Link>
        {actions ?? (
          <Link
            href="/arranger"
            className={cn(
              link,
              'ml-1 bg-[var(--ev-text)] px-4 text-[var(--ev-bg)] hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]'
            )}
          >
            Sell tickets
          </Link>
        )}
      </nav>
    </div>
  )
}
