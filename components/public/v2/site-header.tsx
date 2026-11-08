import Link from 'next/link'
import { BrandLogoResponsive } from '@/components/brand/brand-logo'

/**
 * EKSPERIMENTELL (branch experimental/landing-v2) — ikke merge til main.
 *
 * Én rolig linje: merket til venstre, to lenker og én knapp til høyre.
 * Ingen flytende piller, ingen scroll-logikk — headeren står i dokumentflyten
 * og tar ikke oppmerksomhet fra innholdet.
 */
export function SiteHeader() {
  return (
    <header className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-4 md:h-20 md:px-8">
      <Link
        href="/"
        className="flex h-9 items-center rounded-full bg-[var(--ev-accent-fill)] px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-text)]"
      >
        <BrandLogoResponsive tone="dark" priority className="h-5" />
      </Link>

      <nav aria-label="Main" className="flex items-center gap-1 text-[14px] font-medium">
        <Link
          href="/artist-app/login"
          className="hidden h-9 items-center rounded-full px-3 text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)] sm:inline-flex"
        >
          For comedians
        </Link>
        <Link
          href="/admin-app"
          prefetch={false}
          className="inline-flex h-9 items-center rounded-full px-3 text-[var(--ev-muted)] transition-colors hover:text-[var(--ev-text)]"
        >
          For clubs
        </Link>
        <a
          href="#shows"
          className="ml-1 inline-flex h-9 items-center rounded-full bg-[var(--ev-text)] px-4 text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
        >
          Find a show
        </a>
      </nav>
    </header>
  )
}
