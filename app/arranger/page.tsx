import Link from 'next/link'
import { Bricolage_Grotesque } from 'next/font/google'
import { Check, Mic, QrCode, Send, Ticket, Users, Wallet } from 'lucide-react'
import { BrandLogoResponsive } from '@/components/brand/brand-logo'
import { PayoutCalculator } from '@/components/arranger/payout-calculator'
import { cn } from '@/lib/utils'
import { BetaAccessDialog } from '@/components/public/beta-access-dialog'

// EKSPERIMENTELL markedsside for klubber (branch experimental/landing-v2) — ikke merge til main.

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display' })

export const metadata = {
  title: 'Tickethalo for comedy clubs — tickets, booking and check-in',
  description: 'Sell tickets, book comedians and scan at the door. Your club keeps 90% of every ticket.',
}

const H = '[font-family:var(--font-display)]'

export default function ArrangerPage() {
  return (
    <main
      lang="en"
      className={cn(display.variable, 'ev-surface min-h-screen bg-[var(--ev-bg)] text-[var(--ev-text)]')}
      data-tone="light"
    >
      <Header />
      <Hero />
      <Payout />
      <Features />
      <Steps />
      <Faq />
      <FinalCta />
      <Footer />
    </main>
  )
}

/* ───────────────────────── Header ───────────────────────── */

function Header() {
  return (
    <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:h-20 md:px-8">
      <Link href="/arranger" className="flex h-9 items-center rounded-full bg-[var(--ev-accent-fill)] px-3">
        <BrandLogoResponsive tone="dark" priority className="h-5" />
      </Link>
      <nav aria-label="Main" className="flex items-center gap-1 text-[14px] font-medium">
        <a href="#pricing" className="hidden rounded-full px-3 py-2 text-[var(--ev-muted)] hover:text-[var(--ev-text)] md:block">
          Pricing
        </a>
        <a href="#features" className="hidden rounded-full px-3 py-2 text-[var(--ev-muted)] hover:text-[var(--ev-text)] md:block">
          Features
        </a>
        <a href="#faq" className="hidden rounded-full px-3 py-2 text-[var(--ev-muted)] hover:text-[var(--ev-text)] md:block">
          FAQ
        </a>
        <Link href="/admin-app/login" className="rounded-full px-3 py-2 text-[var(--ev-muted)] hover:text-[var(--ev-text)]">
          Log in
        </Link>
        <BetaAccessDialog
          source="arranger-header"
          label="Request access"
          className="cursor-pointer rounded-full bg-[var(--ev-text)] px-4 py-2 font-semibold text-[var(--ev-bg)] hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
        />
      </nav>
    </header>
  )
}

/* ───────────────────────── Hero ───────────────────────── */

function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-10 px-4 pb-14 pt-4 sm:gap-14 sm:pb-20 sm:pt-8 md:px-8 md:pt-14 lg:grid-cols-[1fr_1.05fr]">
      <div>
        <p className="text-[13px] font-semibold text-[var(--ev-accent)] sm:text-[14px]">For comedy clubs and promoters</p>
        <h1 className={cn(H, 'mt-3 text-balance text-[34px] font-bold leading-[1.04] tracking-[-0.035em] sm:mt-4 sm:text-[48px] lg:text-[58px]')}>
          Tickets, booking and check‑in. One place.
        </h1>
        <p className="mt-4 max-w-lg text-[16px] leading-[1.5] text-[var(--ev-muted)] sm:mt-5 sm:text-[18px]">
          Publish a show, sell tickets, find comedians and scan your audience at the door. Built for clubs that would rather
          spend the night on stage than in spreadsheets.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2 sm:mt-8 sm:gap-3">
          <BetaAccessDialog
            source="arranger-hero"
            label="Request access"
            withArrow
            className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-full bg-[var(--ev-text)] px-6 text-[16px] font-semibold text-[var(--ev-bg)] hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
          />
          <a href="#pricing" className="inline-flex h-12 items-center px-3 text-[16px] font-semibold underline-offset-4 hover:underline">
            See what you keep
          </a>
        </div>
        <ul className="mt-6 flex flex-col gap-2 text-[14px] text-[var(--ev-muted)] sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-x-6">
          {['90% of the ticket price to your club', 'Card fees covered', 'Scanner app for iPhone'].map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <Check className="size-4 text-[var(--ev-accent)]" aria-hidden /> {t}
            </li>
          ))}
        </ul>
      </div>

      <ProductMock />
    </section>
  )
}

