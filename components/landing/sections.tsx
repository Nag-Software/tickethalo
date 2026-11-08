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
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[40px] bg-[var(--ev-accent-fill)] px-6 py-14 text-white md:px-14 md:py-20">
        <p className="text-[14px] font-bold uppercase tracking-[0.12em] text-white/80">For comedy clubs</p>
        <h2 className="mt-3 max-w-3xl text-[44px] font-extrabold leading-[0.95] tracking-[-0.04em] [font-family:var(--font-display)] md:text-[76px]">
          Run your club. We&rsquo;ll handle the tickets.
        </h2>

        <ol className="mt-12 grid gap-4 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n} className="rounded-[28px] bg-white/12 p-6 ring-1 ring-inset ring-white/20 backdrop-blur-sm">
              <span className="text-[15px] font-bold text-white/70">{s.n}</span>
              <h3 className="mt-6 text-[26px] font-bold leading-tight [font-family:var(--font-display)]">{s.title}</h3>
              <p className="mt-2 text-[16px] text-white/85">{s.text}</p>
            </li>
          ))}
        </ol>

        <Link
          href="/arranger"
          className="mt-10 inline-flex h-14 items-center gap-2 rounded-full bg-white px-7 text-[16px] font-bold text-black transition-transform hover:scale-[1.03]"
        >
          Start selling tickets <ArrowUpRight className="size-5" aria-hidden />
        </Link>

        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-16 -right-6 select-none text-[260px] font-extrabold leading-none text-white/10 [font-family:var(--font-display)] md:text-[380px]"
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
      <div className="mx-auto grid max-w-7xl items-center gap-8 overflow-hidden rounded-[40px] bg-[var(--ev-violet)] px-6 py-14 text-white md:grid-cols-[1.4fr_1fr] md:px-14 md:py-16">
        <div>
          <p className="text-[14px] font-bold uppercase tracking-[0.12em] text-white/75">For comedians</p>
          <h2 className="mt-3 text-[40px] font-extrabold leading-[0.95] tracking-[-0.04em] [font-family:var(--font-display)] md:text-[64px]">
            Get on more stages.
          </h2>
          <p className="mt-4 max-w-md text-[18px] text-white/85">
            See open spots from clubs, get booking offers, and keep every gig in one place.
          </p>
        </div>
        <div className="md:justify-self-end">
          <Link
            href="/artist-app/login"
            className="inline-flex h-14 items-center gap-2 rounded-full bg-white px-7 text-[16px] font-bold text-black transition-transform hover:scale-[1.03]"
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
      <div className="mx-auto max-w-7xl px-5 pb-10 pt-16 md:px-10">
        <div className="flex flex-col justify-between gap-10 md:flex-row md:items-end">
          <div>
            <BrandLogoResponsive tone="dark" className="h-8" />
            <p className="mt-4 max-w-xs text-[16px] text-[var(--ev-muted)]">The world&rsquo;s funniest nights, one ticket away.</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-[15px] text-[var(--ev-muted)]">
            <Link href="/events" className="hover:text-[var(--ev-text)]">All events</Link>
            <Link href="/kjopsvilkar" className="hover:text-[var(--ev-text)]">Terms of purchase</Link>
            <Link href="/arranger" className="hover:text-[var(--ev-text)]">For clubs</Link>
            <Link href="/vilkar" className="hover:text-[var(--ev-text)]">Platform terms</Link>
            <Link href="/artist-app/login" className="hover:text-[var(--ev-text)]">For comedians</Link>
            <Link href="/personvern" className="hover:text-[var(--ev-text)]">Privacy</Link>
          </nav>
        </div>
        <p className="mt-14 border-t border-[var(--ev-line)] pt-6 text-[13px] text-[var(--ev-faint)]">
          © {new Date().getFullYear()} Tickethalo
        </p>
      </div>
    </footer>
  )
}
