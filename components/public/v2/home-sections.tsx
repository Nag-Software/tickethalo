import Link from 'next/link'

/**
 * EKSPERIMENTELL (branch experimental/landing-v2) — ikke merge til main.
 *
 * Forsiden snakker til publikum først. Klubber og komikere får hver sin
 * rolige blokk nederst i stedet for å konkurrere om hero-knappene.
 */

export function HeroV2({ showCount }: { showCount: number }) {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 pb-10 pt-10 text-center md:px-8 md:pb-14 md:pt-20">
      <h1 className="text-balance text-[40px] font-semibold leading-[1.02] tracking-[-0.04em] text-[var(--ev-text)] md:text-[64px]">
        Great comedy nights,{' '}
        <br className="hidden sm:block" />
        <span className="text-[var(--ev-accent)]">one tap away.</span>
      </h1>
      <p className="mx-auto mt-5 max-w-md text-pretty text-[17px] leading-[1.45] text-[var(--ev-muted)] md:text-[19px]">
        Find stand-up near you and get your tickets in seconds.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a
          href="#shows"
          className="inline-flex h-12 items-center rounded-full bg-[var(--ev-text)] px-6 text-[16px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
        >
          {showCount > 0 ? `See ${showCount} upcoming ${showCount === 1 ? 'show' : 'shows'}` : 'See upcoming shows'}
        </a>
      </div>

      <div className="relative mx-auto mt-12 aspect-[16/9] w-full overflow-hidden rounded-3xl bg-[var(--ev-poster-ground)] md:mt-16">
        <picture>
          <source media="(min-width: 720px)" srcSet="/hero-audience.webp" />
          <img
            src="/hero-audience-mobile.webp"
            alt="Two people laughing in the audience at a comedy club"
            width={1120}
            height={1068}
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover"
          />
        </picture>
      </div>
    </section>
  )
}

const audiences = [
  {
    eyebrow: 'For comedy clubs',
    title: 'Sell tickets, book comedians, get paid.',
    points: ['Publish a show in minutes', 'Ticket scanning app included', 'Payouts straight to your account'],
    cta: 'Get started',
    href: '/admin-app',
    prefetch: false,
  },
  {
    eyebrow: 'For comedians',
    title: 'Find gigs and fill your calendar.',
    points: ['See open spots from clubs', 'Get booking offers directly', 'One profile for every club'],
    cta: 'Find gigs',
    href: '/artist-app/login',
    prefetch: undefined,
  },
] as const

export function AudienceSections() {
  return (
    <section className="mx-auto w-full max-w-5xl px-4 pb-24 md:px-8">
      <div className="grid gap-4 md:grid-cols-2">
        {audiences.map((a) => (
          <div key={a.eyebrow} className="flex flex-col rounded-3xl bg-[var(--ev-card)] p-6 md:p-8">
            <p className="text-[14px] font-semibold text-[var(--ev-accent)]">{a.eyebrow}</p>
            <h2 className="mt-2 text-balance text-[24px] font-semibold leading-[1.15] tracking-[-0.025em] text-[var(--ev-text)] md:text-[28px]">
              {a.title}
            </h2>
            <ul className="mt-5 flex flex-col gap-2 text-[15px] text-[var(--ev-muted)]">
              {a.points.map((p) => (
                <li key={p} className="flex items-center gap-2.5">
                  <span aria-hidden className="size-1.5 rounded-full bg-[var(--ev-accent-fill)]" />
                  {p}
                </li>
              ))}
            </ul>
            <Link
              href={a.href}
              prefetch={a.prefetch}
              className="mt-8 inline-flex h-11 w-fit items-center rounded-full border border-[var(--ev-line-strong)] px-5 text-[15px] font-semibold text-[var(--ev-text)] transition-colors hover:border-[var(--ev-text)] hover:bg-[var(--ev-text)] hover:text-[var(--ev-bg)]"
            >
              {a.cta} →
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}
