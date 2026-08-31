import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PublicHeader } from '@/components/public/public-header'
import { Footer } from '@/components/Footer'
import { createAdminClient } from '@/lib/supabase/admin'
import { clubInvoiceRecipient, formatMinor } from '@/lib/fee-invoices'
import type { ArtistFeeInvoice, ArtistFeeInvoiceStatus } from '@/types/database'

export const metadata = { title: 'Your fee — Tickethalo' }

/**
 * Fakturagrunnlaget slik komikeren ser det.
 *
 * Eposten er én setning og en lenke hit. Alt som skal stå på fakturaen står
 * her, og bare det: beløpet, referansen, hvem som faktureres og hvor den
 * sendes. Kontonummeret er med fordi det er dit pengene går, og fordi en
 * feil der er lettest å oppdage når man ser det.
 *
 * Siden leses ferskt hver gang. Det er hele poenget med å flytte detaljene
 * ut av innboksen: bytter komikeren kontonummer, eller fyller klubben inn en
 * fakturaadresse i morgen, står det riktige her — mens eposten ville stått
 * med gårsdagens.
 *
 * Ingen innlogging. Tokenet i lenken er hemmeligheten, som for booking-
 * tilbudene; en komiker som nettopp har spilt skal ikke måtte lage en konto
 * for å finne ut hva hun skal fakturere.
 */

const STATUS: Record<ArtistFeeInvoiceStatus, string> = {
  issued: 'Waiting for your invoice',
  received: 'Invoice received',
  approved: 'Approved for payment',
  paid: 'Paid',
  rejected: 'On hold',
}

export default async function FeeInvoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = createAdminClient()

  const { data } = await db.from('artist_fee_invoices').select('*').eq('token', token).maybeSingle()
  const invoice = data as ArtistFeeInvoice | null
  if (!invoice) notFound()

  const [{ data: show }, { data: club }, { data: artist }] = await Promise.all([
    db.from('shows').select('title, date, venue_name').eq('id', invoice.show_id).maybeSingle(),
    invoice.club_id
      ? db.from('clubs').select('name, legal_name, org_number, invoice_email, support_email').eq('id', invoice.club_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from('artists').select('full_name, bank_account_number').eq('id', invoice.artist_id).maybeSingle(),
  ])

  const recipient = club ? clubInvoiceRecipient(club) : null
  const amount = formatMinor(invoice.amount, invoice.currency)
  const account = artist?.bank_account_number ?? null
  const isPaid = invoice.status === 'paid'

  return (
    <Shell>
      <p className="text-[13px] font-medium text-[var(--ev-accent)]">YOUR FEE</p>
      <h1 className="mt-2 text-balance text-[2rem] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[2.5rem]">
        {show?.title ?? 'Your fee'}
      </h1>

      <div className="mt-8 bg-[var(--ev-card)] p-6 sm:p-8" style={{ borderRadius: 'var(--ev-r-card)' }}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--ev-faint)]">Invoice us for</p>
            {/* Beløpet er spørsmålet siden finnes for å svare på. Det får stå alene. */}
            <p className="mt-1 text-[2.25rem] font-semibold leading-none tracking-[-0.02em] tabular-nums">
              {amount}
            </p>
          </div>
          <span
            className="inline-flex items-center whitespace-nowrap bg-[var(--ev-card-hover)] px-2.5 py-1 text-[12px] font-medium text-[var(--ev-muted)]"
            style={{ borderRadius: 'var(--ev-r-chip)' }}
          >
            {STATUS[invoice.status]}
          </span>
        </div>

        {/* Referansen er det som avgjør om fakturaen blir betalt. Den står
            for seg, i monospace, stor nok til å skrives av. */}
        <div
          className="mt-7 bg-[var(--ev-bg)] px-5 py-4"
          style={{ borderRadius: 'var(--ev-r-art)' }}
        >
          <p className="text-[13px] text-[var(--ev-faint)]">Put this reference on the invoice</p>
          <p className="mt-1 font-mono text-[1.35rem] font-semibold tracking-tight">{invoice.reference}</p>
        </div>

        <dl className="mt-7 flex flex-col divide-y divide-[var(--ev-line)] border-y border-[var(--ev-line)] text-[14px]">
          <Detail label="Invoice to">{recipient?.name ?? 'The club'}</Detail>
          {recipient?.orgNumber && <Detail label="Registration number">{recipient.orgNumber}</Detail>}
          <Detail label="Send it to">
            {recipient?.email
              ? (
                <a href={`mailto:${recipient.email}`} className="underline underline-offset-4">
                  {recipient.email}
                </a>
              )
              : 'Ask the club for an address'}
          </Detail>
          <Detail label="Show">
            {show?.date ? formatDate(show.date) : 'Coming'}
            {show?.venue_name ? ` · ${show.venue_name}` : ''}
          </Detail>
          {invoice.agreement && <Detail label="Agreement">{invoice.agreement}</Detail>}
          {/* Kontoen på fakturaen er den klubben betaler til. Denne står her
              fordi den er det klubben sammenligner med — ikke fordi den
              styrer utbetalingen. */}
          <Detail label="Account on file">{account ?? 'Not added yet'}</Detail>
        </dl>

        <p className="mt-6 text-[13px] leading-relaxed text-[var(--ev-muted)]">
          {isPaid
            ? 'This fee has been paid out. Nothing more to do.'
            : account
              ? 'Keep the amount exactly as above and the reference on the invoice — that is how the club knows the invoice is yours.'
              : 'Put your account number on the invoice — that is what the club pays to. Adding it to your profile as well lets the club check that the invoice really came from you.'}
        </p>

        <div className="mt-6">
          <Link
            href={account ? '/artist-app/economy' : '/artist-app/profile'}
            className="inline-flex h-11 w-fit items-center justify-center px-5 text-[13px] font-semibold text-[var(--ev-muted)] ring-1 ring-inset ring-[var(--ev-line-strong)] transition-colors hover:text-[var(--ev-text)] hover:ring-[var(--ev-text)]"
            style={{ borderRadius: 'var(--ev-r-chip)' }}
          >
            {account ? 'See all your fees' : 'Add it to your profile'}
          </Link>
        </div>
      </div>

      <p className="mt-6 text-[13px] text-[var(--ev-faint)]">
        Questions?{' '}
        <a href="mailto:hei@tickethalo.com" className="underline underline-offset-4">
          hei@tickethalo.com
        </a>
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      // Dokumentroten er lang="nb" for de norske portalene — se app/page.tsx.
      lang="en"
      className="ev-surface flex min-h-svh flex-col bg-[var(--ev-bg)] text-[var(--ev-text)]"
      data-tone="light"
    >
      <PublicHeader tone="light" />

      <section className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-28 md:px-8">
        {children}
      </section>

      <Footer />
    </main>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="shrink-0 text-[var(--ev-muted)]">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}
