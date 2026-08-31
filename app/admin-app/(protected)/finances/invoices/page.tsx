import Link from 'next/link'
import { ArrowLeft, Search } from 'lucide-react'
import { AdminHeader } from '@/components/admin/admin-header'
import { InfoHint } from '@/components/admin/info-hint'
import { artistName, formatDate, StatusButtons, Verdict } from '@/components/admin/fee-invoice-checks'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { formatMinor, listFeeInvoices, verifyFeeInvoice } from '@/lib/fee-invoices'
import type { ArtistFeeInvoiceStatus } from '@/types/database'

/**
 * Kontrollen av honorarfakturaene.
 *
 * Komikerne fakturerer klubben etter showet. En faktura kommer inn på epost,
 * og det eneste som skiller en ekte fra en oppdiktet er om systemet har bedt
 * om den. Her er det man spør: slå opp referansen fra fakturaen, skriv inn
 * beløpet og kontonummeret som står der, og se hva som ikke stemmer.
 *
 * Siden er bevisst et skjema og en liste, ikke et dashbord. Den brukes med en
 * faktura i hånda, ett spørsmål av gangen.
 */

const STATUS: Record<ArtistFeeInvoiceStatus, { label: string; pill: string }> = {
  issued:   { label: 'Asked to invoice', pill: 'bg-muted text-muted-foreground' },
  received: { label: 'Received',         pill: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  approved: { label: 'Approved',         pill: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  paid:     { label: 'Paid',             pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  rejected: { label: 'Rejected',         pill: 'bg-destructive/10 text-destructive' },
}

export default async function FeeInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; amount?: string; account?: string }>
}) {
  const clubId = await getDefaultClubIdForAdmin()
  const params = await searchParams
  const query = params.ref?.trim() ?? ''

  // Beløpet kommer inn som kroner, slik det står på fakturaen. Tomt felt er
  // «ikke kontrollert», ikke null kroner — derfor null og ikke 0.
  const amountInput = params.amount?.trim() ? Number(params.amount.replace(',', '.')) : null

  const [result, invoices] = await Promise.all([
    query
      ? verifyFeeInvoice({
        reference: query,
        clubId,
        invoicedAmountMajor: amountInput,
        invoicedAccountNumber: params.account ?? null,
      })
      : Promise.resolve(null),
    listFeeInvoices({ clubId, limit: 60 }),
  ])

  const open = invoices.filter((row) => row.status !== 'paid' && row.status !== 'rejected')
  const paid = invoices.filter((row) => row.status === 'paid')
  const outstanding = open.reduce((total, row) => total + row.amount, 0)
  const paidTotal = paid.reduce((total, row) => total + row.amount, 0)
  const currency = invoices[0]?.currency ?? 'NOK'

  return (
    <div>
      <AdminHeader
        title="Invoice control"
        description="Check a comedian's invoice against the fee we asked them to invoice."
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin-app/finances">
              <ArrowLeft data-icon="inline-start" />
              Finances
            </Link>
          </Button>
        }
      />

      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
        {/* ── Oppslaget ────────────────────────────────────── */}
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              Check an invoice
              <InfoHint label="How the check works">
                <p>
                  Every settled fee gets a reference, and the comedian is told to put it on the
                  invoice. Type it here together with the amount and account number as they appear
                  on the invoice.
                </p>
                <p>
                  A reference we did not issue, an amount that does not match to the øre, or a fee
                  already paid all come back as a mismatch.
                </p>
              </InfoHint>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {/* GET-skjema: kontrollen endrer ingenting, og et oppslag skal
                kunne deles som en lenke til den som skal betale. */}
            <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_11rem_auto]">
              <Input name="ref" defaultValue={query} placeholder="TH-2608-K7QP3M" aria-label="Reference" autoFocus />
              <Input
                name="amount"
                defaultValue={params.amount ?? ''}
                placeholder="Amount"
                aria-label="Amount on the invoice"
                inputMode="decimal"
              />
              <Input
                name="account"
                defaultValue={params.account ?? ''}
                placeholder="Account number"
                aria-label="Account number on the invoice"
                inputMode="numeric"
              />
              <Button type="submit">
                <Search data-icon="inline-start" />
                Check
              </Button>
            </form>

            {result && <Verdict result={result} />}
          </CardContent>
        </Card>

        {/* ── Alle grunnlag ────────────────────────────────── */}
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              Fees asked to be invoiced
              <InfoHint label="What this list is">
                <p>
                  Every fee the lineup has been told to invoice you for, newest first. Resend sends
                  the same fee page again — same reference, same amount.
                </p>
                <p>
                  Marking a fee paid closes its reference: a second invoice on it is flagged as a
                  duplicate.
                </p>
              </InfoHint>
            </CardTitle>
            {paid.length > 0 && (
              <CardDescription>
                {formatMinor(paidTotal, currency)} paid out across {paid.length}{' '}
                {paid.length === 1 ? 'fee' : 'fees'}.
              </CardDescription>
            )}
            {outstanding > 0 && (
              <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end text-right">
                <div className="text-2xl font-semibold leading-none">{formatMinor(outstanding, currency)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {open.length} unpaid
                </div>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {invoices.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Fees appear here once a booked show has been played and settled.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Reference</th>
                      <th className="py-1.5 pr-3 font-medium">Comedian</th>
                      <th className="py-1.5 pr-3 font-medium">Show</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Amount</th>
                      <th className="py-1.5 pr-3 font-medium">Status</th>
                      <th className="py-1.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          <Link
                            href={`/admin-app/finances/invoices?ref=${invoice.reference}`}
                            className="underline-offset-2 hover:underline"
                          >
                            {invoice.reference}
                          </Link>
                        </td>
                        {/* Kontonummeret og utsendelsesdatoen hadde hver sin
                            kolonne. De er sjelden det man leter etter, og står
                            nå som en underlinje der de hører hjemme. */}
                        <td className="py-1.5 pr-3">
                          <div className="font-medium">{artistName(invoice)}</div>
                          <div className="text-xs text-muted-foreground">
                            {invoice.bank_account_number ?? 'no account number'}
                          </div>
                        </td>
                        <td className="py-1.5 pr-3">
                          <div className="max-w-[14rem] truncate">{invoice.show?.title ?? '—'}</div>
                          <div className="text-xs text-muted-foreground">
                            {invoice.show?.date ? formatDate(invoice.show.date) : ''}
                          </div>
                        </td>
                        <td className="py-1.5 pr-3 text-right font-medium tabular-nums">
                          {formatMinor(invoice.amount, invoice.currency)}
                        </td>
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[invoice.status].pill}`}>
                            {STATUS[invoice.status].label}
                          </span>
                          <span className="block pt-0.5 text-xs text-muted-foreground">
                            {invoice.status === 'paid'
                              ? formatDate(invoice.paid_at)
                              : `Sent ${formatDate(invoice.last_sent_at ?? invoice.issued_at)}${invoice.send_count > 1 ? ` · ${invoice.send_count}×` : ''}`}
                          </span>
                        </td>
                        <td className="py-1.5 text-right">
                          <StatusButtons invoice={invoice} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

