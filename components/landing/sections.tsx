import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { BrandLogoResponsive } from '@/components/brand/brand-logo'

/**
 * EKSPERIMENTELL (branch experimental/landing-v2) — ikke merge til main.
 *
 * Klubber og komikere får hver sin fargeblokk. Fargene er de eksisterende
 * tokenene (`--ev-accent-fill`, `--ev-violet`), ikke nye heks-verdier.
 */

const steps = [
  { n: '01', title: 'Create a show', text: 'Title, date, price. Your page is live in minutes.' },
  { n: '02', title: 'Sell tickets', text: 'Share one link. Buyers pay in a few taps.' },
  { n: '03', title: 'Scan & get paid', text: 'Scan at the door with our app. Payouts go straight to you.' },
]

export function ForClubs() {
  return (
    <section className="px-3 md:px-6">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[28px] bg-[var(--ev-accent-fill)] px-5 py-10 text-white sm:rounded-[40px] md:px-14 md:py-20">
        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-white/80 sm:text-[14px]">For comedy clubs</p>
        <h2 className="mt-2 max-w-3xl text-[34px] font-extrabold leading-[0.98] tracking-[-0.04em] [font-family:var(--font-display)] sm:mt-3 sm:text-[52px] md:text-[72px]">
          Run your club. We&rsquo;ll handle the tickets.
        </h2>

        <ol className="mt-7 grid gap-2.5 sm:mt-12 sm:gap-4 md:grid-cols-3">
          {steps.map((s) => (
            <li
              key={s.n}
              className="grid grid-cols-[auto_1fr] gap-x-3 rounded-[20px] bg-white/12 p-4 ring-1 ring-inset ring-white/20 sm:block sm:rounded-[28px] sm:p-6"
            >
              <span className="row-span-2 pt-0.5 text-[13px] font-bold text-white/70 sm:text-[15px]">{s.n}</span>
              <h3 className="text-[19px] font-bold leading-tight [font-family:var(--font-display)] sm:mt-6 sm:text-[26px]">{s.title}</h3>
              <p className="mt-1 text-[15px] text-white/85 sm:mt-2 sm:text-[16px]">{s.text}</p>
            </li>
          ))}
        </ol>

        <Link
          href="/arranger"
          className="mt-7 inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-bold text-black transition-transform hover:scale-[1.03] sm:mt-10 sm:h-14 sm:px-7 sm:text-[16px]"
        >
          Start selling tickets <ArrowUpRight className="size-5" aria-hidden />
        </Link>

        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-10 -right-4 select-none text-[160px] sm:-bottom-16 sm:-right-6 sm:text-[260px] font-extrabold leading-none text-white/10 [font-family:var(--font-display)] md:text-[380px]"
        >
          ha!
        </span>
      </div>
    </section>
  )
}

export function ForComedians() {
  return (
    <section className="px-3 pt-3 md:px-6 md:pt-6">
      <div className="mx-auto grid max-w-7xl items-center gap-6 overflow-hidden rounded-[28px] bg-[var(--ev-violet)] px-5 py-10 text-white sm:rounded-[40px] md:grid-cols-[1.4fr_1fr] md:gap-8 md:px-14 md:py-16">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-white/75 sm:text-[14px]">For comedians</p>
          <h2 className="mt-2 text-[34px] font-extrabold leading-[0.98] tracking-[-0.04em] [font-family:var(--font-display)] sm:mt-3 sm:text-[48px] md:text-[60px]">
            Get on more stages.
          </h2>
          <p className="mt-3 max-w-md text-[16px] text-white/85 sm:mt-4 sm:text-[18px]">
            See open spots from clubs, get booking offers, and keep every gig in one place.
          </p>
        </div>
        <div className="md:justify-self-end">
          <Link
            href="/artist-app/login"
            className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-bold text-black transition-transform hover:scale-[1.03] sm:h-14 sm:px-7 sm:text-[16px]"
          >
            Find gigs <ArrowUpRight className="size-5" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  )
}

export function LandingFooter() {
  return (
    <footer className="ev-surface mt-3 bg-[var(--ev-bg)] text-[var(--ev-text)] md:mt-6 md:rounded-t-[48px]" data-tone="dark">
      <div className="mx-auto max-w-7xl px-4 pb-8 pt-12 md:px-10 md:pb-10 md:pt-16">
        <div className="flex flex-col justify-between gap-10 md:flex-row md:items-end">
          <div>
            <BrandLogoResponsive tone="dark" className="h-8" />
            <p className="mt-4 max-w-xs text-[16px] text-[var(--ev-muted)]">The world&rsquo;s funniest nights, one ticket away.</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 text-[15px] text-[var(--ev-muted)] md:gap-x-12">
            <Link href="/events" className="flex h-11 items-center hover:text-[var(--ev-text)] md:h-8">All events</Link>
            <Link href="/kjopsvilkar" className="flex h-11 items-center hover:text-[var(--ev-text)] md:h-8">Terms of purchase</Link>
            <Link href="/arranger" className="flex h-11 items-center hover:text-[var(--ev-text)] md:h-8">For clubs</Link>
            <Link href="/vilkar" className="flex h-11 items-center hover:text-[var(--ev-text)] md:h-8">Platform terms</Link>
            <Link href="/artist-app/login" className="flex h-11 items-center hover:text-[var(--ev-text)] md:h-8">For comedians</Link>
            <Link href="/personvern" className="flex h-11 items-center hover:text-[var(--ev-text)] md:h-8">Privacy</Link>
          </nav>
        </div>
        <p className="mt-14 border-t border-[var(--ev-line)] pt-6 text-[13px] text-[var(--ev-faint)]">
          © {new Date().getFullYear()} Tickethalo
        </p>
      </div>
    </footer>
  )
}
