import Link from 'next/link'
import { Bricolage_Grotesque } from 'next/font/google'
import { Check } from 'lucide-react'
import { BrandLogoResponsive } from '@/components/brand/brand-logo'
import { PayoutCalculator } from '@/components/arranger/payout-calculator'
import { cn } from '@/lib/utils'
import { BetaAccessDialog } from '@/components/public/beta-access-dialog'

// EKSPERIMENTELL markedsside for klubber (branch experimental/landing-v2) — ikke merge til main.

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display' })

export const metadata = {
  title: 'Tickethalo for comedy clubs — tickets, booking and check-in',
  description: 'Sell tickets, book comedians and scan at the door. 10% per ticket, card fees included.',
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

/* ───────────────────────── Bilder ───────────────────────── */

/**
 * Stockbilder fra Unsplash (fri lisens, også kommersielt — ingen kreditering
 * kreves). Lenket direkte, slik Unsplash selv ber om, med størrelse i URL-en.
 * Bare klubbmotiver: scene, mikrofon, publikum ved bord.
 */
const photo = (id: string, w: number) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=75`

const PHOTOS = {
  comedian: { id: '1728674115193-6febdf9fe365', alt: 'Comedian with a microphone in front of a red curtain' },
  laughing: { id: '1681641095463-b4d3693a0ee3', alt: 'Woman laughing at a table with drinks during a show' },
  audience: { id: '1790348544752-b1d15a6d59a1', alt: 'Audience clapping during a live show' },
  room: { id: '1641903806973-17eaf2d2634f', alt: 'Microphone and stool on a club stage in front of a brick wall' },
  onStage: { id: '1647589047037-ba94e650388f', alt: 'Comedian on stage holding a microphone' },
  mic: { id: '1580188928585-0ef5c1a5c4dd', alt: 'Microphone on a stand in front of a red curtain' },
} as const

function Photo({
  p,
  w,
  className,
  priority,
  sizes = '(max-width: 768px) 100vw, 50vw',
}: {
  p: { id: string; alt: string }
  w: number
  className?: string
  priority?: boolean
  sizes?: string
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo(p.id, w)}
      srcSet={[640, 960, 1280, 1920].map((x) => `${photo(p.id, x)} ${x}w`).join(', ')}
      sizes={sizes}
      alt={p.alt}
      loading={priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      className={cn('size-full object-cover', className)}
    />
  )
}

/* ───────────────────────── Hero ───────────────────────── */

function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-8 px-4 pb-14 pt-4 sm:gap-12 sm:pb-20 sm:pt-8 md:px-8 md:pt-12 lg:grid-cols-[1fr_1fr]">
      <div>
        <p className="text-[13px] font-semibold text-[var(--ev-accent)] sm:text-[14px]">For comedy clubs and promoters</p>
        <h1 className={cn(H, 'mt-3 text-balance text-[34px] font-bold leading-[1.04] tracking-[-0.035em] sm:mt-4 sm:text-[48px] lg:text-[58px]')}>
          Tickets, booking and check&#8209;in. One place.
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
            Pricing
          </a>
        </div>
        <ul className="mt-6 flex flex-col gap-2 text-[14px] text-[var(--ev-muted)] sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-x-6">
          {['10% per ticket, card fees included', 'Scanner app for iPhone', 'Payouts via Stripe'].map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <Check className="size-4 text-[var(--ev-accent)]" aria-hidden /> {t}
            </li>
          ))}
        </ul>
      </div>

      {/* To klubbfoto: scenen og salen. På mobil ett bredt bilde med det andre som et lite innfelt kort. */}
      <div className="relative pb-10 sm:pb-12">
        <div className="aspect-[4/3] overflow-hidden rounded-[24px] bg-[var(--ev-poster-ground)] sm:rounded-[32px] lg:aspect-[5/6]">
          <Photo p={PHOTOS.comedian} w={1200} priority className="object-[50%_30%]" />
        </div>
        <div className="absolute bottom-0 left-3 w-[42%] overflow-hidden rounded-[18px] border-4 border-[var(--ev-bg)] shadow-[0_20px_40px_-20px_rgba(46,12,1,0.6)] sm:left-auto sm:right-[-12px] sm:w-[40%] sm:rounded-[24px] lg:-left-10 lg:right-auto">
          <div className="aspect-[4/5]">
            <Photo p={PHOTOS.laughing} w={600} sizes="(max-width: 768px) 42vw, 240px" />
          </div>
        </div>
      </div>
    </section>
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
            <p className={cn(H, 'mt-2 text-[80px] font-bold leading-[0.85] tracking-[-0.05em] sm:mt-3 sm:text-[110px] md:text-[140px]')}>10%</p>
            <h2 className={cn(H, 'mt-3 text-[24px] font-bold leading-[1.1] tracking-[-0.02em] sm:mt-4 md:text-[34px]')}>
              per ticket sold. That&rsquo;s the whole price.
            </h2>
            <ul className="mt-5 flex flex-col gap-2.5 text-[16px] text-[var(--ev-muted)] sm:text-[17px]">
              {['Card fees are included in our 10%', 'No tickets sold, nothing to pay', 'The rest is paid out to your club'].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check className="mt-1 size-4 shrink-0 text-[var(--ev-accent)]" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
          <PayoutCalculator />
        </div>
      </div>
    </section>
  )
}

/* ───────────────────────── Funksjoner ───────────────────────── */

/**
 * Tre ting klubben faktisk gjør en kveld — selge, slippe inn, booke — hver
 * med et bilde fra en klubb. Resten står som en kort liste under.
 */
const features = [
  {
    eyebrow: 'Ticket sales',
    title: 'Fill the room.',
    text: 'Every show gets its own page and a link you can share anywhere. Your shows are listed on Tickethalo too.',
    points: ['Multiple ticket types', 'Promo codes', 'Choose when sales end'],
    photo: PHOTOS.audience,
  },
  {
    eyebrow: 'Check-in',
    title: 'Get everyone in, fast.',
    text: 'Scan tickets at the door with the iPhone app, or right in the browser. No extra hardware.',
    points: ['Works on a regular iPhone', 'Browser scanner as backup', 'Tickets are checked once'],
    photo: PHOTOS.room,
  },
  {
    eyebrow: 'Booking',
    title: 'Build your line-up.',
    text: 'Browse comedians on the platform and send an offer with the date and fee. They answer with one tap.',
    points: ['Discover comedians', 'Send booking offers', 'Keep every gig in one place'],
    photo: PHOTOS.onStage,
  },
] as const

const extras = ['Payouts via Stripe', 'Sales and settlements per show', 'Export your audience list', 'Use an external ticket link if you need to']

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-6 px-4 py-14 sm:py-24 md:px-8">
      <p className="text-[13px] font-semibold text-[var(--ev-accent)] sm:text-[14px]">Features</p>
      <h2 className={cn(H, 'mt-2 max-w-2xl text-[30px] font-bold leading-[1.05] tracking-[-0.03em] sm:mt-3 sm:text-[40px] md:text-[48px]')}>
        Everything a club night needs. Nothing more.
      </h2>

      <div className="mt-10 flex flex-col gap-12 sm:mt-14 sm:gap-20">
        {features.map((f, i) => (
          <article key={f.eyebrow} className="grid items-center gap-5 sm:gap-8 md:grid-cols-2 md:gap-14">
            <div className={cn('aspect-[4/3] overflow-hidden rounded-[24px] bg-[var(--ev-poster-ground)] sm:rounded-[32px]', i % 2 === 1 && 'md:order-2')}>
              <Photo p={f.photo} w={1000} />
            </div>
            <div>
              <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-[var(--ev-accent)]">{f.eyebrow}</p>
              <h3 className={cn(H, 'mt-2 text-[28px] font-bold leading-[1.05] tracking-[-0.03em] sm:text-[36px]')}>{f.title}</h3>
              <p className="mt-3 max-w-md text-[16px] leading-[1.55] text-[var(--ev-muted)] sm:text-[17px]">{f.text}</p>
              <ul className="mt-5 flex flex-wrap gap-2">
                {f.points.map((pt) => (
                  <li key={pt} className="rounded-full bg-[var(--ev-card)] px-3.5 py-1.5 text-[14px] font-medium ring-1 ring-inset ring-[var(--ev-line)]">
                    {pt}
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>

      <div className="mt-14 rounded-[24px] bg-[var(--ev-card)] p-5 ring-1 ring-inset ring-[var(--ev-line)] sm:mt-20 sm:rounded-[28px] sm:p-8">
        <p className="text-[15px] font-semibold">Also included</p>
        <ul className="mt-3 grid gap-2.5 text-[15px] text-[var(--ev-muted)] sm:grid-cols-2 sm:gap-x-8">
          {extras.map((e) => (
            <li key={e} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-[var(--ev-accent)]" aria-hidden /> {e}
            </li>
          ))}
        </ul>
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
    a: 'A 10% fee per ticket sold. Card fees are included in that, so the other 90% of what the audience pays goes to your club.',
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
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[28px] bg-[var(--ev-poster-ground)] px-5 py-14 text-center text-white sm:rounded-[40px] md:py-24">
        <div className="absolute inset-0">
          <Photo p={PHOTOS.mic} w={1600} sizes="100vw" />
        </div>
        <div className="absolute inset-0 bg-black/55" aria-hidden />
        <div className="relative">
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
            className="mt-6 inline-flex h-12 cursor-pointer items-center gap-2 rounded-full bg-[var(--ev-accent-fill)] px-6 text-[15px] font-bold text-[var(--ev-accent-ink)] transition-transform hover:scale-[1.03] sm:mt-8 sm:h-14 sm:px-7 sm:text-[16px]"
          />
        </div>
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
