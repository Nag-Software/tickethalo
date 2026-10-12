import Link from 'next/link'
import { orgNumberLabel, receiptVatNote } from '@/lib/ticket-vat'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import { finalizeCheckoutSession } from '@/lib/checkout/finalize'
import { isFreeOrderSessionId } from '@/lib/checkout/free'
import { formatTicketCode } from '@/lib/tickets'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import type { OrderCancellationReason } from '@/types/database'

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

  // Betalt, men ingen billett. Kom webhooken først, får denne siden
  // `duplicate` — da er det ordren som vet hvorfor, via `cancellationReason`.
  const noTicketReason =
    completion?.result === 'sold_out' || completion?.result === 'invalid_show' || completion?.result === 'sales_closed'
      ? completion.result
      : completion?.cancellationReason ?? null

  if (noTicketReason) {
    return noTicketOutcome(noTicketReason, completion?.refunded === true)
  }

  switch (completion?.result) {
    case 'created':
      return completion.emailSent
        ? { tone: 'success', heading: 'Thanks for your purchase', message: 'The ticket will be sent to your email soon.' }
        : {
            tone: 'warning',
            heading: 'Thanks for your purchase',
            message: 'The payment went through, but the ticket could not be emailed automatically. Keep the ticket code below — it gets you in.',
          }
    case 'duplicate':
      // En betalt ordre har alltid minst én billett. Uten koder, og uten at
      // ordren kunne leses, vet vi ikke nok til å love at billetten er sendt.
      if (!completion.ticketCode && !(completion.ticketCodes?.length ?? 0)) {
        return {
          tone: 'warning',
          heading: 'We could not confirm your ticket',
          message: `The payment was registered, but we could not confirm that a ticket was issued. Check your email in a few minutes. If no ticket arrives, contact us at ${SUPPORT_EMAIL} with the reference below.`,
        }
      }
      // `emailSent` er sant både når e-posten gikk nå og når den gikk tidligere
      // (`ticket_email_sent_at`). Usant betyr at den feilet — da skal ikke
      // siden love at den er sendt.
      return completion.emailSent
        ? { tone: 'success', heading: 'Thanks for your purchase', message: 'The ticket will be sent to your email soon.' }
        : {
            tone: 'warning',
            heading: 'Thanks for your purchase',
            message: 'The payment went through, but the ticket could not be emailed automatically. Keep the ticket code below — it gets you in.',
          }
    case 'unpaid':
      return {
        tone: 'warning',
        heading: 'The payment is not complete',
        message: 'We have not registered a payment yet. If it is approved, the ticket arrives by email automatically — you do not need to do anything else.',
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

/**
 * The buyer paid, but no ticket could be issued. The payment is refunded
 * automatically (see `finalizeCheckoutSession` and the refund queue), so the
 * copy says so instead of asking the buyer to chase us for their money — and
 * never suggests a ticket is on its way.
 *
 * `invalid_show` covers more than a cancelled show: an archived or unpublished
 * show, and a payment that completed after midnight on show day, when sales
 * had already ended. The copy stays neutral instead of claiming a cancellation.
 */
function noTicketOutcome(reason: OrderCancellationReason, refunded: boolean): Outcome {
  const refund = refunded
    ? 'Your payment has been refunded automatically. It can take a few business days before it shows up in your account.'
    : 'Your payment will be refunded automatically within a few days — you do not need to do anything.'

  switch (reason) {
    case 'sold_out':
      return {
        tone: 'error',
        heading: 'The show sold out',
        message: `The last tickets were taken before your purchase completed, so we could not issue you one. ${refund} Questions? Contact us at ${SUPPORT_EMAIL}.`,
      }
    case 'sales_closed':
      return {
        tone: 'error',
        heading: 'Ticket sales have closed',
        message: `The organiser closed ticket sales for this show before your payment completed, so no ticket was issued. ${refund} Questions? Contact us at ${SUPPORT_EMAIL}.`,
      }
    case 'invalid_show':
    default:
      return {
        tone: 'error',
        heading: 'No ticket was issued',
        message: `Ticket sales for this show had ended before your payment completed, so no ticket was issued. ${refund} Questions? Contact us at ${SUPPORT_EMAIL}.`,
      }
  }
}

/**
 * Hva siden viser under overskriften. Betalte kjøp henter det fra Stripe-
 * sesjonen, gratisbilletter fra ordren selv (`lib/checkout/free.ts`).
 */
type Details = {
  showTitle: string
  showDate: string | null
  email: string
  ticketCodes: string[]
}

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; s?: string; order?: string }>
}) {
  const { session_id, s: showId, order: orderId } = await searchParams
  // Gratisbilletter har ingen Stripe-sesjon: ordren er alt som finnes.
  const freeOrder = !session_id && orderId ? await getFreeOrder(orderId) : null
  const seller = await getSeller(showId ?? freeOrder?.show_id ?? undefined, session_id)
  const session = session_id ? await getSession(session_id, seller?.stripe_account_id ?? null) : null
  const completion = session ? await finalizeCheckoutSession(session, { accountId: seller?.stripe_account_id ?? null }) : null
  const outcome = freeOrder ? freeOutcome(freeOrder) : resolveOutcome(session_id, session, completion)

  const ticketCodes = completion?.ticketCodes?.length
    ? completion.ticketCodes
    : completion?.ticketCode
      ? [completion.ticketCode]
      : []
  const details: Details | null = session
    ? {
        showTitle: session.metadata?.show_title ?? 'Tickethalo',
        showDate: session.metadata?.show_date ?? null,
        email: session.customer_details?.email ?? session.customer_email ?? 'Not available',
        ticketCodes,
      }
    : freeOrder
      ? {
          showTitle: freeOrder.showTitle,
          showDate: freeOrder.showDate,
          email: freeOrder.email,
          ticketCodes: freeOrder.ticketCodes,
        }
      : null

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
          {(details || (session_id && outcome.tone !== 'success')) && (
            <dl className="mt-7 flex flex-col divide-y divide-[var(--ev-line)] border-y border-[var(--ev-line)] text-[14px]">
              {details && <Row label="Show" value={details.showTitle} />}
              {sellerName && <Row label="Seller" value={sellerName} />}
              {details?.showDate && <Row label="Date" value={details.showDate} />}
              {details && <Row label="Email" value={details.email} />}
              {/* Flere billetter i én ordre får hver sin kode — e-posten
                  bærer QR-ene, men koden skal være synlig her også. */}
              {(details?.ticketCodes.length ?? 0) > 1 ? (
                <Row
                  label={`Ticket codes (${details!.ticketCodes.length})`}
                  value={details!.ticketCodes.map(formatTicketCode).join(', ')}
                  mono
                />
              ) : (
                details?.ticketCodes[0] && (
                  <Row label="Ticket code" value={formatTicketCode(details.ticketCodes[0])} mono />
                )
              )}
              {outcome.tone !== 'success' && session_id && <Row label="Reference" value={session_id} mono />}
            </dl>
          )}

          {/* Klubben er selger og arrangør — Tickethalo formidler billetten.
              Kjøperen skal vite hvem avtalen er med, og hvem de kontakter. */}
          {sellerName && (
            <p className="mt-6 text-[13px] leading-relaxed text-[var(--ev-faint)]">
              Sold by {sellerName}
              {seller?.org_number ? ` (${orgNumberLabel(seller.country, 'en')} ${seller.org_number})` : ''}, the organiser of this show.
              {' '}{receiptVatNote(seller ?? {}, 'en')}
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

type FreeOrder = {
  show_id: string | null
  showTitle: string
  showDate: string | null
  email: string
  ticketCodes: string[]
  emailSent: boolean
}

/**
 * En gratisordre, kjent igjen på sesjons-ID-en. Andre ordrer vises ikke her:
 * de har en Stripe-sesjon, og den er nøkkelen til denne siden.
 */
async function getFreeOrder(orderId: string): Promise<FreeOrder | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) return null

  const db = createAdminClient()
  const { data: order } = await db
    .from('orders')
    .select('id, show_id, buyer_email, stripe_checkout_session_id, ticket_email_sent_at')
    .eq('id', orderId)
    .maybeSingle()
  if (!order || !isFreeOrderSessionId(order.stripe_checkout_session_id)) return null

  const [{ data: tickets }, { data: show }] = await Promise.all([
    db.from('tickets').select('ticket_code').eq('order_id', order.id).order('created_at'),
    order.show_id
      ? db.from('shows').select('title, date').eq('id', order.show_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return {
    show_id: order.show_id,
    showTitle: show?.title ?? 'Tickethalo',
    showDate: show?.date ?? null,
    email: order.buyer_email ?? 'Not available',
    ticketCodes: (tickets ?? []).map((ticket) => ticket.ticket_code),
    emailSent: Boolean(order.ticket_email_sent_at),
  }
}

/** Ingen betaling å bekrefte: enten finnes billettene, eller så gjør de ikke det. */
function freeOutcome(order: FreeOrder): Outcome {
  if (order.ticketCodes.length === 0) {
    return {
      tone: 'error',
      heading: 'No ticket was issued',
      message: `We could not reserve a ticket for this show. Try again from the show page, or contact us at ${SUPPORT_EMAIL}.`,
    }
  }
  return order.emailSent
    ? { tone: 'success', heading: "You're on the list", message: 'Your tickets are on their way by email. Show the QR code at the door.' }
    : {
        tone: 'warning',
        heading: "You're on the list",
        message: 'The tickets could not be emailed automatically. Keep the ticket code below — it gets you in.',
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
    .select('name, legal_name, org_number, support_email, stripe_account_id, country, ticket_vat_bps')
    .eq('id', clubId)
    .maybeSingle()

  return club ?? null
}
