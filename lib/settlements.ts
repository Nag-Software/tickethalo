import { createAdminClient } from '@/lib/supabase/admin'
import { startOfDayInZone } from '@/lib/ticket-sales'

/**
 * Avregningsnota per klubb.
 *
 * Klubben er selger; Tickethalos eneste inntekt er formidlingsprovisjonen.
 * Notaen er dokumentet som viser nettopp det: brutto billettsalg, minus
 * provisjon, minus det som er refundert, lik det klubben får utbetalt.
 * Klubbens regnskapsfører trenger den, og den er Tickethalos eget bilag for
 * provisjonsinntekten.
 *
 * Refusjoner regnes på det tidspunktet de skjer, ikke på salgsmåneden. En
 * refusjon i august av en billett solgt i juli trekkes fra augustnotaen —
 * julinotaen er allerede utstedt og skal ikke skrives om.
 *
 * Kjent hull: en delrefusjon gjort i Stripe-dashbordet lar ordren stå som
 * `paid` uten `refunded_at`, og ordren har ikke noe tidspunkt for når
 * delrefusjonen skjedde. Den kan derfor ikke plasseres i riktig periode og
 * trekkes ikke fra her — utbetalingen (`club_releasable_amount`) trekker den
 * fra med en gang. Blir ordren senere fullt refundert, trekkes hele det
 * refunderte beløpet fra i den perioden, og summen over tid stemmer igjen.
 * Å lukke hullet krever et tidsstempel per refusjon (egen migrasjon).
 */

type RefundedOrder = {
  club_net_amount: number | null
  refunded_amount: number | null
  application_fee_refunded_amount: number | null
  /** Klubbens netto tap på en disputt (trukket + gebyr − tilbakeført). */
  dispute_net_amount?: number | null
}

/**
 * Hva en refusjon tok fra klubben: det som gikk tilbake til kunden, minus
 * provisjonen Tickethalo førte tilbake. Samme formel som utbetalingen bruker,
 * slik at en refusjon i dashbordet uten tilbakeført provisjon også stemmer.
 *
 * En tapt disputt lukkes som refundert uten `refunded_amount`: pengene gikk
 * tilbake gjennom disputten og står i `dispute_net_amount`, sammen med
 * gebyret. Det er tapet klubben faktisk hadde, og det utbetalingen trekker.
 * Eldre ordrer uten noen av beløpene faller tilbake på klubbens andel.
 */
export function refundedClubAmount(order: RefundedOrder): number {
  const refunded = order.refunded_amount ?? 0
  if (refunded > 0) return refunded - (order.application_fee_refunded_amount ?? 0)
  if ((order.dispute_net_amount ?? 0) > 0) return order.dispute_net_amount as number
  return order.club_net_amount ?? 0
}

type SettlementRow = {
  club_id: string
  period_start: string
  period_end: string
  gross_amount: number
  commission_amount: number
  commission_vat_amount: number
  refunded_amount: number
  net_amount: number
  currency: string
  document_number: string
  issued_at: string
}

export type SettlementPeriod = { start: string; end: string }

/** Én kalendermåned, `YYYY-MM-DD` fra første til siste dag. */
export function monthPeriod(year: number, month: number): SettlementPeriod {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

/** `YYYY-MM` → perioden, eller null når teksten ikke er en måned. */
export function parseMonthPeriod(value: string | null | undefined): SettlementPeriod | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value?.trim() ?? '')
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return monthPeriod(year, month)
}

/** Forrige hele måned, som er perioden en månedlig avregning gjelder. */
export function previousMonthPeriod(today = new Date()) {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))
  return monthPeriod(end.getUTCFullYear(), end.getUTCMonth() + 1)
}

/**
 * Periodens ytterpunkter som tidspunkter, i norsk tid.
 *
 * Grensene gikk før ved UTC-midnatt, så et salg klokka 00:30 den 1. havnet
 * i forrige måneds nota — mens utbetalingen (`club_releasable_amount`) og
 * plattformens hovedbok regner norsk dato. Alle tre skal legge samme salg i
 * samme måned.
 */
