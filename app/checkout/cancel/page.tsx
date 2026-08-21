import Link from 'next/link'
import { XCircle } from 'lucide-react'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'

export const metadata = { title: 'Payment cancelled — Tickethalo' }

export default async function CheckoutCancelPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>
}) {
  const { event } = await searchParams
  const eventHref = event ? `/events/${event}` : '/events'

  return (
    <main
      // The document root is still lang="nb" for the Norwegian portals — see
      // app/page.tsx for why this page declares its own language.
      lang="en"
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <section className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-24 md:px-8">
        <div
          className="bg-[var(--ev-card)] p-7 sm:p-9"
          style={{ borderRadius: 'var(--ev-r-card)' }}
        >
          <XCircle className="size-10 text-[var(--ev-faint)]" aria-hidden />
          <h1 className="mt-5 text-balance text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
            The payment was cancelled
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-[var(--ev-muted)]">
            Nothing has been charged. The ticket is not reserved, so the seat may be taken by
            someone else — go back to the show if you want to try again.
          </p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link
              href={eventHref}
              className="inline-flex h-11 items-center justify-center bg-[var(--ev-text)] px-5 text-[13px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              Back to the show
            </Link>
            <Link
              href="/events"
              className="inline-flex h-11 items-center justify-center px-5 text-[13px] font-semibold text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line-strong)] transition-colors hover:text-[var(--ev-text)]"
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              All shows
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
