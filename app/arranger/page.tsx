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
  title: 'Tickethalo for komiklubber — billetter, booking og innsjekk',
  description: 'Selg billetter, book komikere og skann i døra. Klubben får 90 % av hver billett.',
}

const H = '[font-family:var(--font-display)]'

export default function ArrangerPage() {
  return (
    <main
      lang="nb"
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
    <header className="mx-auto flex h-20 max-w-6xl items-center justify-between px-5 md:px-8">
      <Link href="/arranger" className="flex h-9 items-center rounded-full bg-[var(--ev-accent-fill)] px-3">
        <BrandLogoResponsive tone="dark" priority className="h-5" />
      </Link>
      <nav aria-label="Hovedmeny" className="flex items-center gap-1 text-[14px] font-medium">
        <a href="#pris" className="hidden rounded-full px-3 py-2 text-[var(--ev-muted)] hover:text-[var(--ev-text)] md:block">
          Pris
        </a>
        <a href="#funksjoner" className="hidden rounded-full px-3 py-2 text-[var(--ev-muted)] hover:text-[var(--ev-text)] md:block">
          Funksjoner
        </a>
        <a href="#sporsmal" className="hidden rounded-full px-3 py-2 text-[var(--ev-muted)] hover:text-[var(--ev-text)] md:block">
          Spørsmål
        </a>
        <Link href="/admin-app/login" className="rounded-full px-3 py-2 text-[var(--ev-muted)] hover:text-[var(--ev-text)]">
          Logg inn
        </Link>
        <BetaAccessDialog
          source="arranger-header"
          label="Be om tilgang"
          className="cursor-pointer rounded-full bg-[var(--ev-text)] px-4 py-2 font-semibold text-[var(--ev-bg)] hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
        />
      </nav>
    </header>
  )
}

/* ───────────────────────── Hero ───────────────────────── */

