/**
 * Salgsstatusen slik kjøperen ser den.
 *
 * `ticketSalesState` i `lib/ticket-sales.ts` avgjør om en billett kan kjøpes —
 * her står bare ordene. Modulen er ren og uten serveravhengigheter, fordi
 * kortene i lista rendres i en klientkomponent.
 *
 * Statusen regnes ut på serveren og sendes ned som `PublicTicketSalesState`:
 * bare strenger, ingen `Date`. Regnet klienten ut selv, ville en fane som sto
 * åpen over midnatt vist noe annet enn serveren — og hydreringen sprukket.
 */

import { TICKET_SALES_TIME_ZONE, startOfDayInZone, type TicketSalesState } from '@/lib/ticket-sales'

export type PublicTicketSalesState =
  | { kind: 'open' }
  /** `openDate` er `YYYY-MM-DD`, norsk dato salget åpner kl. 00:00. */
  | { kind: 'not_yet_open'; openDate: string }
  | { kind: 'closed' }
  | { kind: 'ended' }
  | { kind: 'unavailable' }

/**
 * Tar bort det kjøperen ikke trenger. `opensAt` er en `Date` og kan ikke
 * sendes som prop, og når bookeren stengte salget er ikke kjøperens sak.
 *
 * `sellable` er om checkout faktisk kan ta imot kjøpet — pris og klubbens
 * Stripe-oppsett (`isPubliclySellable` i `lib/public-events.ts`). Er vinduet
 * åpent men kjøpet ville blitt avvist, får kjøperen «Not on sale» i stedet for
 * en kjøpsknapp. Kjøperen skal ikke få høre hvorfor: det er klubbens oppsett,
 * ikke noe hun kan gjøre noe med. Før salget åpner står datoen likevel —
 * klubben har tid til å rette oppsettet, og datoen er det kjøperen trenger.
 */
export function toPublicTicketSalesState(state: TicketSalesState, sellable: boolean): PublicTicketSalesState {
  switch (state.kind) {
    case 'open':
      return sellable ? { kind: 'open' } : { kind: 'unavailable' }
    case 'not_yet_open':
      return { kind: 'not_yet_open', openDate: state.openDate }
    case 'closed':
      return { kind: 'closed' }
    default:
      return { kind: state.kind }
  }
}

const LONG_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: TICKET_SALES_TIME_ZONE,
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

// en-US og ikke en-GB: nyere ICU skriver «Sept» på britisk, og hvilken
// variant man får avhenger av Node- og nettleserversjon. Dag og måned settes
// sammen for hånd, så server og klient alltid skriver det samme.
const SHORT_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: TICKET_SALES_TIME_ZONE,
  day: 'numeric',
  month: 'short',
})

/** `2026-09-17` → «17 September 2026». */
export function formatSalesOpenDate(openDate: string): string {
  return LONG_DATE.format(startOfDayInZone(openDate))
}

/** `2026-09-17` → «17 Sep». */
export function formatSalesOpenDateShort(openDate: string): string {
  const parts = SHORT_DATE.formatToParts(startOfDayInZone(openDate))
  const day = parts.find((part) => part.type === 'day')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  return `${day} ${month}`
}

/** Teksten på en deaktivert kjøpsknapp. Null = salget er åpent. */
export function ticketSalesButtonLabel(state: PublicTicketSalesState): string | null {
  switch (state.kind) {
    case 'open':
      return null
    case 'not_yet_open':
      return `On sale ${formatSalesOpenDateShort(state.openDate)}`
    case 'closed':
      return 'Sales closed'
    case 'ended':
      return 'Show has ended'
    case 'unavailable':
      return 'Not on sale'
  }
}

/**
 * Linjen under knappen der siden har plass. Knappen sier bare dagen; her
 * står året og klokkeslettet, så det er tydelig at salget åpner ved midnatt
 * og ikke en gang i løpet av dagen.
 */
export function ticketSalesNote(state: PublicTicketSalesState): string | null {
  if (state.kind !== 'not_yet_open') return null
  return `Tickets go on sale ${formatSalesOpenDate(state.openDate)} at 00:00.`
}
