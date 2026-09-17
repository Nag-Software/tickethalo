import {
  TICKET_SALES_TIME_ZONE,
  TICKET_SALES_WINDOW_DAYS,
  osloDate,
  startOfDayInZone,
  ticketSalesOpenDate,
  ticketSalesOpensAt,
  type TicketSalesState,
} from '@/lib/ticket-sales'
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
  // En refusjon som ikke er fullført hos Stripe kan fortsatt feile, og da
  // skal ordren ikke ligge under et arkivert show.
  if (hasOutstandingSales(summary) || summary.pending_refund_orders > 0) return 'blocked'
  if (summary.total_orders > 0 || summary.fee_invoices > 0) return 'archive'
  return 'delete'
}

/**
 * Showet har salg som ikke er gjort opp: betalte ordrer, billetter som gjelder
 * eller er skannet, betalinger som venter på refusjon, eller en åpen disputt.
 * Så lenge dette er sant ligger det penger for showet på klubbens saldo, og
 * showet kan verken slettes, flyttes fritt eller bytte valuta.
 */
export function hasOutstandingSales(summary: ShowSalesSummary): boolean {
  return (
    summary.paid_orders > 0 ||
    summary.valid_tickets > 0 ||
    summary.used_tickets > 0 ||
    summary.awaiting_refund_orders > 0 ||
    summary.open_dispute_orders > 0
  )
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

export type ShowDetailsChange = {
  show: { date: string; currency: string; status: string; deleted_at: string | null }
  /** Datoen fra skjemaet, `YYYY-MM-DD`. */
  date: string
  /** Klubbens valuta, allerede normalisert. `null` når klubben ikke har satt en. */
  clubCurrency: string | null
  /** `hasOutstandingSales` for showet. Trenger bare være lest når dato eller valuta endres. */
  hasSales: boolean
  /** `created_at` på den eldste betalingen som fortsatt ligger på klubbens saldo. */
  earliestSaleAt: string | null
}

export type ShowDetailsChangeResult =
  | { ok: true; currency: string; dateChanged: boolean }
  | { ok: false; error: string }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function isCalendarDate(date: string): boolean {
  const match = ISO_DATE.exec(date)
  if (!match) return false
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return utc.toISOString().slice(0, 10) === date
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * Om detaljene på et show kan lagres, og med hvilken valuta.
 *
 * Et show med salg som ikke er gjort opp har penger på klubbens saldo, og da
 * kan datoen og valutaen ikke lenger endres fritt:
 *
 *  - Datoen kan ikke flyttes så langt fram at det første salget havner før
 *    salgsvinduet på 90 dager for den nye datoen. Vinduet finnes fordi Stripe
 *    betaler ut penger på klubbens konto etter høyst 90 dager — flyttes et
 *    show med salg et halvt år fram, er pengene utbetalt lenge før showet, og
 *    en avlysning møter en tom saldo. Tickethalo dekker da tapet.
 *  - Datoen kan ikke flyttes til en dag som er passert: et avholdt show
 *    frigir klubbens penger til utbetaling, før noen har spilt.
 *  - Et avlyst show med salg skal refunderes, ikke flyttes.
 *  - Valutaen står. Billettene er solgt i den, og refusjoner, beløp og
 *    honorarer regnes i den.
 *
 * Valutaen avvises ikke, den bare står: den velges ikke i skjemaet, men
 * følger klubben. En avvisning ville stoppet hver eneste lagring av showet
 * etter at klubben byttet valuta, uten at bookeren hadde rørt feltet.
 *
 * Et arkivert show endrer aldri dato, med eller uten salg.
 */
export function checkShowDetailsChange(change: ShowDetailsChange, now: Date = new Date()): ShowDetailsChangeResult {
  const { show, date } = change
  const currency = change.hasSales ? show.currency : (change.clubCurrency ?? show.currency)

  if (date === show.date.slice(0, 10)) return { ok: true, currency, dateChanged: false }

  if (!isCalendarDate(date)) return { ok: false, error: 'Pick a valid date for the show.' }
  if (show.deleted_at) return { ok: false, error: "This show has been deleted, so its date can't be changed." }
  if (!change.hasSales) return { ok: true, currency, dateChanged: true }

  if (show.status === 'cancelled') {
    return {
      ok: false,
      error:
        "This show is cancelled and still has ticket sales that aren't refunded, so its date can't be changed. " +
        'Refund all tickets first.',
    }
  }

  if (date < osloDate(now)) {
    return {
      ok: false,
      error:
        `Tickets have been sold for this show, so it can't be moved to ${formatSalesDate(date)}, ` +
        'a date that has already passed.',
    }
  }

  const firstSale = change.earliestSaleAt ? new Date(change.earliestSaleAt) : null
  if (firstSale && !Number.isNaN(firstSale.getTime()) && firstSale < ticketSalesOpensAt(date)) {
    const firstSaleDate = osloDate(firstSale)
    const latestDate = addDays(firstSaleDate, TICKET_SALES_WINDOW_DAYS - 1)

    return {
      ok: false,
      error:
        `Tickets for this show were first sold on ${formatSalesDate(firstSaleDate)}. ` +
        `For a show on ${formatSalesDate(date)}, ticket sales can't open before ${formatSalesDate(ticketSalesOpenDate(date))}, ` +
        `${TICKET_SALES_WINDOW_DAYS} days before the show. Pick a date on or before ${formatSalesDate(latestDate)}, ` +
        'or refund all tickets first.',
    }
  }

  return { ok: true, currency, dateChanged: true }
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

  // En betaling i disputt kan ikke refunderes — Stripe avviser det til
  // disputten er lukket. Den står for seg, så bookeren ikke prøver igjen.
  if (summary.open_dispute_orders > 0) {
    blockers.push(disputeBlocker(summary.open_dispute_orders))
  }

  if (summary.pending_refund_orders > 0) {
    blockers.push(pendingRefundBlocker(summary.pending_refund_orders))
  }

  return blockers
}

function disputeBlocker(disputes: number) {
  return (
    `${count(disputes, 'payment')} ${isAre(disputes)} disputed in Stripe — ` +
    `wait for the ${disputes === 1 ? 'dispute' : 'disputes'} to close`
  )
}

/**
 * Meldingen når `delete_show()` sier `blocked`. Tallene kommer fra
 * databasens egen sjekk under lås, ikke fra det bookeren så i dialogen.
 */
export function deleteShowBlockedMessage(
  counts: Pick<ShowSalesSummary, 'paid_orders' | 'valid_tickets' | 'used_tickets' | 'awaiting_refund_orders'> &
    Partial<Pick<ShowSalesSummary, 'open_dispute_orders' | 'pending_refund_orders'>>,
): string {
  const steps = 'Stop ticket sales and refund all tickets before deleting.'
  const tickets = soldTicketCount(counts)
  const disputes = counts.open_dispute_orders ?? 0
  // `delete_show()` returnerer ikke disputter. Handlingen legger dem til fra
  // `show_sales_summary`, og uten dem sier meldingen bare det den vet.
  const pending = counts.pending_refund_orders ?? 0
  const disputeNote =
    (disputes > 0 ? ` ${capitalize(disputeBlocker(disputes))}.` : '') +
    (pending > 0 ? ` ${capitalize(pendingRefundBlocker(pending))}.` : '')

  if (tickets > 0) {
    return `This show has ${count(tickets, 'sold ticket')} that ${isAre(tickets)} not refunded. ${steps}${disputeNote}`
  }

  if (counts.paid_orders > 0) {
    return `This show has ${count(counts.paid_orders, 'paid order')} that ${isAre(counts.paid_orders)} not refunded. ${steps}${disputeNote}`
  }

  if (counts.awaiting_refund_orders > 0) {
    return (
      `This show has ${count(counts.awaiting_refund_orders, 'payment')} waiting to be refunded. ` +
      `Refund all tickets before deleting.${disputeNote}`
    )
  }

  if (disputes > 0 || pending > 0) {
    return `This show can't be deleted yet.${disputeNote}`
  }

  return `This show has payments that are not refunded. ${steps}`
}

function pendingRefundBlocker(refunds: number) {
  return (
    `${count(refunds, 'refund')} ${isAre(refunds)} still being processed by Stripe — ` +
    'wait until the buyers have received the money'
  )
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
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
    open_dispute_orders: toNumber(row.open_dispute_orders),
    pending_refund_orders: toNumber(row.pending_refund_orders),
  }
}
