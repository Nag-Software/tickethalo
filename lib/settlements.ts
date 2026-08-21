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
 */

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
    const { data: sales } = await db
      .from('orders')
      .select('gross_amount, platform_fee_amount')
      .eq('club_id', club.id)
      .in('status', ['paid', 'refunded'])
      .gte('created_at', from)
      .lte('created_at', to)

    // Refusjoner utført i perioden, uansett når salget skjedde.
    const { data: refunds } = await db
      .from('orders')
      .select('club_net_amount')
      .eq('club_id', club.id)
      .eq('status', 'refunded')
      .gte('refunded_at', from)
      .lte('refunded_at', to)

    const gross = (sales ?? []).reduce((total, row) => total + (row.gross_amount ?? 0), 0)
    const commission = (sales ?? []).reduce((total, row) => total + (row.platform_fee_amount ?? 0), 0)
    const refunded = (refunds ?? []).reduce((total, row) => total + (row.club_net_amount ?? 0), 0)

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
