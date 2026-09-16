import { TICKET_SALES_TIME_ZONE, startOfDayInZone, type TicketSalesState } from '@/lib/ticket-sales'
import type { Database } from '@/types/database'

/**
 * Den rene halvdelen av `lib/show-sales.ts`.
 *
 * Ligger for seg fordi dialogene i admin er klientkomponenter: importerte de
 * fra `lib/show-sales.ts`, ville Stripe-klienten og service role-klienten
 * fulgt med i nettleserpakken. Her er det bare typer, regler og ord — ingen
 * database, ingen Stripe. `lib/show-sales.ts` eksporterer alt herfra videre,
 * så serverkoden har ett sted å importere fra.
 */

export type ShowSalesSummary = Database['public']['Functions']['show_sales_summary']['Returns'][number]

export type ShowDeletionOutcome = 'blocked' | 'archive' | 'delete'

export type ShowSalesOverview = {
  showId: string
  title: string
  status: string
  date: string
  currency: string
  sales: TicketSalesState
  summary: ShowSalesSummary
  deletion: ShowDeletionOutcome
}

/** `TicketSalesState` med datoer som ISO-strenger, så den kan sendes til klienten. */
export type TicketSalesStateDto =
  | { kind: 'open' }
  | { kind: 'not_yet_open'; opensAt: string; openDate: string }
  | { kind: 'closed'; closedAt: string }
  | { kind: 'ended' }
  | { kind: 'unavailable' }

export type ShowSalesOverviewDto = Omit<ShowSalesOverview, 'sales'> & {
  sales: TicketSalesStateDto
  /** Det som hindrer sletting, som punkter bookeren kan lese. Tom når ingenting gjør det. */
  blockers: string[]
}

type SalesKind = { kind: TicketSalesState['kind'] }

// ─────────────────────────────────────────────────────────────
// Regler
// ─────────────────────────────────────────────────────────────

/**
 * Samme vurdering som `delete_show()` gjør under lås.
 *
 * Brukes bare til å vise bookeren hva som kommer til å skje før knappen
 * trykkes. Selve slettingen spør databasen på nytt, så et kjøp som kommer
 * mellom visningen og klikket stopper den likevel.
 */
export function deletionOutcome(summary: ShowSalesSummary): ShowDeletionOutcome {
  if (
    summary.paid_orders > 0 ||
    summary.valid_tickets > 0 ||
    summary.used_tickets > 0 ||
    summary.awaiting_refund_orders > 0
  ) {
    return 'blocked'
  }

  if (summary.total_orders > 0 || summary.fee_invoices > 0) return 'archive'
  return 'delete'
}

/** Salget er stengt av bookeren, showet er over, eller showet selger ikke. */
export function isTicketSalesStopped(sales: SalesKind): boolean {
  return sales.kind === 'closed' || sales.kind === 'ended' || sales.kind === 'unavailable'
}

/** Det finnes betalinger på showet som ikke er refundert. */
export function hasRefundableSales(summary: ShowSalesSummary): boolean {
  return summary.paid_orders > 0 || summary.awaiting_refund_orders > 0
}

/**
 * «Refund all» krever at salget er stengt først. Ellers kan en ny billett
 * selges mens refusjonen går, og showet står igjen med et salg bookeren
 * trodde var refundert.
 */
export function canRefundAllTickets(sales: SalesKind, summary: ShowSalesSummary): boolean {
  return isTicketSalesStopped(sales) && hasRefundableSales(summary)
}

/** Solgte billetter som ikke er refundert: gyldige og allerede skannede. */
export function soldTicketCount(summary: Pick<ShowSalesSummary, 'valid_tickets' | 'used_tickets'>): number {
  return summary.valid_tickets + summary.used_tickets
}

// ─────────────────────────────────────────────────────────────
// Ord
// ─────────────────────────────────────────────────────────────

/** Beløp i minste enhet (øre) som valuta. Ører vises bare når de finnes. */
export function formatMinorAmount(amount: number, currency: string): string {
  const value = Number.isFinite(amount) ? amount : 0
  const digits = value % 100 === 0 ? 0 : 2

  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value / 100)
  } catch {
    // En ukjent valutakode kaster RangeError. Beløpet er viktigere enn formen.
    return `${(value / 100).toFixed(digits)} ${currency}`
  }
}

