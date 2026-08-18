import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { stripe } from '@/lib/stripe'
import { finalizeCheckoutSession } from '@/lib/checkout/finalize'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'

export const metadata = { title: 'Takk for kjøpet — humor.events' }

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>
}) {
  const { session_id } = await searchParams
  const session = session_id ? await getSession(session_id) : null
  const completion = session ? await finalizeCheckoutSession(session) : null

  const emailFailed = completion?.result === 'created' && !completion.emailSent
  const status = completion?.result === 'created'
    ? completion.emailSent
      ? 'Billetten er sendt på e-post.'
      : 'Betalingen er godkjent, men billetten kunne ikke sendes automatisk. Ta vare på billettkoden under — den slipper deg inn.'
    : completion?.result === 'duplicate'
      ? 'Billetten er allerede opprettet og sendt tidligere.'
      : 'Billetten din sendes på e-post.'

  return (
    <main
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <section className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-24 md:px-8">
        <div
          className="bg-[var(--ev-card)] p-7 sm:p-9"
          style={{ borderRadius: 'var(--ev-r-card)' }}
        >
          <CheckCircle2
            className="size-10"
            style={{ color: 'var(--ev-accent-fill)' }}
            aria-hidden
          />
          <h1 className="mt-5 text-balance text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
            Takk for kjøpet
          </h1>
          <p
            className={
              emailFailed
                ? 'mt-2.5 text-[15px] leading-relaxed text-[var(--ev-accent)]'
                : 'mt-2.5 text-[15px] leading-relaxed text-[var(--ev-muted)]'
            }
          >
            {status}
          </p>

          {session && (
            <dl className="mt-7 flex flex-col divide-y divide-[var(--ev-line)] border-y border-[var(--ev-line)] text-[14px]">
              <Row label="Show" value={session.metadata?.show_title ?? 'humor.events'} />
              {session.metadata?.show_date && <Row label="Dato" value={session.metadata.show_date} />}
              <Row
                label="E-post"
                value={session.customer_details?.email ?? session.customer_email ?? 'Ikke tilgjengelig'}
              />
              {completion?.ticketCode && <Row label="Billettkode" value={completion.ticketCode} mono />}
            </dl>
          )}

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link
              href="/events"
              className="inline-flex h-11 items-center justify-center bg-[var(--ev-text)] px-5 text-[13px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              Se flere show
            </Link>
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center px-5 text-[13px] font-semibold text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line-strong)] transition-colors hover:text-[var(--ev-text)]"
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              Forsiden
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[var(--ev-faint)]">{label}</dt>
      <dd className={mono ? 'truncate font-mono tracking-tight' : 'truncate text-right font-medium'}>
        {value}
      </dd>
    </div>
  )
}

async function getSession(sessionId: string) {
  try {
    return await stripe.checkout.sessions.retrieve(sessionId)
  } catch (error) {
    console.error('[Checkout Success] Could not retrieve session:', error)
    return null
  }
}
