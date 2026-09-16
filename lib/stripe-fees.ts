import { createHash } from 'node:crypto'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database'

/**
 * Stripe-gebyrer: hvor de trekkes, og hvordan de bokføres.
 *
 * Klubbkontoene er opprettet med `fees_collector = application`. Da trekker
 * Stripe ikke behandlingsgebyret fra klubbens betaling — klubbens
 * balansetransaksjon har bare vår provisjon (`application_fee`) i
 * `fee_details`. Gebyret og mvaen på det belastes plattformkontoen i stedet,
 * som daglige samleposter (`type = stripe_fee`, `reporting_category = fee`,
 * beskrivelse som «Card (2026-08-24)») uten noen ID som peker på betalingen.
 *
 * Det gir tre regler:
 *
 *  - `club_net_amount` røres ikke. Den er brutto minus provisjon, klubben får
 *    nøyaktig 90 %, og det finnes ingen differanse å rette opp. Den gamle
 *    «true-up»-modellen (delrefusjon av provisjonen) bygget på motsatt
 *    antakelse og ga klubben penger den allerede hadde.
 *
 *  - Tickethalos regnskap er `platform_balance_transactions`: et eksakt speil
 *    av plattformkontoens balansetransaksjoner, som summerer til Stripe-saldoen.
 *    Provisjon inn, provisjon tilbake og gebyrer per måned står i viewet
 *    `platform_ledger_monthly`. Det tallet stemmer uansett om fordelingen
 *    under lykkes.
 *
 *  - Gebyret per ordre finnes bare i Stripes Fees report, som har
 *    `incurred_by` (charge-ID-en) på hver gebyrlinje. Linjene lagres i
 *    `stripe_fee_entries` og summeres til `orders.stripe_fee_amount`,
 *    `stripe_fee_tax_amount` og `stripe_fee_status`. Rapportdata kommer ~96 t
 *    etter at gebyret traff saldoen, og rapporten tilbys ikke på alle kontoer
 *    (bl.a. ikke i testmodus). Da blir ordrene stående `pending` — hovedboken
 *    over er komplett likevel.
 *
 * Alt kjøres daglig av `app/api/cron/stripe-fees` via `reconcileStripeFees`.
 * Hvert steg er idempotent: overlappende kjøringer skriver de samme radene på
 * nytt i stedet for å dobbeltføre.
 */

type AdminClient = ReturnType<typeof createAdminClient>
type Tables = Database['public']['Tables']
type BalanceTransactionInsert = Tables['platform_balance_transactions']['Insert']
export type FeeEntryInsert = Tables['stripe_fee_entries']['Insert']

/**
 * Pivotert på når gebyret traff saldoen, ikke når betalingen skjedde. Da er
 * et intervall ferdig når Stripe har data til og med slutten av det, og
 * tidsaksen er den samme som i `platform_balance_transactions`.
 */
export const ALL_FEES_REPORT_TYPE = 'all_fees.balance_transaction_created.itemized.2'

export const FEE_REPORT_COLUMNS = [
  'balance_transaction_id',
  'balance_transaction_created',
  'fee_transaction_id',
  'incurred_at',
  'incurred_by',
  'incurred_by_type',
  'amount',
  'tax',
  'currency',
  'product',
  'feature_name',
  'fee_description',
] as const

export const FEE_REPORT_UNAVAILABLE_REASON =
  'Stripe Fees report is not available on this account (not offered in test mode)'

const DAY_SECONDS = 24 * 60 * 60
/** Transaksjoner kan dukke opp i listen litt etter `created`; overlappen tar dem igjen. */
const BALANCE_SYNC_OVERLAP_SECONDS = 2 * DAY_SECONDS
/** Korte intervaller holder rapportfilen liten nok til å behandles innenfor cron-tiden. */
const MAX_REPORT_INTERVAL_SECONDS = 7 * DAY_SECONDS
/** En kjøring som ikke kan lastes ned på så lenge, skal ikke blokkere nye forespørsler. */
const STALE_REPORT_RUN_MS = 3 * DAY_SECONDS * 1000
const UPSERT_CHUNK_SIZE = 500
/** `.in()` havner i URL-en; mange ID-er per kall gir for lange forespørsler. */
const FILTER_CHUNK_SIZE = 100
const PAGE_SIZE = 1000

// ─────────────────────────────────────────────────────────────
// Rene hjelpere (testet i tests/unit/finance/stripe-fees.test.ts)
// ─────────────────────────────────────────────────────────────

