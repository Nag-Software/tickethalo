import type { Metadata } from 'next'
import Link from 'next/link'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import { maskEmail } from '@/lib/marketing/unsubscribe'
import { findUnsubscribeTarget } from '@/lib/marketing/unsubscribe-db'
import { setSubscriptionAction } from './actions'

export const metadata: Metadata = {
  title: 'Unsubscribe — Tickethalo',
  robots: { index: false, follow: false },
}

/**
 * Avmeldingssiden — lenken nederst i hver e-post fra en klubbs liste.
 *
 * Å åpne siden melder ikke av; knappen gjør det. E-postskannere åpner alle
 * lenker i en e-post, og ville ellers meldt av folk som aldri trykket. Gmail
 * og Apple Mail sin egen avmeldingsknapp går rett til /api/unsubscribe.
 *
 * Etter avmelding kan personen angre, i tilfelle trykket var feil.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const target = await findUnsubscribeTarget(token)

  return (
    <main
      lang="en"
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <section className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
        {!target ? (
          <>
            <h1 className="text-balance text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em]">
              This link does not work
            </h1>
            <p className="mt-4 text-[17px] leading-relaxed text-[var(--ev-muted)] sm:text-[15px]">
              It may be incomplete, or the contact may have been deleted. Reply to the email you got and ask the
              organiser to remove you from their list.
            </p>
          </>
        ) : target.unsubscribedAt ? (
          <>
            <h1 className="text-balance text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em]">
              You are unsubscribed
            </h1>
            <p className="mt-4 text-[17px] leading-relaxed text-[var(--ev-muted)] sm:text-[15px]">
              {maskEmail(target.email)} will not get more emails from {target.clubName}. Tickets you have bought are
              not affected.
            </p>
            <form action={setSubscriptionAction} className="mt-8">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="mode" value="resubscribe" />
              <button
                type="submit"
                className="text-[15px] font-medium text-[var(--ev-text)] underline underline-offset-4"
              >
                Unsubscribed by mistake? Subscribe again
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-balance text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em]">
              Unsubscribe from {target.clubName}
            </h1>
            <p className="mt-4 text-[17px] leading-relaxed text-[var(--ev-muted)] sm:text-[15px]">
              {maskEmail(target.email)} will stop getting emails about new shows from {target.clubName}
              {target.ads === 'active' ? ', and will no longer be used to show you their ads on Facebook and Instagram.' : '.'}
            </p>
            {target.ads === 'withdrawn' && (
              <p className="mt-3 text-[15px] leading-relaxed text-[var(--ev-muted)] sm:text-[14px]">
                Ads are stopped: {target.clubName} will not use this address to show you ads on Facebook and Instagram.
              </p>
            )}
            <form action={setSubscriptionAction} className="mt-8">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="mode" value="unsubscribe" />
              <button
                type="submit"
                className="h-12 w-full bg-[var(--ev-text)] px-6 text-[16px] font-semibold text-[var(--ev-bg)] transition-opacity hover:opacity-90"
                style={{ borderRadius: 'var(--ev-r-chip)' }}
              >
                Unsubscribe
              </button>
            </form>
            {/* Den som vil beholde e-postene, men ikke annonsene. */}
            {target.ads === 'active' && (
              <form action={setSubscriptionAction} className="mt-3">
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="mode" value="stop_ads" />
                <button
                  type="submit"
                  className="h-12 w-full border border-[var(--ev-line)] px-6 text-[16px] font-semibold text-[var(--ev-text)] transition-colors hover:bg-[var(--ev-text)]/5"
                  style={{ borderRadius: 'var(--ev-r-chip)' }}
                >
                  Keep the emails, stop the ads
                </button>
              </form>
            )}
          </>
        )}
        <p className="mt-10 text-[13px] text-[var(--ev-faint)]">
          How we handle your data: <Link href="/personvern" className="underline underline-offset-2">Privacy</Link>
        </p>
      </section>

      <Footer />
    </main>
  )
}
