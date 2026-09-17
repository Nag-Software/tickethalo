import { Ticket } from 'lucide-react'
import { DeleteShowDialog } from '@/components/admin/delete-show-dialog'
import { RefundShowDialog } from '@/components/admin/refund-show-dialog'
import { ResumeSalesDialog } from '@/components/admin/resume-sales-dialog'
import { StopSalesDialog } from '@/components/admin/stop-sales-dialog'
import { WARNING_BOX } from '@/components/admin/show-sales-styles'
import {
  describeTicketSalesState,
  formatMinorAmount,
  formatSalesDate,
  hasRefundableSales,
  isTicketSalesStopped,
  soldTicketCount,
  ticketSalesChip,
  type SalesStateTone,
  type ShowSalesOverviewDto,
  type TicketSalesStateDto,
} from '@/lib/show-sales-shared'
import { osloDate, ticketSalesOpenDate } from '@/lib/ticket-sales'
import { cn } from '@/lib/utils'

const TONE_CHIP: Record<SalesStateTone, string> = {
  open: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  scheduled: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
  stopped: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
  ended: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  unavailable: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
}

const TONE_DOT: Record<SalesStateTone, string> = {
  open: 'bg-emerald-500',
  scheduled: 'bg-sky-500',
  stopped: 'bg-red-500',
  ended: 'bg-zinc-400',
  unavailable: 'bg-zinc-400',
}

/** Salgsstatus som merkelapp, ved siden av showstatusen i sidehodet. */
export function TicketSalesChip({ sales, className }: { sales: TicketSalesStateDto; className?: string }) {
  const chip = ticketSalesChip(sales)
  return (
    <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', TONE_CHIP[chip.tone], className)}>
      {chip.label}
    </span>
  )
}

/**
 * Øverst i Tickets-fanen: hvordan salget står, hva som er solgt og refundert,
 * og knappene for å stenge, åpne, refundere og slette — i den rekkefølgen en
 * avlysning faktisk går.
 *
 * Tallene og tilstanden er regnet ut på serveren da siden ble tegnet.
 * Dialogene handler mot serveren, som sjekker alt på nytt.
 */
export function ShowSalesPanel({ overview }: { overview: ShowSalesOverviewDto }) {
  const { sales, summary, currency } = overview
  const state = describeTicketSalesState(sales, overview.status)
  const tone = ticketSalesChip(sales).tone

  const canStop = sales.kind === 'open' || sales.kind === 'not_yet_open'
  const canResume = sales.kind === 'closed'
  const stopped = isTicketSalesStopped(sales)
  const refundable = hasRefundableSales(summary)
  const disputes = summary.open_dispute_orders

  const refundDisabledReason = !stopped
    ? 'Stop ticket sales before refunding all tickets'
    : !refundable
      ? 'There is nothing to refund on this show'
      : null

  // Åpnes salget igjen for et show mer enn 90 dager fram, åpner det ikke i dag.
  const openDate = ticketSalesOpenDate(overview.date)
  const resumeOpensOn = canResume && openDate > osloDate() ? formatSalesDate(openDate) : null

  return (
    <section className="mb-6 overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-4">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Ticket className="size-3.5" aria-hidden />
            Ticket sales
          </p>
          <p className="flex items-center gap-2 text-sm font-bold">
            <span className={cn('size-2 shrink-0 rounded-full', TONE_DOT[tone])} aria-hidden />
            {state.title}
          </p>
          <p className="text-xs text-muted-foreground">{state.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canStop && <StopSalesDialog showId={overview.showId} showTitle={overview.title} />}
          {canResume && (
            <ResumeSalesDialog showId={overview.showId} showTitle={overview.title} opensOn={resumeOpensOn} />
          )}
          <RefundShowDialog
            showId={overview.showId}
            showTitle={overview.title}
            currency={currency}
            paidOrders={summary.paid_orders}
            paidAmount={summary.paid_amount}
            awaitingRefundOrders={summary.awaiting_refund_orders}
            awaitingRefundAmount={summary.awaiting_refund_amount}
            openDisputeOrders={summary.open_dispute_orders}
            disabledReason={refundDisabledReason}
          />
          <DeleteShowDialog showId={overview.showId} showTitle={overview.title} variant="danger" />
        </div>
      </div>

      {/* Disputter er sjeldne, så tallet vises bare når det finnes en. Da blir
          det seks felt, og rutenettet går over tre kolonner i stedet for fem. */}
      <dl
        className={cn(
          'grid grid-cols-2 gap-px border-t bg-border',
          disputes > 0 ? 'sm:grid-cols-3 lg:grid-cols-6' : 'sm:grid-cols-5',
        )}
      >
        <Stat label="Tickets sold" value={String(soldTicketCount(summary))} />
        <Stat label="Paid orders" value={String(summary.paid_orders)} />
        <Stat label="Revenue not refunded" value={formatMinorAmount(summary.paid_amount, currency)} />
        <Stat label="Refunded orders" value={String(summary.refunded_orders)} />
        <Stat
          label="Payments awaiting refund"
          value={String(summary.awaiting_refund_orders)}
          detail={
            summary.awaiting_refund_orders > 0 ? formatMinorAmount(summary.awaiting_refund_amount, currency) : undefined
          }
          highlight={summary.awaiting_refund_orders > 0}
          className={disputes > 0 ? undefined : 'col-span-2 sm:col-span-1'}
        />
        {disputes > 0 && <Stat label="Open disputes" value={String(disputes)} highlight />}
      </dl>

      {(refundable && !stopped) || summary.awaiting_refund_orders > 0 || disputes > 0 ? (
        <div className="space-y-2 border-t px-4 py-3">
          {refundable && !stopped && (
            <p className={WARNING_BOX}>
              Cancelling the show? Stop ticket sales first — refunding all tickets is only possible once sales are
              stopped.
            </p>
          )}
          {summary.awaiting_refund_orders > 0 && (
            <p className={WARNING_BOX}>
              {summary.awaiting_refund_orders === 1 ? '1 payment' : `${summary.awaiting_refund_orders} payments`} went
              through after the show sold out or was taken off sale, so no tickets were issued. They are refunded
              automatically, and Refund all tickets includes them.
            </p>
          )}
          {disputes > 0 && (
            <p className={WARNING_BOX}>
              {disputes === 1 ? '1 payment is' : `${disputes} payments are`} disputed by the buyer&apos;s bank in
              Stripe. {disputes === 1 ? 'It' : 'They'} can&apos;t be refunded while the{' '}
              {disputes === 1 ? 'dispute is' : 'disputes are'} open, and the show can&apos;t be deleted until{' '}
              {disputes === 1 ? 'it closes' : 'they close'}.
            </p>
          )}
        </div>
      ) : null}
    </section>
  )
}

function Stat({
  label,
  value,
  detail,
  highlight = false,
  className,
}: {
  label: string
  value: string
  detail?: string
  highlight?: boolean
  className?: string
}) {
  return (
    <div className={cn('bg-background px-4 py-3', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-sm font-bold tabular-nums',
          highlight && 'text-amber-700 dark:text-amber-400',
        )}
      >
        {value}
        {detail && <span className="ml-1.5 text-xs font-medium text-muted-foreground">{detail}</span>}
      </dd>
    </div>
  )
}