/**
 * RFC 4180-CSV: felt i anførselstegn kan inneholde komma, linjeskift og
 * doble anførselstegn (`""`). Tåler CRLF, BOM og avsluttende linjeskift.
 * Stripes rapporter skrives slik; en naiv `split(',')` knekker på første
 * beskrivelse med komma i.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let atFieldStart = true
  let rowOpen = false

  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index += 1) {
    const char = text[index]

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && atFieldStart) {
      inQuotes = true
      atFieldStart = false
      rowOpen = true
      continue
    }

    if (char === ',') {
      row.push(field)
      field = ''
      atFieldStart = true
      rowOpen = true
      continue
    }

    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      atFieldStart = true
      rowOpen = false
      continue
    }

    field += char
    atFieldStart = false
    rowOpen = true
  }

  if (inQuotes) throw new Error('Malformed CSV: unterminated quoted field')
  if (rowOpen) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/** Én linje fra Fees report slik den står i filen. Beløp er i hovedenhet (`8.47`). */
export type FeesReportRow = {
  balance_transaction_id: string | null
  balance_transaction_created: string | null
  fee_transaction_id: string | null
  incurred_at: string | null
  incurred_by: string | null
  incurred_by_type: string | null
  amount: string
  tax: string | null
  currency: string
  product: string | null
  feature_name: string | null
  fee_description: string | null
}

const OPTIONAL_REPORT_COLUMNS = [
  'balance_transaction_id',
  'balance_transaction_created',
  'fee_transaction_id',
  'incurred_at',
  'incurred_by',
  'incurred_by_type',
  'tax',
  'product',
  'feature_name',
  'fee_description',
] as const

/**
 * Leser rapportfilen etter kolonnenavn, ikke posisjon — Stripe kan legge til
 * kolonner. Ukjente kolonner ignoreres, manglende valgfrie blir null. Uten
 * beløp og valuta er linjen ubrukelig, og da feiler hele filen i stedet for
 * at gebyret stille blir borte.
 */
export function parseFeesReport(text: string): FeesReportRow[] {
  const [header, ...records] = parseCsv(text)
  if (!header) return []

  const columns = new Map(header.map((name, index) => [name.trim(), index] as const))
  for (const required of ['amount', 'currency']) {
    if (!columns.has(required)) throw new Error(`Fees report is missing the "${required}" column`)
  }

  const rows: FeesReportRow[] = []

  records.forEach((record, recordIndex) => {
    if (record.every((value) => value.trim() === '')) return

    const read = (column: string): string | null => {
      const position = columns.get(column)
      if (position === undefined) return null
      const value = record[position]?.trim()
      return value ? value : null
    }

    const amount = read('amount')
    const currency = read('currency')
    if (!amount || !currency) {
      // +2: overskriften er linje 1, og første record er linje 2.
      throw new Error(`Fees report line ${recordIndex + 2} has no amount or currency`)
    }

    const optional = Object.fromEntries(
      OPTIONAL_REPORT_COLUMNS.map((column) => [column, read(column)]),
    ) as Omit<FeesReportRow, 'amount' | 'currency'>

    rows.push({ ...optional, amount, currency })
  })

  return rows
}

/** Valutaer uten desimaler i Stripe (beløp i API-et er hele enheter). */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
])
const THREE_DECIMAL_CURRENCIES = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND'])

function currencyExponent(currency: string): number {
  const code = currency.trim().toUpperCase()
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3
  return 2
}

/**
 * `'8.47'` NOK → 847. Regnes på sifrene i strengen, ikke med flyttall:
 * `1.005 * 100` er 100.49999…, og en avrunding på det gir feil øre. Har
 * rapporten flere desimaler enn valutaen, rundes det halvt bort fra null i
 * stedet for å kuttes.
 */
export function toMinorUnits(major: string, currency: string): number {
  const match = /^([+-])?(\d*)(?:\.(\d*))?$/.exec(major.trim())
  if (!match || (!match[2] && !match[3])) {
    throw new Error(`Invalid amount "${major}" in fees report`)
  }

  const [, sign, whole, fraction = ''] = match
  const exponent = currencyExponent(currency)
  const digits = (whole || '0') + fraction.padEnd(exponent, '0').slice(0, exponent)

  let units = Number(digits)
  if ((fraction[exponent] ?? '0') >= '5') units += 1

  if (!Number.isSafeInteger(units)) {
    throw new Error(`Amount "${major}" is too large to store in minor units`)
  }

  return sign === '-' && units !== 0 ? -units : units
}

/**
 * Tidspunkt fra rapporten til ISO. Rapporten kjøres med `Etc/UTC` og skriver
 * tider uten sone (`2026-08-24 12:00:00`); de må merkes som UTC her, ellers
 * tolker databasen dem i sin egen sone.
 */
