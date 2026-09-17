import type { Show } from '@/types/database'

/**
 * Formatering for de offentlige showkortene og showsiden.
 *
 * Egen modul, uten serveravhengigheter, fordi `components/public/event-card.tsx`
 * rendres i en klientkomponent. Lå funksjonene i `lib/public-events.ts`, ville
 * kortet trukket med seg alt den modulen importerer — også Stripe-SDK-en som
 * salgsstatusen trenger — inn i nettleseren. `lib/public-events.ts` eksporterer
 * dem videre, så serversidene kan fortsette å hente dem derfra.
 */

export function formatShowDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(new Date(value))
}

export function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(value))
}

export function formatShowTime(show: Pick<Show, 'start_time' | 'end_time'>) {
  const start = show.start_time?.slice(0, 5)
  const end = show.end_time?.slice(0, 5)
  if (start && end) return `${start}-${end}`
  return start ?? 'Time TBA'
}

export function formatTicketPrice(show: Pick<Show, 'ticket_price' | 'currency'>) {
  if (!show.ticket_price) return 'Free'
  // en-GB over en-US: the venues bill in NOK, and en-GB renders that as
  // "NOK 270" rather than the US "NOK 270.00" with a dollar-shaped layout.
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: show.currency, maximumFractionDigits: 0 }).format(show.ticket_price / 100)
}

export function remainingTickets(show: Pick<Show, 'capacity'> & { soldTickets: number }) {
  return show.capacity === null ? null : Math.max(show.capacity - show.soldTickets, 0)
}

export function ticketFillPercent(show: Pick<Show, 'capacity'> & { soldTickets: number }) {
  if (!show.capacity) return 0
  return Math.min(Math.round((show.soldTickets / show.capacity) * 100), 100)
}
