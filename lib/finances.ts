import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Tallene bak økonomisiden.
 *
 * Alt regnes fra hovedboken på ordrene, ikke fra Stripe-saldoen: saldoen
 * blander show som er spilt med show som ennå ikke er avholdt, og sier
 * ingenting om hva provisjonen var. Se migrasjon 032.
 */

export type EarningsMonth = {
  /** ISO `YYYY-MM`, brukt som nøkkel. */
  key: string
  /** Kort etikett under stolpen, f.eks. «Mar». */
  label: string
  /** Klubbens andel etter provisjon, i minste valutaenhet. */
  net: number
  tickets: number
}

export type FinanceSummary = {
  months: EarningsMonth[]
  /** Klubbens andel i perioden grafen viser. */
  periodNet: number
  /** Solgte billetter i samme periode. */
  periodTickets: number
  /** Klubbens andel siden start. */
  lifetimeNet: number
}

const MONTHS_SHOWN = 6

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

/** De siste `MONTHS_SHOWN` månedene, eldst først, også de uten salg. */
function emptyMonths(today = new Date()): EarningsMonth[] {
  const months: EarningsMonth[] = []

  for (let offset = MONTHS_SHOWN - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1))
    months.push({
      key: monthKey(date),
      label: date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }),
      net: 0,
      tickets: 0,
    })
  }

  return months
}

export async function getFinanceSummary(clubId: string): Promise<FinanceSummary> {
  const db = createAdminClient()
  const months = emptyMonths()
  const from = `${months[0].key}-01T00:00:00.000Z`

  const [{ data: recent }, { data: lifetime }] = await Promise.all([
    db
      .from('orders')
      .select('club_net_amount, created_at')
      .eq('club_id', clubId)
      .eq('status', 'paid')
      .gte('created_at', from),
    db
      .from('orders')
      .select('club_net_amount')
      .eq('club_id', clubId)
      .eq('status', 'paid'),
  ])

  const byMonth = new Map(months.map((month) => [month.key, month]))

  for (const order of recent ?? []) {
    const bucket = byMonth.get(monthKey(new Date(order.created_at)))
    if (!bucket) continue

    bucket.net += order.club_net_amount ?? 0
    bucket.tickets += 1
  }

  return {
    months,
    periodNet: months.reduce((total, month) => total + month.net, 0),
    periodTickets: months.reduce((total, month) => total + month.tickets, 0),
    lifetimeNet: (lifetime ?? []).reduce((total, order) => total + (order.club_net_amount ?? 0), 0),
  }
}
