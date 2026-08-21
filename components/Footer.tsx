import Link from 'next/link'

/**
 * The fallback values keep the footer intact on pages that are not yet
 * inside an `.ev-surface` scope (e.g. /artists).
 */
export function Footer() {
  return (
    <footer
      className="border-t py-8 text-center text-[15px] sm:text-sm"
      style={{
        borderColor: 'var(--ev-line, rgba(0,0,0,0.1))',
        color: 'var(--ev-muted, #71717a)',
      }}
    >
      <div className="flex flex-wrap items-center justify-center gap-2 px-4 sm:mb-2">
        <span style={{ color: 'var(--ev-text, #000)' }}>Tickethalo</span>™
        <span aria-hidden style={{ color: 'var(--ev-faint, #d4d4d8)' }}>|</span>
        <span>The world&rsquo;s funniest nights</span>
      </div>
      {/* A touch target, not just text: as a plain line it was 19px tall, below
          the WCAG 2.5.8 minimum. 44px for a thumb on mobile; on desktop padding
          brings it to 28px without changing how the footer looks. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pt-2 text-[13px]">
        <Link
          href="/kjopsvilkar"
          className="inline-flex h-9 items-center underline-offset-4 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:h-auto sm:py-1"
          style={{ color: 'var(--ev-muted, #71717a)' }}
        >
          Terms of purchase
        </Link>
        <Link
          href="/vilkar"
          className="inline-flex h-9 items-center underline-offset-4 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:h-auto sm:py-1"
          style={{ color: 'var(--ev-muted, #71717a)' }}
        >
          Platform terms
        </Link>
        <Link
          href="/personvern"
          className="inline-flex h-9 items-center underline-offset-4 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:h-auto sm:py-1"
          style={{ color: 'var(--ev-muted, #71717a)' }}
        >
          Privacy
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 px-4 pt-2 sm:gap-4 sm:pt-0">
        <Link
          href="/artist-app/login"
          className="mt-1 inline-flex h-11 items-center rounded-full px-3 underline-offset-4 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:mt-0 sm:h-auto sm:px-0 sm:py-1"
          style={{ color: 'var(--ev-muted, #71717a)' }}
        >
          Comedian portal
        </Link>
        <span aria-hidden style={{ color: 'var(--ev-faint, #d4d4d8)' }}>|</span>
        <Link
          href="/admin-app"
          className="mt-1 inline-flex h-11 items-center rounded-full px-3 underline-offset-4 transition-colors hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:mt-0 sm:h-auto sm:px-0 sm:py-1"
          style={{ color: 'var(--ev-muted, #71717a)' }}
        >
          Comedy Club
        </Link>
      </div>
    </footer>
  )
}
