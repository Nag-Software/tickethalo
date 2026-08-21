import Link from 'next/link'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { finalizeCheckoutSession } from '@/lib/checkout/finalize'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'

export const metadata = { title: 'Thanks for your purchase — Tickethalo' }

const SUPPORT_EMAIL = 'hei@tickethalo.com'

type Outcome = {
  tone: 'success' | 'warning' | 'error'
  heading: string
  message: string
}

/**
 * The page rendered as "Thanks for your purchase" no matter what happened
 * afterwards. When the ticket was never created that is the exact opposite of
 * what the buyer needs to hear, so every outcome gets its own copy — and a way
 * forward.
 */
function resolveOutcome(
  sessionId: string | undefined,
  session: Awaited<ReturnType<typeof getSession>>,
  completion: Awaited<ReturnType<typeof finalizeCheckoutSession>> | null
): Outcome {
  if (!sessionId) {
    return {
      tone: 'error',
      heading: 'No payment to show',
      message: 'This page appears after a completed purchase. Go to the show you want to see and buy a ticket from there.',
    }
  }

  if (!session) {
    return {
      tone: 'error',
      heading: 'We cannot find the payment',
      message: `We could not retrieve the purchase from the payment provider. Check your email — the ticket may be on its way. If you hear nothing, contact us at ${SUPPORT_EMAIL} with the time of the purchase.`,
    }
  }

  switch (completion?.result) {
    case 'created':
      return completion.emailSent
        ? { tone: 'success', heading: 'Thanks for your purchase', message: 'Your ticket has been sent by email.' }
        : {
            tone: 'warning',
            heading: 'Thanks for your purchase',
            message: 'The payment went through, but the ticket could not be emailed automatically. Keep the ticket code below — it gets you in.',
          }
    case 'duplicate':
      return {
        tone: 'success',
        heading: 'Thanks for your purchase',
        message: 'The ticket was already created and sent earlier.',
      }
    case 'unpaid':
      return {
        tone: 'warning',
        heading: 'The payment is not complete',
        message: 'We have not registered a payment yet. If it is approved, the ticket arrives by email automatically — you do not need to do anything else.',
      }
    case 'sold_out':
      return {
        tone: 'error',
        heading: 'The show sold out',
        message: `The last ticket was taken before your purchase completed, so we could not issue you one. Contact us at ${SUPPORT_EMAIL} and we will refund you.`,
      }
    case 'failed':
    case 'missing_show':
      return {
        tone: 'error',
        heading: 'We could not complete the ticket',
        message: `The payment may have gone through, but the ticket was not created. Contact us at ${SUPPORT_EMAIL} with the reference below and we will sort it out.`,
      }
    default:
      return {
        tone: 'success',
        heading: 'Thanks for your purchase',
        message: 'Your ticket is on its way by email.',
      }
  }
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; s?: string }>
}) {
  const { session_id, s: showId } = await searchParams
  const seller = await getSeller(showId, session_id)
  const session = session_id ? await getSession(session_id, seller?.stripe_account_id ?? null) : null
  const completion = session ? await finalizeCheckoutSession(session, { accountId: seller?.stripe_account_id ?? null }) : null
  const outcome = resolveOutcome(session_id, session, completion)

  const sellerName = seller?.legal_name?.trim() || seller?.name?.trim() || null

  if (outcome.tone !== 'success') {
    console.warn(`[Checkout Success] ${outcome.heading} — session=${session_id ?? 'none'} result=${completion?.result ?? 'none'}`)
  }

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
          {outcome.tone === 'success' ? (
            <CheckCircle2
              className="size-10"
              style={{ color: 'var(--ev-accent-fill)' }}
              aria-hidden
            />
          ) : (
            <AlertTriangle className="size-10 text-[var(--ev-accent)]" aria-hidden />
          )}
          <h1 className="mt-5 text-balance text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-4xl">
            {outcome.heading}
          </h1>
          {/* role="alert" — the buyer must not miss that something went wrong. */}
          <p
            role={outcome.tone === 'success' ? undefined : 'alert'}
            className={
              outcome.tone === 'success'
                ? 'mt-2.5 text-[15px] leading-relaxed text-[var(--ev-muted)]'
                : 'mt-2.5 text-[15px] leading-relaxed text-[var(--ev-accent)]'
            }
          >
            {outcome.message}
          </p>

          {/* The reference is shown even when we could not fetch the payment — it
              is the only thing support has to search for in Stripe. */}
          {(session || (session_id && outcome.tone !== 'success')) && (
            <dl className="mt-7 flex flex-col divide-y divide-[var(--ev-line)] border-y border-[var(--ev-line)] text-[14px]">
              {session && <Row label="Show" value={session.metadata?.show_title ?? 'Tickethalo'} />}
              {sellerName && <Row label="Seller" value={sellerName} />}
              {session?.metadata?.show_date && <Row label="Date" value={session.metadata.show_date} />}
              {session && (
                <Row
                  label="Email"
                  value={session.customer_details?.email ?? session.customer_email ?? 'Not available'}
                />
              )}
              {completion?.ticketCode && <Row label="Ticket code" value={completion.ticketCode} mono />}
              {outcome.tone !== 'success' && session_id && <Row label="Reference" value={session_id} mono />}
            </dl>
          )}

          {/* Klubben er selger og arrangør — Tickethalo formidler billetten.
              Kjøperen skal vite hvem avtalen er med, og hvem de kontakter. */}
          {sellerName && (
            <p className="mt-6 text-[13px] leading-relaxed text-[var(--ev-faint)]">
              Sold by {sellerName}
              {seller?.org_number ? ` (org. no. ${seller.org_number})` : ''}, the organiser of this show.
              {seller?.support_email ? (
                <>
                  {' '}Questions about the show:{' '}
                  <a href={`mailto:${seller.support_email}`} className="underline underline-offset-2">
                    {seller.support_email}
                  </a>
                  .
                </>
              ) : null}{' '}
              Tickethalo handles the ticketing — see our{' '}
              <Link href="/kjopsvilkar" className="underline underline-offset-2">
                terms of purchase
              </Link>
              .
            </p>
          )}

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link
              href="/events"
              className="inline-flex h-11 items-center justify-center bg-[var(--ev-text)] px-5 text-[13px] font-semibold text-[var(--ev-bg)] transition-colors hover:bg-[var(--ev-accent-fill)] hover:text-[var(--ev-accent-ink)]"
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              See more shows
            </Link>
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center px-5 text-[13px] font-semibold text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line-strong)] transition-colors hover:text-[var(--ev-text)]"
              style={{ borderRadius: 'var(--ev-r-chip)' }}
            >
              Home
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

