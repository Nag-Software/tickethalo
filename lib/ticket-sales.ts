/**
 * Når et show kan selge billetter.
 *
 * Salgsvinduet er 90 dager, regnet i påbegynte døgn norsk tid: showdagen er
 * dag 1, og salget åpner kl. 00:00 på dag 90. For et show 15. desember åpner
 * salget altså 17. september kl. 00:00, uansett klokkeslett showet starter.
 *
 * Grensen finnes fordi klubbenes Stripe-kontoer står på manuell utbetaling,
 * og Stripe holder penger på en norsk konto i høyst 90 dager. Selges en
 * billett tidligere enn det, kan Stripe betale ut før showet er avholdt — og
 * da står en avlysning igjen med en tom konto og refusjonskrav.
 *
 * Reglene her er de eneste: checkout, arrangementssiden og admin leser alle
 * `ticketSalesState`.
 */

export const TICKET_SALES_WINDOW_DAYS = 90
export const TICKET_SALES_TIME_ZONE = 'Europe/Oslo'

const DAY_MS = 24 * 60 * 60 * 1000

export type TicketSalesShow = {
  status: string
  /** `YYYY-MM-DD`, showets dato i norsk tid. */
  date: string
  ticket_sales_closed_at: string | null
  deleted_at?: string | null
}

export type TicketSalesState =
  /** Kjøp kan startes nå. */
  | { kind: 'open' }
  /** Publisert, men salgsvinduet har ikke åpnet. */
  | { kind: 'not_yet_open'; opensAt: Date; openDate: string }
  /** Bookeren har stengt salget. */
  | { kind: 'closed'; closedAt: string }
  /** Showdatoen er passert. */
  | { kind: 'ended' }
  /** Ikke publisert, kansellert eller slettet. */
  | { kind: 'unavailable' }

function parseDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.slice(0, 10))
  if (!match) throw new Error(`Invalid show date: ${date}`)
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

/** Forskjellen mellom lokal tid i `timeZone` og UTC på et gitt tidspunkt. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)

  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  const localAsUtc = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'))

  return localAsUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** Midnatt i `timeZone` på en kalenderdato, som et UTC-tidspunkt. */
export function startOfDayInZone(date: string, timeZone = TICKET_SALES_TIME_ZONE): Date {
  const { year, month, day } = parseDate(date)
  const wallClock = Date.UTC(year, month - 1, day)

  // To runder holder: midnatt faller aldri i et sommertidshull i Norge.
  let guess = wallClock
  for (let round = 0; round < 3; round += 1) {
    const next = wallClock - zoneOffsetMs(new Date(guess), timeZone)
    if (next === guess) break
    guess = next
  }

  return new Date(guess)
}

/** Dagens dato i norsk tid, `YYYY-MM-DD`. */
export function osloDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TICKET_SALES_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Første dag billetter kan selges, `YYYY-MM-DD`. Showdagen er dag 1. */
export function ticketSalesOpenDate(showDate: string): string {
  const { year, month, day } = parseDate(showDate)
  return formatDate(Date.UTC(year, month - 1, day) - (TICKET_SALES_WINDOW_DAYS - 1) * DAY_MS)
}

/** Tidspunktet salget åpner: kl. 00:00 norsk tid på åpningsdagen. */
export function ticketSalesOpensAt(showDate: string): Date {
  return startOfDayInZone(ticketSalesOpenDate(showDate))
}

export function ticketSalesState(show: TicketSalesShow, now: Date = new Date()): TicketSalesState {
  if (show.deleted_at || show.status !== 'published') return { kind: 'unavailable' }
  if (show.date.slice(0, 10) < osloDate(now)) return { kind: 'ended' }
  if (show.ticket_sales_closed_at) return { kind: 'closed', closedAt: show.ticket_sales_closed_at }

  const opensAt = ticketSalesOpensAt(show.date)
  if (now.getTime() < opensAt.getTime()) {
    return { kind: 'not_yet_open', opensAt, openDate: ticketSalesOpenDate(show.date) }
  }

  return { kind: 'open' }
}

export function isTicketSalesOpen(show: TicketSalesShow, now: Date = new Date()): boolean {
  return ticketSalesState(show, now).kind === 'open'
}
