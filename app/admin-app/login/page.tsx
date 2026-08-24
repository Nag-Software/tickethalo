import { redirect } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { ArrowRight } from 'lucide-react'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import { LoginForm } from '@/components/login-form'
import { BookerPreview } from '@/components/public/booker-preview'
import { createClient } from '@/lib/supabase/server'
import { getPortalDestinationForAuthUser } from '@/lib/portal-auth'

export const metadata = { title: 'Comedy club portal — Tickethalo' }

/** Clubs cannot self-register yet — the portal is invite only during the beta. */
const BETA_HREF = 'mailto:hei@tickethalo.com?subject=Beta%20access%20-%20comedy%20club%20portal'

/** The violet CTA from the design. The orange accent stays the page's accent colour. */
const VIOLET_CTA =
  'bg-[var(--ev-text)] text-white hover:bg-[var(--ev-accent-fill)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4c1d95]'

const STEPS = [
  'Pick comedians for your club',
  'Book a line-up in one click',
  'Sell out your tickets',
  'Pay the comedians',
]

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const adminPrefix = '/admin-app'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const destination = await getPortalDestinationForAuthUser(user.id)
    if (destination === adminPrefix || destination === '/superadmin') redirect(adminPrefix)
    if (destination) redirect(destination)
  }

  const errorMessage = error === 'unauthorized'
    ? 'This account belongs to a different portal.'
    : error === 'invalid'
      ? 'Invalid email or password.'
      : undefined

  return (
    <main
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      {/* ── Hero + sign in ──────────────────────────────────── */}
      <section className="mx-auto grid w-full max-w-5xl items-start gap-10 px-4 pb-20 pt-28 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-16">
        <div className="lg:pt-4">
          <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[var(--ev-accent-fill)]">
            Sign up
          </p>
          <h1 className="mt-3 text-balance text-[2.25rem] font-bold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
            Run your comedy club on autopilot
          </h1>

          <ol className="mt-8 flex flex-col gap-3.5">
            {STEPS.map((step, i) => (
              <li key={step} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="grid size-6 shrink-0 place-content-center rounded-full bg-[var(--ev-accent-fill)] text-[12px] font-semibold text-[var(--ev-accent-ink)]"
                >
                  {i + 1}
                </span>
                <span className="text-[15px] font-medium">{step}</span>
              </li>
            ))}
          </ol>

          <p className="mt-8 text-[15px] font-medium">All for the price of a regular ticket service.</p>

          <Link
            href={BETA_HREF}
            className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-[var(--ev-accent)] underline underline-offset-4"
          >
            Request beta access <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        <div className="w-full lg:justify-self-end">
          <LoginForm
            brandLabel="Tickethalo"
            title="Comedy club portal"
            description="Sign in with your club account"
            action={`${adminPrefix}/login/submit`}
            errorMessage={errorMessage}
            signupHref={BETA_HREF}
            signupPrompt="New club?"
            signupLabel="Request beta access"
            submitClassName={VIOLET_CTA}
            theme="portal"
          />
        </div>
      </section>

      {/* ── Testimonial ─────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-20 md:px-8">
        <figure className="flex flex-col items-center gap-6 rounded-[2rem] border border-[var(--ev-accent-fill)]/45 px-6 py-8 text-center sm:flex-row sm:gap-10 sm:px-10 sm:text-left">
          <div className="size-50 shrink-0 overflow-hidden rounded-full sm:size-55">
            <Image
              src="/mann.png"
              alt="Tom Soyler"
              width={350}
              height={350}
              className="w-full object-cover"
            />
          </div>
          <div>
            <blockquote className="text-balance text-[1.25rem] font-medium leading-[1.35] tracking-[-0.02em] sm:text-[1.5rem]">
              It&rsquo;s like having a full time PA without paying for one. Now I finally have time to
              focus on selling out the shows!
            </blockquote>
            <figcaption className="mt-4 text-[14px] italic text-[var(--ev-muted)]">
              &ndash; Tom Soyler, owner of Cr&oslash;nch Comedy Club
            </figcaption>
          </div>
        </figure>
      </section>

      {/* ── One-click Booker ────────────────────────────────── */}
      <section className="mx-auto grid w-full max-w-5xl items-center gap-10 px-4 pb-24 md:px-8 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] lg:gap-16">
        <BookerPreview />

        <div>
          <p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[var(--ev-accent-fill)]">
            Save hours every week
          </p>
          <h2 className="mt-3 text-balance text-[2rem] font-bold leading-[1.08] tracking-[-0.035em] sm:text-[2.5rem]">
            One-click Booker&trade;
          </h2>
          <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-[var(--ev-muted)]">
            Book your next line-up, without giving up control.{' '}
            <strong className="font-semibold text-[var(--ev-text)]">
              Hand-pick a pool of comedians for your club, set all the dates for the next month, and
              let Tickethalo do the rest.
            </strong>
          </p>

          <Link
            href={BETA_HREF}
            className={`mt-8 inline-flex h-11 items-center rounded-full px-7 text-[13px] font-semibold transition-colors ${VIOLET_CTA}`}
          >
            Request beta access
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  )
}