export function reportTimestampToIso(value: string | null): string | null {
  if (!value) return null

  let parsed: number
  if (/^\d+$/.test(value)) {
    parsed = Number(value) * 1000
  } else {
    const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(value)
    parsed = Date.parse(naive ? `${naive[1]}T${naive[2]}Z` : value)
  }

  if (Number.isNaN(parsed)) throw new Error(`Invalid timestamp "${value}" in fees report`)
  return new Date(parsed).toISOString()
}

/**
 * Stabil nøkkel for én gebyrlinje, slik at samme linje fra to overlappende
 * rapportkjøringer blir én rad. Rapporten har ingen egen linje-ID, og to
 * helt like linjer kan være to ekte gebyrer — derfor telles forekomsten med.
 */
export function feeEntryRowKey(row: FeesReportRow, occurrence: number): string {
  const identity = [
    row.balance_transaction_id,
    row.fee_transaction_id,
    row.balance_transaction_created,
    row.incurred_at,
    row.incurred_by,
    row.incurred_by_type,
    row.amount,
    row.tax,
    row.currency.toUpperCase(),
    row.product,
    row.feature_name,
    row.fee_description,
    occurrence,
  ]

  return createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

/** Rapportlinjer → rader for `stripe_fee_entries`, med beløp i minste enhet. */
export function buildFeeEntries(rows: FeesReportRow[], reportRunId: string): FeeEntryInsert[] {
  const occurrences = new Map<string, number>()

  return rows.map((row) => {
    const firstKey = feeEntryRowKey(row, 0)
    const occurrence = occurrences.get(firstKey) ?? 0
    occurrences.set(firstKey, occurrence + 1)

    const currency = row.currency.toUpperCase()

    // order_id settes bevisst ikke: en upsert uten feltet lar en eksisterende
    // kobling til ordren stå.
    return {
      row_key: occurrence === 0 ? firstKey : feeEntryRowKey(row, occurrence),
      report_run_id: reportRunId,
      balance_transaction_id: row.balance_transaction_id,
      fee_transaction_id: row.fee_transaction_id,
      incurred_by: row.incurred_by,
      incurred_by_type: row.incurred_by_type,
      incurred_at: reportTimestampToIso(row.incurred_at),
      amount: toMinorUnits(row.amount, currency),
      tax_amount: row.tax ? toMinorUnits(row.tax, currency) : 0,
      currency,
      product: row.product,
      feature_name: row.feature_name,
      fee_description: row.fee_description,
    }
  })
}

export type FeeLine = {
  incurred_by?: string | null
  incurred_by_type?: string | null
  amount: number
  tax_amount?: number | null
  currency: string
}

/** `currency` er null når linjene for samme betaling har ulik valuta. */
export type ChargeFeeTotal = { amount: number; tax: number; currency: string | null; lines: number }

/**
 * Gebyr per betaling. Bare linjer utløst av en charge teller — gebyrer for
 * refusjoner, disputes og utbetalinger hører ikke til kjøpet.
 */
export function sumFeesByCharge(entries: FeeLine[]): Map<string, ChargeFeeTotal> {
  const totals = new Map<string, ChargeFeeTotal>()

  for (const entry of entries) {
    if (entry.incurred_by_type !== 'charge' || !entry.incurred_by) continue

    const currency = entry.currency.toUpperCase()
    const tax = entry.tax_amount ?? 0
    const total = totals.get(entry.incurred_by)

    if (!total) {
      totals.set(entry.incurred_by, { amount: entry.amount, tax, currency, lines: 1 })
      continue
    }

    total.amount += entry.amount
    total.tax += tax
    total.lines += 1
    if (total.currency !== currency) total.currency = null
  }

  return totals
}

export type FeeReportIntervalInput = {
  /** `interval_end` på siste behandlede kjøring, i Unix-sekunder. */
  lastProcessedEnd: number | null
  /** `created_at` på eldste ordre med `stripe_fee_status = pending`, i Unix-sekunder. */
  oldestPendingOrderAt: number | null
  dataAvailableStart: number
  dataAvailableEnd: number
}

/**
 * Neste rapportintervall. Fortsetter der forrige behandlede kjøring slapp, slik
 * at intervallene ligger kant i kant. Første gang starter det på døgnet til
 * eldste ordre som venter — gebyret kan ikke ha truffet saldoen før betalingen.
 * Null betyr at Stripe ikke har nye data ennå.
 */
export function nextFeeReportInterval(input: FeeReportIntervalInput): { start: number; end: number } | null {
  const candidate =
    input.lastProcessedEnd ??
    (input.oldestPendingOrderAt !== null
      ? Math.floor(input.oldestPendingOrderAt / DAY_SECONDS) * DAY_SECONDS
      : input.dataAvailableStart)

  const start = Math.max(candidate, input.dataAvailableStart)
  const end = Math.min(input.dataAvailableEnd, start + MAX_REPORT_INTERVAL_SECONDS)

  return end > start ? { start, end } : null
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

function unixToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

function isoToUnix(value: string): number {
  return Math.floor(Date.parse(value) / 1000)
}

export type ApplicationFeeLink = { connectedAccountId: string | null; chargeId: string | null }

/**
 * Hvilken application fee transaksjonen gjelder: provisjonen selv, eller
 * provisjonen en tilbakeføring (`fee_refund`) hører til.
 */
function applicationFeeIdOf(transaction: Stripe.BalanceTransaction): string | null {
  const source = transaction.source

  if (transaction.type === 'application_fee') return idOf(source)
  if (transaction.type === 'application_fee_refund' && source && typeof source !== 'string') {
    return source.object === 'fee_refund' ? idOf(source.fee) : null
  }

  return null
}

function linkFromApplicationFee(fee: Stripe.ApplicationFee): ApplicationFeeLink {
  // På en direct charge er `charge` betalingen på klubbens konto — samme ID som
  // `orders.stripe_charge_id`. `originating_transaction` settes bare for
  // destination charges og er reserve.
  return {
    connectedAccountId: idOf(fee.account),
    chargeId: idOf(fee.charge) ?? fee.fee_source?.charge ?? idOf(fee.originating_transaction),
  }
}

/** Én balansetransaksjon → rad i `platform_balance_transactions`. */
export function toPlatformBalanceTransaction(
  transaction: Stripe.BalanceTransaction,
  links: Map<string, ApplicationFeeLink>,
  syncedAt: string,
): BalanceTransactionInsert {
  const feeId = applicationFeeIdOf(transaction)
  const link = feeId ? links.get(feeId) : undefined

  return {
    id: transaction.id,
    type: transaction.type,
    reporting_category: transaction.reporting_category,
    amount: transaction.amount,
    fee: transaction.fee,
    net: transaction.net,
    // Store bokstaver, som på ordrene, slik at valutaene kan sammenlignes direkte.
    currency: transaction.currency.toUpperCase(),
    source_id: idOf(transaction.source),
    description: transaction.description,
    connected_account_id: link?.connectedAccountId ?? null,
    charge_id: link?.chargeId ?? null,
    created_at_stripe: unixToIso(transaction.created),
    available_on: unixToIso(transaction.available_on),
    synced_at: syncedAt,
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type StripeErrorShape = { statusCode?: number; code?: string; type?: string; message?: string }

function stripeErrorShape(error: unknown): StripeErrorShape {
  return error && typeof error === 'object' ? (error as StripeErrorShape) : {}
}

function isNotFoundError(error: unknown): boolean {
  const shape = stripeErrorShape(error)
  return shape.statusCode === 404 || shape.code === 'resource_missing'
}

/**
 * Rapporttypen finnes ikke for kontoen, krever live-nøkkel eller er ikke
 * tilgjengelig for nøkkelen. Ingen av delene retter seg selv til neste kjøring.
 */
export function isReportUnavailableError(error: unknown): boolean {
  const shape = stripeErrorShape(error)
  return (
    isNotFoundError(error) ||
    shape.statusCode === 403 ||
    shape.type === 'StripePermissionError' ||
    /live[\s-]?mode/i.test(shape.message ?? '')
  )
}

function isExpansionError(error: unknown): boolean {
  const shape = stripeErrorShape(error)
  return shape.statusCode === 400 && /expan/i.test(shape.message ?? '')
}

// ─────────────────────────────────────────────────────────────
// 1. Plattformens hovedbok
// ─────────────────────────────────────────────────────────────

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = []
  for await (const item of items) collected.push(item)
  return collected
}

async function listPlatformBalanceTransactions(gte: number | null): Promise<Stripe.BalanceTransaction[]> {
  const params: Stripe.BalanceTransactionListParams = {
    limit: 100,
    ...(gte !== null ? { created: { gte } } : {}),
  }

  try {
    return await collect(stripe.balanceTransactions.list({ ...params, expand: ['data.source'] }))
  } catch (error) {
    if (!isExpansionError(error)) throw error

    // Beløpene er det viktige. Uten utvidet kilde mister provisjonsradene bare
    // koblingen til klubb og betaling, og den slås opp i databasen i stedet.
    console.warn(`[Fees] Could not expand balance transaction sources (${errorMessage(error)}); listing without.`)
    return collect(stripe.balanceTransactions.list(params))
  }
}

/**
 * Klubb og betaling for hver application fee i utvalget. Utvidede kilder gir
 * svaret direkte; tilbakeføringer peker bare på provisjonens ID, og den slås
 * opp i provisjonsradene som allerede er speilet, og deretter i ordrene.
 */
async function resolveApplicationFeeLinks(
  db: AdminClient,
  transactions: Stripe.BalanceTransaction[],
): Promise<Map<string, ApplicationFeeLink>> {
  const links = new Map<string, ApplicationFeeLink>()
  const wanted = new Set<string>()

  for (const transaction of transactions) {
    const feeId = applicationFeeIdOf(transaction)
    if (!feeId) continue
    wanted.add(feeId)

    const source = transaction.source
    if (source && typeof source !== 'string') {
      if (source.object === 'application_fee') links.set(source.id, linkFromApplicationFee(source))
      if (source.object === 'fee_refund' && typeof source.fee !== 'string') {
        links.set(source.fee.id, linkFromApplicationFee(source.fee))
      }
    }
  }

  const missing = () => [...wanted].filter((id) => !links.get(id)?.connectedAccountId)

  for (const ids of chunk(missing(), FILTER_CHUNK_SIZE)) {
    const { data, error } = await db
      .from('platform_balance_transactions')
      .select('source_id, connected_account_id, charge_id')
      .eq('type', 'application_fee')
      .in('source_id', ids)
      .not('connected_account_id', 'is', null)

    if (error) throw new Error(`Could not look up stored application fees: ${error.message}`)

    for (const row of data ?? []) {
      if (row.source_id) {
        links.set(row.source_id, { connectedAccountId: row.connected_account_id, chargeId: row.charge_id })
      }
    }
  }

  for (const ids of chunk(missing(), FILTER_CHUNK_SIZE)) {
    const { data, error } = await db
      .from('orders')
      .select('stripe_application_fee_id, stripe_connected_account_id, stripe_charge_id')
      .in('stripe_application_fee_id', ids)

    if (error) throw new Error(`Could not look up orders by application fee: ${error.message}`)

    for (const row of data ?? []) {
      if (row.stripe_application_fee_id) {
        links.set(row.stripe_application_fee_id, {
          connectedAccountId: row.stripe_connected_account_id,
          chargeId: row.stripe_charge_id,
        })
      }
    }
  }

  return links
}

/**
 * Speiler plattformkontoens balansetransaksjoner inn i
 * `platform_balance_transactions`. Idempotent på transaksjons-ID.
 */
export async function syncPlatformBalanceTransactions(): Promise<{ synced: number }> {
  const db = createAdminClient()

  const { data: latest, error: cursorError } = await db
    .from('platform_balance_transactions')
    .select('created_at_stripe')
    .order('created_at_stripe', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (cursorError) throw new Error(`Could not read the balance transaction cursor: ${cursorError.message}`)

  const gte = latest ? isoToUnix(latest.created_at_stripe) - BALANCE_SYNC_OVERLAP_SECONDS : null
  const transactions = await listPlatformBalanceTransactions(gte)
  if (transactions.length === 0) return { synced: 0 }

  const links = await resolveApplicationFeeLinks(db, transactions)
  const syncedAt = new Date().toISOString()

  // Eldste først. Stopper kjøringen midtveis, ligger markøren fortsatt bak alt
  // som mangler. Stripe lister nyeste først, og lagret i den rekkefølgen ville
  // markøren hoppet forbi hullet for godt.
  const rows = [...transactions]
    .sort((a, b) => a.created - b.created)
    .map((transaction) => toPlatformBalanceTransaction(transaction, links, syncedAt))

  for (const rowsChunk of chunk(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await db.from('platform_balance_transactions').upsert(rowsChunk, { onConflict: 'id' })
    if (error) throw new Error(`Could not store platform balance transactions: ${error.message}`)
  }

  return { synced: rows.length }
}

// ─────────────────────────────────────────────────────────────
// 2. Gebyrrapporten
// ─────────────────────────────────────────────────────────────

/**
 * Ber Stripe kjøre Fees report for neste intervall. Én kjøring av gangen: en
 * ventende kjøring må behandles før neste intervall kan regnes ut.
 */
export async function requestFeeReportRun(): Promise<{ requested: boolean; reason?: string }> {
  const db = createAdminClient()

  const { data: pending, error: pendingError } = await db
    .from('stripe_fee_report_runs')
    .select('report_run_id')
    .eq('status', 'pending')
    .limit(1)

  if (pendingError) throw new Error(`Could not read fee report runs: ${pendingError.message}`)
  if (pending && pending.length > 0) {
    return { requested: false, reason: `report run ${pending[0].report_run_id} is still pending` }
  }

  let reportType: Stripe.Reporting.ReportType
  try {
    reportType = await stripe.reporting.reportTypes.retrieve(ALL_FEES_REPORT_TYPE)
  } catch (error) {
    if (isReportUnavailableError(error)) return { requested: false, reason: FEE_REPORT_UNAVAILABLE_REASON }
    throw error
  }

  const { data: lastRun, error: lastRunError } = await db
    .from('stripe_fee_report_runs')
    .select('interval_end')
    .eq('status', 'processed')
    .order('interval_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastRunError) throw new Error(`Could not read the last processed fee report: ${lastRunError.message}`)

  let oldestPendingOrderAt: number | null = null
  if (!lastRun) {
    const { data: oldestPending, error: orderError } = await db
      .from('orders')
      .select('created_at')
      .eq('stripe_fee_status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (orderError) throw new Error(`Could not read orders awaiting fees: ${orderError.message}`)
    oldestPendingOrderAt = oldestPending ? isoToUnix(oldestPending.created_at) : null
  }

  const interval = nextFeeReportInterval({
    lastProcessedEnd: lastRun ? isoToUnix(lastRun.interval_end) : null,
    oldestPendingOrderAt,
    dataAvailableStart: reportType.data_available_start,
    dataAvailableEnd: reportType.data_available_end,
  })

  if (!interval) return { requested: false, reason: 'no new fee data yet' }

  let run: Stripe.Reporting.ReportRun
  try {
    run = await stripe.reporting.reportRuns.create(
      {
        report_type: ALL_FEES_REPORT_TYPE,
        parameters: {
          interval_start: interval.start,
          interval_end: interval.end,
          timezone: 'Etc/UTC',
          columns: [...FEE_REPORT_COLUMNS],
        },
      },
      // Krasjer kjøringen mellom Stripe-kallet og innsettingen, gir neste
      // forsøk samme rapportkjøring tilbake i stedet for en ny.
      { idempotencyKey: `fee-report:${ALL_FEES_REPORT_TYPE}:${interval.start}:${interval.end}` },
    )
  } catch (error) {
    if (isReportUnavailableError(error)) return { requested: false, reason: FEE_REPORT_UNAVAILABLE_REASON }
    throw error
  }

  const { error: insertError } = await db.from('stripe_fee_report_runs').insert({
    report_run_id: run.id,
    report_type: ALL_FEES_REPORT_TYPE,
    interval_start: unixToIso(interval.start),
    interval_end: unixToIso(interval.end),
    status: 'pending',
  })

  if (insertError) {
    // Samme idempotency key innen 24 t gir en kjøring vi allerede har en rad for.
    if (insertError.code === '23505') {
      return { requested: false, reason: `report run ${run.id} is already recorded` }
    }
    throw new Error(`Could not record fee report run ${run.id}: ${insertError.message}`)
  }

  return { requested: true }
}

/**
 * Filen ligger på files.stripe.com og krever den hemmelige nøkkelen. Nøkkelen
 * sendes bare til Stripe, uansett hva `url` skulle inneholde.
 */
async function downloadReportFile(url: string): Promise<string> {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is not set')

  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !(parsed.hostname === 'stripe.com' || parsed.hostname.endsWith('.stripe.com'))) {
    throw new Error(`Refusing to download report file from ${parsed.hostname}`)
  }

  const response = await fetch(parsed, {
    headers: { Authorization: `Bearer ${secretKey}` },
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(`Report file download failed with HTTP ${response.status}`)
  return response.text()
}

async function markRunFailed(db: AdminClient, rowId: string, message: string) {
  const { error } = await db
    .from('stripe_fee_report_runs')
    .update({ status: 'failed', error: message, processed_at: new Date().toISOString() })
    .eq('id', rowId)

  if (error) throw new Error(`Could not mark fee report run failed: ${error.message}`)
  console.error(`[Fees] Fee report run ${rowId} failed: ${message}`)
}

async function loadChargeFeeLines(db: AdminClient, chargeIds: string[]) {
  const lines: Array<FeeLine & { incurred_by: string | null; order_id: string | null }> = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('stripe_fee_entries')
      .select('incurred_by, incurred_by_type, amount, tax_amount, currency, order_id')
      .eq('incurred_by_type', 'charge')
      .in('incurred_by', chargeIds)
      .order('row_key', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(`Could not read fee entries: ${error.message}`)

    lines.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }

  return lines
}

/**
 * Fører gebyret over på ordrene. Summen tas av alle lagrede linjer for
 * betalingen, ikke bare de i denne rapporten — et gebyr kan justeres i en
 * senere periode, og overlappende kjøringer skal gi samme tall. Returnerer
 * antall ordrer som fikk nye verdier.
 */
async function attributeFeesToOrders(db: AdminClient, chargeIds: string[]): Promise<number> {
  let reconciled = 0

  for (const ids of chunk(chargeIds, FILTER_CHUNK_SIZE)) {
    const { data: orders, error: ordersError } = await db
      .from('orders')
      .select('id, stripe_charge_id, currency, stripe_fee_amount, stripe_fee_tax_amount, stripe_fee_status')
      .in('stripe_charge_id', ids)

    if (ordersError) throw new Error(`Could not read orders for fee attribution: ${ordersError.message}`)
    if (!orders || orders.length === 0) continue

    const ordersByCharge = new Map<string, typeof orders>()
    for (const order of orders) {
      if (!order.stripe_charge_id) continue
      ordersByCharge.set(order.stripe_charge_id, [...(ordersByCharge.get(order.stripe_charge_id) ?? []), order])
    }

    const lines = await loadChargeFeeLines(db, [...ordersByCharge.keys()])
    const totals = sumFeesByCharge(lines)
    const reconciledAt = new Date().toISOString()

    for (const [chargeId, matches] of ordersByCharge) {
      const total = totals.get(chargeId)
      if (!total) continue

      // Samme gebyr på to ordrer ville dobbeltført kostnaden.
      if (matches.length > 1) {
        console.warn(`[Fees] Charge ${chargeId} matches ${matches.length} orders — fee not attributed.`)
        continue
      }

      const order = matches[0]
      if (total.currency === null || total.currency !== order.currency.toUpperCase()) {
        console.warn(
          `[Fees] Fee currency ${total.currency ?? 'mixed'} does not match order ${order.id} (${order.currency}) — ` +
            'fee not attributed.',
        )
        continue
      }

      const unchanged =
        order.stripe_fee_status === 'reconciled' &&
        order.stripe_fee_amount === total.amount &&
        order.stripe_fee_tax_amount === total.tax

      if (!unchanged) {
        const { error } = await db
          .from('orders')
          .update({
            stripe_fee_amount: total.amount,
            stripe_fee_tax_amount: total.tax,
            stripe_fee_status: 'reconciled',
            stripe_fee_reconciled_at: reconciledAt,
          })
          .eq('id', order.id)

        if (error) throw new Error(`Could not book the Stripe fee on order ${order.id}: ${error.message}`)
        reconciled += 1
      }

      if (lines.some((line) => line.incurred_by === chargeId && line.order_id !== order.id)) {
        const { error } = await db
          .from('stripe_fee_entries')
          .update({ order_id: order.id })
          .eq('incurred_by_type', 'charge')
          .eq('incurred_by', chargeId)

        if (error) throw new Error(`Could not link fee entries to order ${order.id}: ${error.message}`)
      }
    }
  }

  return reconciled
}

type PendingRunRow = { id: string; report_run_id: string; created_at: string }

/**
 * Behandler én ventende kjøring. Null = ikke behandlet (fortsatt ventende hos
 * Stripe, eller merket som feilet). Kaster ved forbigående feil, slik at raden
 * står `pending` og prøves igjen ved neste kjøring.
 */
async function processFeeReportRun(
  db: AdminClient,
  row: PendingRunRow,
): Promise<{ entries: number; ordersReconciled: number } | null> {
  let run: Stripe.Reporting.ReportRun
  try {
    run = await stripe.reporting.reportRuns.retrieve(row.report_run_id)
  } catch (error) {
    if (!isNotFoundError(error)) throw error
    // Typisk etter bytte av nøkkel mellom test og live. Kjøringen kommer aldri.
    await markRunFailed(db, row.id, `Stripe report run not found: ${errorMessage(error)}`)
    return null
  }

  if (run.status === 'pending') return null
  if (run.status !== 'succeeded') {
    await markRunFailed(db, row.id, run.error ?? `Stripe report run ended with status ${run.status}`)
    return null
  }

  const url = run.result?.url
  if (!url) {
    await markRunFailed(db, row.id, 'Stripe report run succeeded without a result file')
    return null
  }

  let text: string
  try {
    text = await downloadReportFile(url)
  } catch (error) {
    // Nedlasting feiler som regel forbigående. Men en kjøring som aldri lar seg
    // hente, skal ikke blokkere nye rapporter for alltid.
    if (Date.now() - Date.parse(row.created_at) < STALE_REPORT_RUN_MS) throw error
    await markRunFailed(db, row.id, `Could not download report file: ${errorMessage(error)}`)
    return null
  }

  let entries: FeeEntryInsert[]
  try {
    entries = buildFeeEntries(parseFeesReport(text), run.id)
  } catch (error) {
    // Samme fil gir samme feil neste gang. Intervallet bestilles på nytt,
    // siden neste intervall regnes fra siste behandlede kjøring.
    await markRunFailed(db, row.id, `Could not parse fees report: ${errorMessage(error)}`)
    return null
  }

  for (const entriesChunk of chunk(entries, UPSERT_CHUNK_SIZE)) {
    const { error } = await db.from('stripe_fee_entries').upsert(entriesChunk, { onConflict: 'row_key' })
    if (error) throw new Error(`Could not store fee entries: ${error.message}`)
  }

  const chargeIds = [
    ...new Set(
      entries.flatMap((entry) => (entry.incurred_by_type === 'charge' && entry.incurred_by ? [entry.incurred_by] : [])),
    ),
  ]
  const unattributed = entries.filter((entry) => entry.incurred_by_type !== 'charge' || !entry.incurred_by).length

  const ordersReconciled = await attributeFeesToOrders(db, chargeIds)

  const { error: updateError } = await db
    .from('stripe_fee_report_runs')
    .update({ status: 'processed', row_count: entries.length, processed_at: new Date().toISOString(), error: null })
    .eq('id', row.id)

  if (updateError) throw new Error(`Could not mark fee report run processed: ${updateError.message}`)

  console.log(
    `[Fees] Report run ${run.id}: ${entries.length} fee lines, ${chargeIds.length} charges, ` +
      `${ordersReconciled} orders reconciled, ${unattributed} lines not tied to a charge ` +
      '(refunds, disputes, payouts, account fees)',
  )

  return { entries: entries.length, ordersReconciled }
}

/**
 * Henter ferdige rapportkjøringer, lagrer gebyrlinjene og fører dem på
 * ordrene. Feil i én kjøring stopper ikke de andre.
 */
export async function processFeeReportRuns(): Promise<{ processed: number; entries: number; ordersReconciled: number }> {
  const db = createAdminClient()

  const { data: runs, error } = await db
    .from('stripe_fee_report_runs')
    .select('id, report_run_id, created_at')
    .eq('status', 'pending')
    .order('interval_start', { ascending: true })

  if (error) throw new Error(`Could not read pending fee report runs: ${error.message}`)

  const result = { processed: 0, entries: 0, ordersReconciled: 0 }

  for (const row of runs ?? []) {
    try {
      const outcome = await processFeeReportRun(db, row)
      if (!outcome) continue

      result.processed += 1
      result.entries += outcome.entries
      result.ordersReconciled += outcome.ordersReconciled
    } catch (runError) {
      console.error(`[Fees] Could not process fee report run ${row.report_run_id}: ${errorMessage(runError)}`)
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────
// 3. Hele avstemmingen
// ─────────────────────────────────────────────────────────────

/**
 * Hovedbok først, så ferdige rapporter, så bestilling av neste. Rekkefølgen
 * gjør at en rapport bestilt i dag behandles i morgen, når Stripe har kjørt
 * den. Hvert steg feiler for seg — en utilgjengelig rapport skal ikke stoppe
 * hovedboken.
 */
export async function reconcileStripeFees(): Promise<{
  balanceTransactions: number
  reportsProcessed: number
  ordersReconciled: number
  reportRequested: boolean
  note?: string
}> {
  const summary = { balanceTransactions: 0, reportsProcessed: 0, ordersReconciled: 0, reportRequested: false }
  const notes: string[] = []

  try {
    summary.balanceTransactions = (await syncPlatformBalanceTransactions()).synced
  } catch (error) {
    console.error(`[Fees] Platform balance transaction sync failed: ${errorMessage(error)}`)
    notes.push(`balance transaction sync failed: ${errorMessage(error)}`)
  }

  try {
    const processed = await processFeeReportRuns()
    summary.reportsProcessed = processed.processed
    summary.ordersReconciled = processed.ordersReconciled
  } catch (error) {
    console.error(`[Fees] Fee report processing failed: ${errorMessage(error)}`)
    notes.push(`fee report processing failed: ${errorMessage(error)}`)
  }

  try {
    const request = await requestFeeReportRun()
    summary.reportRequested = request.requested
    if (!request.requested && request.reason) {
      console.log(`[Fees] No fee report requested: ${request.reason}`)
      if (request.reason === FEE_REPORT_UNAVAILABLE_REASON) notes.push(request.reason)
    }
  } catch (error) {
    console.error(`[Fees] Fee report request failed: ${errorMessage(error)}`)
    notes.push(`fee report request failed: ${errorMessage(error)}`)
  }

  return notes.length > 0 ? { ...summary, note: notes.join('; ') } : summary
}
