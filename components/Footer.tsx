import Link from 'next/link'

/**
 * Fallback-verdiene gjør at footeren også holder på sider som ennå
 * ikke ligger inne i en `.ev-surface`-scope (f.eks. /artists).
 */
export function Footer() {
  return (
    <footer
      className="border-t py-8 text-center text-sm"
      style={{
        borderColor: 'var(--ev-line, rgba(0,0,0,0.1))',
        color: 'var(--ev-muted, #71717a)',
      }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-center gap-2 px-4">
        <span style={{ color: 'var(--ev-text, #000)' }}>Tickethalo</span>™
        <span aria-hidden style={{ color: 'var(--ev-faint, #d4d4d8)' }}>|</span>
        <span>Norges morsomste kvelder</span>
      </div>
      <Link
        href="/artist-app/login"
        className="underline-offset-4 transition-colors hover:underline"
        style={{ color: 'var(--ev-muted, #71717a)' }}
      >
        Komikerportalen
      </Link>
    </footer>
  )
}