/** Et utsnitt av klubbportalen, tegnet i HTML — ikke et skjermbilde som går ut på dato. */
function ProductMock() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-[540px] pb-10 lg:pb-0">
      {/* Showkortet fra portalen */}
      <div className="rounded-[24px] bg-white p-4 text-[#1b0800] sm:rounded-[28px] sm:p-5 shadow-[0_40px_80px_-40px_rgba(46,12,1,0.45)] ring-1 ring-black/5 md:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium text-black/50">Fri 21 Nov · 20:00</p>
            <p className={cn(H, 'mt-1 text-[19px] font-bold leading-tight sm:text-[22px]')}>Friday Stand-up & Friends</p>
          </div>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-[#e8f6ec] px-2.5 py-1 text-[12px] font-semibold text-[#1d6b35]">On sale</span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 sm:mt-6 sm:gap-3">
          {[
            ['Sold', '142 / 150'],
            ['To your club', 'NOK 38,340'],
            ['Avg. price', 'NOK 286'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-black/[0.04] p-2.5 sm:p-3">
              <p className="text-[12px] text-black/50">{k}</p>
              <p className="mt-1 text-[14px] font-semibold tabular-nums sm:text-[17px]">{v}</p>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <div className="h-2.5 overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full w-[94%] rounded-full bg-[var(--ev-accent-fill)]" />
          </div>
          <p className="mt-2 text-[12px] text-black/50">94% sold · 8 tickets left</p>
        </div>

        <div className="mt-6 space-y-2.5">
          {[
            ['Standard', 'NOK 300', '118'],
            ['Student', 'NOK 220', '24'],
          ].map(([name, price, sold]) => (
            <div key={name} className="flex items-center justify-between rounded-xl border border-black/[0.07] px-3.5 py-2.5 text-[14px]">
              <span className="font-medium">{name}</span>
              <span className="text-black/50">
                {price} · {sold} sold
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Skanneren — telefonen ligger over kortet */}
      <div className="absolute -bottom-2 -right-1 w-[132px] rotate-[4deg] sm:w-[168px] rounded-[30px] bg-[#1b0800] p-2 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] sm:-right-8 sm:w-[190px] lg:-bottom-14">
        <div className="rounded-[24px] bg-[#1d6b35] px-4 pb-6 pt-8 text-center text-white">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-white/20">
            <Check className="size-8" strokeWidth={3} />
          </div>
          <p className={cn(H, 'mt-3 text-[20px] font-bold')}>Valid</p>
          <p className="mt-1 text-[12px] text-white/80">Standard · 2 people</p>
          <p className="mt-4 rounded-full bg-white/15 py-1.5 text-[11px] font-medium">Checked in 19:42</p>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Pris ───────────────────────── */

function Payout() {
  return (
    <section id="pricing" className="scroll-mt-6 px-3 md:px-6">
      <div className="ev-surface mx-auto max-w-6xl rounded-[28px] bg-[var(--ev-bg)] px-5 py-10 text-[var(--ev-text)] sm:rounded-[40px] md:px-14 md:py-20" data-tone="dark">
        <div className="grid items-center gap-8 sm:gap-12 lg:grid-cols-2">
          <div>
            <p className="text-[14px] font-semibold text-[var(--ev-accent)]">Pricing</p>
            <p className={cn(H, 'mt-2 text-[80px] font-bold leading-[0.85] tracking-[-0.05em] sm:mt-3 sm:text-[110px] md:text-[140px]')}>90%</p>
            <h2 className={cn(H, 'mt-3 text-[24px] font-bold leading-[1.1] tracking-[-0.02em] sm:mt-4 md:text-[34px]')}>
              of every ticket goes to your club.
            </h2>
            <p className="mt-3 max-w-md text-[16px] leading-[1.55] text-[var(--ev-muted)] sm:mt-4 sm:text-[17px]">
              We take 10%, and we pay the card fees out of that. What you see in the calculator is what lands in your account.
            </p>
          </div>
          <PayoutCalculator />
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────── Funksjoner ───────────────────────── */

const features = [
  {
    icon: Ticket,
    title: 'Ticket sales',
    text: 'Every show gets its own page and a link to share. Multiple ticket types, promo codes, and sales end when you want.',
    wide: true,
  },
  {
    icon: QrCode,
    title: 'Check-in at the door',
    text: 'Scan tickets with the iPhone app or right in the browser.',
  },
  {
    icon: Mic,
    title: 'Find comedians',
    text: 'Browse comedians on the platform and build your line-up.',
  },
  {
    icon: Send,
    title: 'Send booking offers',
    text: 'Send an offer with date and fee. The comedian answers with one tap.',
  },
  {
    icon: Wallet,
    title: 'Payouts',
    text: 'Money goes straight to your club’s account via Stripe. Sales and settlements are all in the portal.',
    wide: true,
  },
  {
    icon: Users,
    title: 'Audience list',
    text: 'See who bought tickets, and export the list when you want to reach them again.',
  },
] as const

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-14 sm:py-24 md:px-8">
      <div className="max-w-2xl">
        <p className="text-[14px] font-semibold text-[var(--ev-accent)]">Features</p>
        <h2 className={cn(H, 'mt-2 text-[30px] font-bold leading-[1.05] tracking-[-0.03em] sm:mt-3 sm:text-[40px] md:text-[48px]')}>
          Everything a club night needs. Nothing more.
        </h2>
      </div>

      <div className="mt-7 grid gap-2.5 sm:mt-12 sm:gap-4 md:grid-cols-3">
        {features.map(({ icon: Icon, title, text, ...rest }) => (
          <div
            key={title}
            className={cn(
              'grid grid-cols-[auto_1fr] gap-x-4 rounded-[20px] bg-[var(--ev-card)] p-4 ring-1 ring-inset ring-[var(--ev-line)] sm:block sm:rounded-[28px] sm:p-6 md:p-8',
              'wide' in rest && rest.wide && 'md:col-span-2'
            )}
          >
            <span className="row-span-2 grid size-10 place-items-center rounded-2xl bg-[var(--ev-accent-fill)] text-[var(--ev-accent-ink)] sm:size-11">
              <Icon className="size-5" aria-hidden />
            </span>
            <h3 className={cn(H, 'text-[18px] font-bold tracking-[-0.01em] sm:mt-8 sm:text-[22px]')}>{title}</h3>
            <p className="mt-1 max-w-md text-[15px] leading-[1.5] text-[var(--ev-muted)] sm:mt-2 sm:text-[16px]">{text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ───────────────────────── Slik kommer du i gang ───────────────────────── */

const steps = [
  { title: 'Get access', text: 'We set up your club with you. Connect Stripe for payouts.' },
  { title: 'Publish a show', text: 'Date, venue and ticket price. The show gets its own page right away.' },
  { title: 'Share the link', text: 'Sell on Instagram, in your newsletter or at the bar. The show is listed on Tickethalo too.' },
  { title: 'Scan and play', text: 'Open the scanner at the door. After the show, the settlement takes care of itself.' },
]

function Steps() {
  return (
    <section className="border-y border-[var(--ev-line)]">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:py-20 md:px-8">
        <h2 className={cn(H, 'text-[28px] font-bold tracking-[-0.03em] sm:text-[32px] md:text-[40px]')}>From zero to your first show</h2>
        <ol className="mt-6 grid gap-5 sm:mt-10 sm:grid-cols-2 sm:gap-8 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[40px_1fr] gap-x-3 sm:block">
              <span className={cn(H, 'row-span-2 text-[36px] font-bold leading-none text-[var(--ev-accent-fill)] sm:text-[56px]')}>{i + 1}</span>
              <h3 className="text-[17px] font-semibold sm:mt-3 sm:text-[18px]">{s.title}</h3>
              <p className="mt-1 text-[15px] leading-[1.5] text-[var(--ev-muted)] sm:mt-1.5">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ───────────────────────── FAQ ───────────────────────── */

const faq = [
  {
    q: 'How do we get started?',
    a: 'The club portal is invite-only while we are in beta. Request access and we will get in touch and set you up.',
  },
  {
    q: 'What does it cost?',
    a: 'Tickethalo takes 10% of the ticket price. We pay the card fees out of our share, so your club gets 90% of what the audience pays.',
  },
  {
    q: 'When do we get paid?',
    a: 'Payouts go through Stripe straight to your club’s bank account. You can see sales and settlements per show in the portal.',
  },
  {
    q: 'Do we need special equipment at the door?',
    a: 'No. The scanner app runs on a regular iPhone, and there is a browser scanner too.',
  },
  {
    q: 'Can we sell tickets elsewhere at the same time?',
    a: 'Yes. Any show can point to an external ticket link if you already sell somewhere else.',
  },
]

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-6 px-4 py-14 sm:py-24 md:px-8">
      <h2 className={cn(H, 'text-[28px] font-bold tracking-[-0.03em] sm:text-[32px] md:text-[40px]')}>Questions</h2>
      <div className="mt-5 divide-y sm:mt-8 divide-[var(--ev-line)] border-y border-[var(--ev-line)]">
        {faq.map((f) => (
          <details key={f.q} className="group py-4 sm:py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-semibold sm:text-[18px] [&::-webkit-details-marker]:hidden">
              {f.q}
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--ev-card)] text-[20px] leading-none transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-2 max-w-2xl text-[15px] leading-[1.6] text-[var(--ev-muted)] sm:mt-3 sm:text-[16px]">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}

/* ───────────────────────── Avslutning ───────────────────────── */

function FinalCta() {
  return (
    <section className="px-3 pb-3 md:px-6 md:pb-6">
      <div className="mx-auto max-w-6xl rounded-[28px] bg-[var(--ev-accent-fill)] px-5 py-12 text-center text-white sm:rounded-[40px] md:py-24">
        <h2 className={cn(H, 'mx-auto max-w-2xl text-balance text-[30px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[40px] md:text-[52px]')}>
          Want your club on board?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[16px] text-white/85 sm:mt-4 sm:text-[17px]">
          Tickethalo is in beta, and we are adding new clubs all the time.
        </p>
        <BetaAccessDialog
          source="arranger-final"
          label="Request access"
          withArrow
          className="mt-6 inline-flex h-12 cursor-pointer items-center gap-2 rounded-full bg-white px-6 text-[15px] font-bold text-black sm:mt-8 sm:h-14 sm:px-7 sm:text-[16px] transition-transform hover:scale-[1.03]"
        />
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-8 sm:gap-4 sm:py-10 text-[14px] text-[var(--ev-muted)] md:flex-row md:px-8">
      <span>© {new Date().getFullYear()} Tickethalo</span>
      <nav aria-label="Footer" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
        <Link href="/" className="flex h-11 items-center hover:text-[var(--ev-text)] sm:h-auto">For audiences</Link>
        <Link href="/vilkar" className="flex h-11 items-center hover:text-[var(--ev-text)] sm:h-auto">Platform terms</Link>
        <Link href="/personvern" className="flex h-11 items-center hover:text-[var(--ev-text)] sm:h-auto">Privacy</Link>
      </nav>
    </footer>
  )
}