async function getSession(sessionId: string, accountId: string | null) {
  try {
    // Betalingen er en direct charge på klubbens Connect-konto — sesjonen
    // finnes ikke på plattformkontoen. Uten kontoen får vi 404 her.
    return await stripe.checkout.sessions.retrieve(
      sessionId,
      undefined,
      accountId ? { stripeAccount: accountId } : undefined,
    )
  } catch (error) {
    console.error('[Checkout Success] Could not retrieve session:', error)
    return null
  }
}

/**
 * Klubben bak showet. `s` i success-URL-en peker på showet, ikke på
 * Stripe-kontoen — konto-ID-en slås opp her i stedet for å eksponeres.
 */
async function getSeller(showId: string | undefined, sessionId: string | undefined) {
  const db = createAdminClient()

  let clubId: string | null = null

  if (showId) {
    const { data: show } = await db.from('shows').select('club_id').eq('id', showId).maybeSingle()
    clubId = show?.club_id ?? null
  }

  // Eldre kjøpslenker har ingen `s`. Da finner vi kontoen via ordren
  // webhooken allerede har opprettet, i stedet for å vise kjøperen en feil.
  if (!clubId && sessionId) {
    const { data: order } = await db
      .from('orders')
      .select('club_id')
      .eq('stripe_checkout_session_id', sessionId)
      .maybeSingle()
    clubId = order?.club_id ?? null
  }

  if (!clubId) return null

  const { data: club } = await db
    .from('clubs')
    .select('name, legal_name, org_number, support_email, stripe_account_id')
    .eq('id', clubId)
    .maybeSingle()

  return club ?? null
}