function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-8 md:px-8 md:pt-14 lg:grid-cols-[1fr_1.05fr]">
      <div>
        <p className="text-[14px] font-semibold text-[var(--ev-accent)]">For komiklubber og arrangører</p>
        <h1 className={cn(H, 'mt-4 text-balance text-[40px] font-bold leading-[1.02] tracking-[-0.035em] sm:text-[52px] lg:text-[60px]')}>
          Billetter, booking og innsjekk. Ett sted.
        </h1>
        <p className="mt-5 max-w-lg text-[18px] leading-[1.5] text-[var(--ev-muted)]">
          Legg ut et show, selg billetter, finn komikere og skann publikum i døra. Bygget for klubber som vil bruke kvelden på
          scenen — ikke i regneark.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <BetaAccessDialog
            source="arranger-hero"
            label="Be om tilgang"
            withArrow
            className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-full bg-[var(--ev-text)] px-6 text-[16px] font-semibold text-[var(--ev-bg)] hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
          />
          <a href="#pris" className="inline-flex h-12 items-center px-3 text-[16px] font-semibold underline-offset-4 hover:underline">
            Se hva du sitter igjen med
          </a>
        </div>
        <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-[var(--ev-muted)]">
          {['90 % av billettprisen til klubben', 'Kortgebyrer dekket', 'Skanner-app for iPhone'].map((t) => (
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
      <div className="rounded-[28px] bg-white p-5 text-[#1b0800] shadow-[0_40px_80px_-40px_rgba(46,12,1,0.45)] ring-1 ring-black/5 md:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium text-black/50">Fredag 21. nov · 20:00</p>
            <p className={cn(H, 'mt-1 text-[22px] font-bold leading-tight')}>Fredagsimpro med gjester</p>
          </div>
          <span className="shrink-0 whitespace-nowrap rounded-full bg-[#e8f6ec] px-2.5 py-1 text-[12px] font-semibold text-[#1d6b35]">I salg</span>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            ['Solgt', '142 / 150'],
            ['Til klubben', 'kr 38 340'],
            ['Snittpris', 'kr 286'],
          ].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-black/[0.04] p-3">
              <p className="text-[12px] text-black/50">{k}</p>
              <p className="mt-1 text-[17px] font-semibold tabular-nums">{v}</p>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <div className="h-2.5 overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full w-[94%] rounded-full bg-[var(--ev-accent-fill)]" />
          </div>
          <p className="mt-2 text-[12px] text-black/50">94 % solgt · 8 billetter igjen</p>
        </div>

        <div className="mt-6 space-y-2.5">
          {[
            ['Ordinær', 'kr 300', '118'],
            ['Student', 'kr 220', '24'],
          ].map(([name, price, sold]) => (
            <div key={name} className="flex items-center justify-between rounded-xl border border-black/[0.07] px-3.5 py-2.5 text-[14px]">
              <span className="font-medium">{name}</span>
              <span className="text-black/50">
                {price} · {sold} solgt
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Skanneren — telefonen ligger over kortet */}
      <div className="absolute -bottom-2 -right-2 w-[168px] rotate-[4deg] rounded-[30px] bg-[#1b0800] p-2 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)] sm:-right-8 sm:w-[190px] lg:-bottom-14">
        <div className="rounded-[24px] bg-[#1d6b35] px-4 pb-6 pt-8 text-center text-white">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-white/20">
            <Check className="size-8" strokeWidth={3} />
          </div>
          <p className={cn(H, 'mt-3 text-[20px] font-bold')}>Gyldig</p>
          <p className="mt-1 text-[12px] text-white/80">Ordinær · 2 personer</p>
          <p className="mt-4 rounded-full bg-white/15 py-1.5 text-[11px] font-medium">Sjekket inn 19:42</p>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Pris ───────────────────────── */

function Payout() {
  return (
    <section id="pris" className="scroll-mt-6 px-3 md:px-6">
      <div className="ev-surface mx-auto max-w-6xl rounded-[40px] bg-[var(--ev-bg)] px-6 py-14 text-[var(--ev-text)] md:px-14 md:py-20" data-tone="dark">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="text-[14px] font-semibold text-[var(--ev-accent)]">Pris</p>
            <p className={cn(H, 'mt-3 text-[96px] font-bold leading-[0.85] tracking-[-0.05em] md:text-[140px]')}>90 %</p>
            <h2 className={cn(H, 'mt-4 text-[28px] font-bold leading-[1.1] tracking-[-0.02em] md:text-[34px]')}>
              av hver billett går til klubben.
            </h2>
            <p className="mt-4 max-w-md text-[17px] leading-[1.55] text-[var(--ev-muted)]">
              Vi tar 10 %, og av dem betaler vi kortgebyrene. Det du ser i kalkulatoren er det som havner på kontoen din.
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
    title: 'Billettsalg',
    text: 'Egen side per show med delbar lenke. Flere billettyper, rabattkoder og salgsstopp når du vil.',
    wide: true,
  },
  {
    icon: QrCode,
    title: 'Innsjekk i døra',
    text: 'Skann billetter med iPhone-appen eller rett i nettleseren.',
  },
  {
    icon: Mic,
    title: 'Finn komikere',
    text: 'Bla i komikere på plattformen og bygg line-upen din.',
  },
  {
    icon: Send,
    title: 'Send bookingtilbud',
    text: 'Send tilbud med dato og honorar. Komikeren svarer med ett trykk.',
  },
  {
    icon: Wallet,
    title: 'Utbetaling',
    text: 'Pengene går rett til klubbens konto via Stripe. Oversikt over salg og oppgjør i portalen.',
    wide: true,
  },
  {
    icon: Users,
    title: 'Kundeliste',
    text: 'Se hvem som har kjøpt, og eksporter listen når du vil nå dem igjen.',
  },
] as const

function Features() {
  return (
    <section id="funksjoner" className="mx-auto max-w-6xl scroll-mt-6 px-5 py-24 md:px-8">
      <div className="max-w-2xl">
        <p className="text-[14px] font-semibold text-[var(--ev-accent)]">Funksjoner</p>
        <h2 className={cn(H, 'mt-3 text-[36px] font-bold leading-[1.05] tracking-[-0.03em] md:text-[48px]')}>
          Alt en klubbkveld trenger. Ikke mer.
        </h2>
      </div>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {features.map(({ icon: Icon, title, text, ...rest }) => (
          <div
            key={title}
            className={cn(
              'rounded-[28px] bg-[var(--ev-card)] p-6 ring-1 ring-inset ring-[var(--ev-line)] md:p-8',
              'wide' in rest && rest.wide && 'md:col-span-2'
            )}
          >
            <span className="grid size-11 place-items-center rounded-2xl bg-[var(--ev-accent-fill)] text-[var(--ev-accent-ink)]">
              <Icon className="size-5" aria-hidden />
            </span>
            <h3 className={cn(H, 'mt-8 text-[22px] font-bold tracking-[-0.01em]')}>{title}</h3>
            <p className="mt-2 max-w-md text-[16px] leading-[1.5] text-[var(--ev-muted)]">{text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ───────────────────────── Slik kommer du i gang ───────────────────────── */

const steps = [
  { title: 'Få tilgang', text: 'Vi setter opp klubben sammen med dere. Koble til Stripe for utbetalinger.' },
  { title: 'Legg ut et show', text: 'Dato, sted og billettpris. Showet får sin egen side med en gang.' },
  { title: 'Del lenken', text: 'Selg på Instagram, i nyhetsbrev eller i baren. Showet ligger også på Tickethalo.' },
  { title: 'Skann og spill', text: 'Åpne skanneren i døra. Etter showet kommer oppgjøret av seg selv.' },
]

function Steps() {
  return (
    <section className="border-y border-[var(--ev-line)]">
      <div className="mx-auto max-w-6xl px-5 py-20 md:px-8">
        <h2 className={cn(H, 'text-[32px] font-bold tracking-[-0.03em] md:text-[40px]')}>Fra null til første show</h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title}>
              <span className={cn(H, 'text-[56px] font-bold leading-none text-[var(--ev-accent-fill)]')}>{i + 1}</span>
              <h3 className="mt-3 text-[18px] font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-[15px] leading-[1.5] text-[var(--ev-muted)]">{s.text}</p>
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
    q: 'Hvordan kommer vi i gang?',
    a: 'Klubbportalen er åpen for inviterte mens vi er i beta. Be om tilgang, så tar vi kontakt og setter dere opp.',
  },
  {
    q: 'Hva koster det?',
    a: 'Tickethalo tar 10 % av billettprisen. Kortgebyrene betaler vi av vår andel, så klubben får 90 % av det publikum betaler.',
  },
  {
    q: 'Når får vi pengene?',
    a: 'Utbetalingene går via Stripe direkte til klubbens bankkonto. Du ser salg og oppgjør per show i portalen.',
  },
  {
    q: 'Trenger vi eget utstyr i døra?',
    a: 'Nei. Skanner-appen kjører på en vanlig iPhone, og det finnes også en skanner i nettleseren.',
  },
  {
    q: 'Kan vi selge billetter andre steder samtidig?',
    a: 'Ja. Hvert show kan også peke til en ekstern billettlenke hvis dere allerede har avtaler et annet sted.',
  },
]

function Faq() {
  return (
    <section id="sporsmal" className="mx-auto max-w-3xl scroll-mt-6 px-5 py-24 md:px-8">
      <h2 className={cn(H, 'text-[32px] font-bold tracking-[-0.03em] md:text-[40px]')}>Spørsmål</h2>
      <div className="mt-8 divide-y divide-[var(--ev-line)] border-y border-[var(--ev-line)]">
        {faq.map((f) => (
          <details key={f.q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[18px] font-semibold [&::-webkit-details-marker]:hidden">
              {f.q}
              <span
                aria-hidden
                className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--ev-card)] text-[20px] leading-none transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 max-w-2xl text-[16px] leading-[1.6] text-[var(--ev-muted)]">{f.a}</p>
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
      <div className="mx-auto max-w-6xl rounded-[40px] bg-[var(--ev-accent-fill)] px-6 py-16 text-center text-white md:py-24">
        <h2 className={cn(H, 'mx-auto max-w-2xl text-balance text-[36px] font-bold leading-[1.05] tracking-[-0.03em] md:text-[52px]')}>
          Vil klubben deres være med?
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[17px] text-white/85">
          Tickethalo er i beta, og vi tar inn nye klubber fortløpende.
        </p>
        <BetaAccessDialog
          source="arranger-final"
          label="Be om tilgang"
          withArrow
          className="mt-8 inline-flex h-14 cursor-pointer items-center gap-2 rounded-full bg-white px-7 text-[16px] font-bold text-black transition-transform hover:scale-[1.03]"
        />
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-10 text-[14px] text-[var(--ev-muted)] md:flex-row md:px-8">
      <span>© {new Date().getFullYear()} Tickethalo</span>
      <nav aria-label="Bunntekst" className="flex flex-wrap justify-center gap-x-5 gap-y-2">
        <Link href="/" className="hover:text-[var(--ev-text)]">For publikum</Link>
        <Link href="/vilkar" className="hover:text-[var(--ev-text)]">Plattformvilkår</Link>
        <Link href="/personvern" className="hover:text-[var(--ev-text)]">Personvern</Link>
      </nav>
    </footer>
  )
}
