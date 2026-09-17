import { createAdminClient } from '@/lib/supabase/admin'

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
}

/**
 * Hva en refusjon tok fra klubben: det som gikk tilbake til kunden, minus
 * provisjonen Tickethalo førte tilbake. Samme formel som utbetalingen bruker,
 * slik at en refusjon i dashbordet uten tilbakeført provisjon også stemmer.
 * Eldre ordrer uten refusjonsbeløp faller tilbake på klubbens andel.
 */
export function refundedClubAmount(order: RefundedOrder): number {
  const refunded = order.refunded_amount ?? 0
  if (refunded <= 0) return order.club_net_amount ?? 0
  return refunded - (order.application_fee_refunded_amount ?? 0)
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

/** Forrige hele måned, som er perioden en månedlig avregning gjelder. */
export function previousMonthPeriod(today = new Date()) {
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0))
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function documentNumber(slug: string, periodStart: string) {
  const [year, month] = periodStart.split('-')
  return `AVR-${year}${month}-${slug.toUpperCase().slice(0, 12)}`
}

export async function generateSettlements(period = previousMonthPeriod()) {
  const db = createAdminClient()
  const { start, end } = period

  // Hele døgnet på sluttdatoen skal med.
  const from = `${start}T00:00:00.000Z`
  const to = `${end}T23:59:59.999Z`

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
      .select('club_net_amount, refunded_amount, application_fee_refunded_amount')
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
      issued_at: new Date().toISOString(),
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