function count(n: number, singular: string, pluralForm = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralForm}`
}

function isAre(n: number) {
  return n === 1 ? 'is' : 'are'
}

function hasHave(n: number) {
  return n === 1 ? 'has' : 'have'
}

/**
 * Punktene i «This show can't be deleted yet». Én linje per ting som må
 * refunderes, med antall og beløp — bookeren skal se hva det gjelder, ikke
 * bare at noe er i veien.
 */
export function describeDeletionBlockers(summary: ShowSalesSummary, currency: string): string[] {
  const blockers: string[] = []

  if (summary.valid_tickets > 0) {
    blockers.push(`${count(summary.valid_tickets, 'sold ticket')} ${isAre(summary.valid_tickets)} still valid`)
  }

  if (summary.used_tickets > 0) {
    blockers.push(`${count(summary.used_tickets, 'ticket')} ${hasHave(summary.used_tickets)} been scanned at the door`)
  }

  if (summary.paid_orders > 0) {
    blockers.push(
      `${count(summary.paid_orders, 'paid order')} (${formatMinorAmount(summary.paid_amount, currency)}) ` +
        `${hasHave(summary.paid_orders)} not been refunded`,
    )
  }

  if (summary.awaiting_refund_orders > 0) {
    blockers.push(
      `${count(summary.awaiting_refund_orders, 'payment')} ` +
        `(${formatMinorAmount(summary.awaiting_refund_amount, currency)}) that did not issue tickets ` +
        `${isAre(summary.awaiting_refund_orders)} waiting to be refunded`,
    )
  }

  return blockers
}

/**
 * Meldingen når `delete_show()` sier `blocked`. Tallene kommer fra
 * databasens egen sjekk under lås, ikke fra det bookeren så i dialogen.
 */
export function deleteShowBlockedMessage(
  counts: Pick<ShowSalesSummary, 'paid_orders' | 'valid_tickets' | 'used_tickets' | 'awaiting_refund_orders'>,
): string {
  const steps = 'Stop ticket sales and refund all tickets before deleting.'
  const tickets = soldTicketCount(counts)

  if (tickets > 0) {
    return `This show has ${count(tickets, 'sold ticket')} that ${isAre(tickets)} not refunded. ${steps}`
  }

  if (counts.paid_orders > 0) {
    return `This show has ${count(counts.paid_orders, 'paid order')} that ${isAre(counts.paid_orders)} not refunded. ${steps}`
  }

  if (counts.awaiting_refund_orders > 0) {
    return (
      `This show has ${count(counts.awaiting_refund_orders, 'payment')} waiting to be refunded. ` +
      'Refund all tickets before deleting.'
    )
  }

  return `This show has payments that are not refunded. ${steps}`
}

// Måneden skrives ut: kortformen på britisk er «Sep» eller «Sept» avhengig av
// ICU-versjonen, og da kunne server og nettleser skrevet hver sin.
const OSLO_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: TICKET_SALES_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

// Klokkeslettet formateres for seg: skilletegnet mellom dato og tid («, »
// eller « at ») varierer også mellom ICU-versjoner.
const OSLO_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: TICKET_SALES_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** `2026-09-17` → «17 September 2026», som norsk kalenderdato. */
export function formatSalesDate(date: string): string {
  return OSLO_DATE.format(startOfDayInZone(date))
}

/** Et tidspunkt i norsk tid, f.eks. når bookeren stengte salget: «16 September 2026 at 14:30». */
export function formatSalesDateTime(iso: string): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return iso
  return `${OSLO_DATE.format(instant)} at ${OSLO_TIME.format(instant)}`
}

export type SalesStateTone = 'open' | 'scheduled' | 'stopped' | 'ended' | 'unavailable'

/** Den korte merkelappen ved siden av showstatusen. */
export function ticketSalesChip(sales: TicketSalesStateDto): { label: string; tone: SalesStateTone } {
  switch (sales.kind) {
    case 'open':
      return { label: 'Tickets on sale', tone: 'open' }
    case 'not_yet_open':
      return { label: `Sales open ${formatSalesDate(sales.openDate)}`, tone: 'scheduled' }
    case 'closed':
      return { label: 'Sales stopped', tone: 'stopped' }
    case 'ended':
      return { label: 'Sales ended', tone: 'ended' }
    case 'unavailable':
      return { label: 'Not on sale', tone: 'unavailable' }
  }
}

/**
 * Overskrift og forklaring i salgspanelet. `showStatus` skiller et avlyst
 * show fra et som bare ikke er publisert ennå — begge er `unavailable`, men
 * bookeren skal gjøre helt forskjellige ting.
 */
export function describeTicketSalesState(
  sales: TicketSalesStateDto,
  showStatus: string,
): { title: string; description: string } {
  switch (sales.kind) {
    case 'open':
      return {
        title: 'Ticket sales are open',
        description: 'Buyers can buy tickets on the event page.',
      }
    case 'not_yet_open':
      return {
        title: `Ticket sales open ${formatSalesDate(sales.openDate)}`,
        description: 'Tickets go on sale 90 days before the show at the earliest, at 00:00 Norwegian time.',
      }
    case 'closed':
      return {
        title: `Ticket sales stopped on ${formatSalesDateTime(sales.closedAt)}`,
        description: 'Nobody can start a new purchase. Tickets already sold stay valid until they are refunded.',
      }
    case 'ended':
      return {
        title: 'Ticket sales have ended',
        description: 'The show date has passed.',
      }
    case 'unavailable':
      return {
        title: 'Not on sale',
        description:
          showStatus === 'cancelled'
            ? "Tickets aren't on sale because the show is cancelled."
            : showStatus === 'completed'
              ? "Tickets aren't on sale because the show is completed."
              : "Tickets aren't on sale because the show isn't published.",
      }
  }
}

/**
 * Én linje under «tickets sold» på bookingkortet, når salget ikke går som
 * vanlig. Åpent salg og avsluttede show trenger ingen forklaring.
 */
export function ticketSalesNote(sales: TicketSalesStateDto): string | null {
  if (sales.kind === 'not_yet_open') return `Ticket sales open ${formatSalesDate(sales.openDate)}`
  if (sales.kind === 'closed') return `Ticket sales stopped on ${formatSalesDateTime(sales.closedAt)}`
  return null
}

export function toTicketSalesStateDto(sales: TicketSalesState): TicketSalesStateDto {
  if (sales.kind === 'not_yet_open') {
    return { kind: 'not_yet_open', opensAt: sales.opensAt.toISOString(), openDate: sales.openDate }
  }
  return sales
}

export function toShowSalesOverviewDto(overview: ShowSalesOverview): ShowSalesOverviewDto {
  return {
    ...overview,
    sales: toTicketSalesStateDto(overview.sales),
    blockers: describeDeletionBlockers(overview.summary, overview.currency),
  }
}

/**
 * PostgREST sender `bigint` som tall, men `null` kan i prinsippet komme fra
 * en tom aggregering. Alt normaliseres til endelige tall, så sammenlikningene
 * over aldri møter `null > 0`.
 */
export function normalizeShowSalesSummary(row: Partial<Record<keyof ShowSalesSummary, unknown>>): ShowSalesSummary {
  const toNumber = (value: unknown) => {
    const number = Number(value ?? 0)
    return Number.isFinite(number) ? number : 0
  }

  return {
    paid_orders: toNumber(row.paid_orders),
    paid_amount: toNumber(row.paid_amount),
    valid_tickets: toNumber(row.valid_tickets),
    used_tickets: toNumber(row.used_tickets),
    refunded_orders: toNumber(row.refunded_orders),
    awaiting_refund_orders: toNumber(row.awaiting_refund_orders),
    awaiting_refund_amount: toNumber(row.awaiting_refund_amount),
    total_orders: toNumber(row.total_orders),
    fee_invoices: toNumber(row.fee_invoices),
  }
}