export function periodBounds(period: SettlementPeriod): { from: string; to: string } {
  const from = startOfDayInZone(period.start)
  const [year, month, day] = period.end.split('-').map(Number)
  const dayAfterEnd = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
  const to = new Date(startOfDayInZone(dayAfterEnd).getTime() - 1)
  return { from: from.toISOString(), to: to.toISOString() }
}

/**
 * Nummeret på notaen. Hele sluggen, ikke de tolv første tegnene: to klubber
 * med samme begynnelse («oslo-comedy-club» og «oslo-comedy-club-2») fikk
 * ellers samme nummer, og `document_number` er unik — da feilet hele
 * månedens kjøring for alle klubber.
 */
function documentNumber(slug: string, periodStart: string) {
  const [year, month] = periodStart.split('-')
  return `AVR-${year}${month}-${slug.toUpperCase()}`
}

export async function generateSettlements(period = previousMonthPeriod()) {
  const db = createAdminClient()
  const { start, end } = period
  const { from, to } = periodBounds(period)

  // En kjøring til for samme periode skal ikke flytte utstedelsesdatoen:
  // notaen ble utstedt første gang, tallene kan rettes.
  const { data: existing } = await db
    .from('club_settlements')
    .select('club_id, issued_at')
    .eq('period_start', start)
    .eq('period_end', end)
  const issuedAtByClub = new Map((existing ?? []).map((row) => [row.club_id, row.issued_at]))

  const { data: clubs } = await db
    .from('clubs')
    .select('id, slug, currency, commission_vat_bps')
    .not('stripe_account_id', 'is', null)

  const rows: SettlementRow[] = []

  for (const club of clubs ?? []) {
    // Salg i perioden. Refunderte ordrer teller med som salg — refusjonen
    // føres for seg, slik at begge sider av transaksjonen er synlige.
    //
    // Ordrer med `cancellation_reason` ga aldri billetter (utsolgt, showet
    // borte, salget stengt) og refunderes automatisk. De var aldri et salg, og
    // hører verken hjemme blant salg eller refusjoner — ellers står provisjonen
    // som inntekt og klubben med penger den aldri fikk beholde.
    const { data: sales } = await db
      .from('orders')
      .select('gross_amount, platform_fee_amount')
      .eq('club_id', club.id)
      .in('status', ['paid', 'refunded'])
      .is('cancellation_reason', null)
      .gte('created_at', from)
      .lte('created_at', to)

    // Refusjoner utført i perioden, uansett når salget skjedde.
    const { data: refunds } = await db
      .from('orders')
      .select('club_net_amount, refunded_amount, application_fee_refunded_amount, dispute_net_amount')
      .eq('club_id', club.id)
      .eq('status', 'refunded')
      .is('cancellation_reason', null)
      .gte('refunded_at', from)
      .lte('refunded_at', to)

    const gross = (sales ?? []).reduce((total, row) => total + (row.gross_amount ?? 0), 0)
    const commission = (sales ?? []).reduce((total, row) => total + (row.platform_fee_amount ?? 0), 0)
    const refunded = (refunds ?? []).reduce((total, row) => total + refundedClubAmount(row), 0)

    if (gross === 0 && refunded === 0) continue

    // 0 så lenge formidlingen er unntatt etter mval. § 3-7. Feltet finnes
    // for at et annet svar blir en verdiendring, ikke en ombygging.
    const commissionVat = Math.round((commission * club.commission_vat_bps) / 10000)

    rows.push({
      club_id: club.id,
      period_start: start,
      period_end: end,
      gross_amount: gross,
      commission_amount: commission,
      commission_vat_amount: commissionVat,
      refunded_amount: refunded,
      net_amount: gross - commission - commissionVat - refunded,
      currency: club.currency.toUpperCase(),
      document_number: documentNumber(club.slug, start),
      issued_at: issuedAtByClub.get(club.id) ?? new Date().toISOString(),
    })
  }

  if (rows.length > 0) {
    const { error } = await db
      .from('club_settlements')
      .upsert(rows, { onConflict: 'club_id,period_start,period_end' })

    if (error) throw new Error(`Could not write settlements: ${error.message}`)
  }

  return { period: `${start}–${end}`, settlements: rows.length }
}
