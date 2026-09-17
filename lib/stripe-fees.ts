import { createHash } from 'node:crypto'
import type Stripe from 'stripe'
import { repairMissingChargeFacts } from '@/lib/checkout/finalize'
import { isStripeLiveMode, stripe } from '@/lib/stripe'
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
 * Mvaen kommer som en egen samlepost sekunder etter gebyret, med samme
 * beskrivelse.
 *
 * Det gir tre regler:
 *
 *  - `club_net_amount` røres ikke. Den er brutto minus provisjon, klubben får
 *    nøyaktig 90 %, og det finnes ingen differanse å rette opp. Den gamle
 *    «true-up»-modellen (delrefusjon av provisjonen) bygget på motsatt
 *    antakelse og ga klubben penger den allerede hadde.
 *
 *  - Tickethalos regnskap er `platform_balance_transactions`: et speil av
 *    plattformkontoens balansetransaksjoner, som summerer til Stripe-saldoen.
 *    Hver rad er merket med `livemode` (avgjort av nøkkelen), slik at testdata
 *    aldri blandes med ekte penger og hver modus har sin egen markør. Viewet
 *    `platform_ledger_monthly` viser provisjon inn, provisjon tilbake,
 *    gebyrer og margin (på `net`) per måned, modus og valuta; bevegelser til
 *    og fra egen bank holdes utenfor. Det tallet stemmer uansett om
 *    fordelingen under lykkes.
 *
 *  - Gebyret per ordre finnes bare i Stripes Fees report, som har
 *    `incurred_by` (charge-ID-en) på hver gebyrlinje. Linjene lagres i
 *    `stripe_fee_entries` og summeres til `orders.stripe_fee_amount` (alltid
 *    hele kostnaden inkl. mva), `stripe_fee_tax_amount` og
 *    `stripe_fee_status`. Stripe dokumenterer ikke entydig om linjens `amount`
 *    inkluderer mva, så linjene avstemmes mot hovedboken før noe føres (se
 *    `detectFeeTaxTreatments`). Rapportdata kommer ~96 t etter at gebyret
 *    traff saldoen, og rapporten tilbys ikke på alle kontoer (bl.a. ikke i
 *    testmodus). Da blir ordrene stående `pending` — hovedboken over er
 *    komplett likevel.
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
/** Ett vindu per liste-kall. Små vinduer lagres raskt og gir framdrift selv om kjøringen stopper. */
export const BALANCE_SYNC_WINDOW_SECONDS = 7 * DAY_SECONDS
/** Tomme perioder hoppes over med stadig større vinduer, opp til dette. */
export const BALANCE_SYNC_MAX_WINDOW_SECONDS = 28 * DAY_SECONDS
/**
 * Speilet starter aldri før dette når tabellen er tom. Tickethalo fantes ikke
 * før 2026; eldre historikk på en gjenbrukt plattformkonto er ikke vår, og å
 * gå gjennom den ville brukt opp tidsbudsjettet uten å lagre noe.
 */
export const PLATFORM_LEDGER_FLOOR = Date.UTC(2026, 0, 1) / 1000
/** Synkroniseringen får ikke spise hele cron-tiden; rapportene skal også rekke å kjøre. */
const BALANCE_SYNC_BUDGET_MS = 30_000
/** Hele avstemmingen, med margin til `maxDuration = 60` i cron-ruten. */
const RECONCILE_BUDGET_MS = 50_000
const CHARGE_REPAIR_BUDGET_MS = 10_000
/** Tid som holdes av til å sjekke ventende ordrer etter synkroniseringen. */
const REATTRIBUTION_RESERVE_MS = 5_000
/** Korte intervaller holder rapportfilen liten nok til å behandles innenfor cron-tiden. */
const MAX_REPORT_INTERVAL_SECONDS = 7 * DAY_SECONDS
/** En kjøring som ikke kan lastes ned på så lenge, skal ikke blokkere nye forespørsler. */
const STALE_REPORT_RUN_MS = 3 * DAY_SECONDS * 1000
/**
 * Gebyrposter skrevet innenfor dette av hverandre hører til samme samlepost
 * (gebyret og mvaen på det kommer sekunder fra hverandre).
 */
export const FEE_BATCH_GAP_SECONDS = 60 * 60
/** Hvor langt rundt en refererte gebyrpost hovedboken leses for å finne resten av samleposten. */
const FEE_NEIGHBOURHOOD_SECONDS = 6 * 60 * 60
/** En ordre som fortsatt ikke kan avstemmes etter så lenge, løser seg ikke av seg selv. */
const STUCK_FEE_HOLD_MS = 3 * DAY_SECONDS * 1000
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

/**
 * Rapportlinjer → rader for `stripe_fee_entries`, med beløp i minste enhet.
 * `livemode` er modusen rapporten ble bestilt i — linjene summeres bare mot
 * ordrer og hovedbok i samme modus.
 */
export function buildFeeEntries(rows: FeesReportRow[], reportRunId: string, livemode: boolean): FeeEntryInsert[] {
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
      livemode,
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

// ─────────────────────────────────────────────────────────────
// Mva: avstemming av gebyrlinjene mot hovedboken
// ─────────────────────────────────────────────────────────────

/**
 * Hvordan linjene på en gebyrpost skal leses.
 *
 *  - `tax_included`: `amount` er hele kostnaden (eller det er ingen mva).
 *  - `tax_excluded`: kostnaden er `amount + tax` — mvaen står i samme post
 *    eller i en egen mvapost ved siden av.
 *  - `missing_transaction`: posten er ikke speilet i hovedboken ennå.
 *  - `ledger_incomplete`: hovedboken er ikke speilet langt nok rundt posten
 *    til at hele samleposten kan sees.
 *  - `mismatch`: ingen av lesningene går opp mot hovedboken.
 */
export type FeeTaxTreatment = 'tax_included' | 'tax_excluded' | 'missing_transaction' | 'ledger_incomplete' | 'mismatch'

export type FeeHoldReason = Exclude<FeeTaxTreatment, 'tax_included' | 'tax_excluded'> | 'no_balance_transaction'

export function isVerifiedFeeTaxTreatment(
  treatment: FeeTaxTreatment | undefined,
): treatment is 'tax_included' | 'tax_excluded' {
  return treatment === 'tax_included' || treatment === 'tax_excluded'
}

/** Det avstemmingen trenger fra en rad i `platform_balance_transactions`. */
export type LedgerFeeTransaction = {
  id: string
  reporting_category: string
  amount: number
  fee: number
  currency: string
  created_at_stripe: string
}

/** Summen av alle lagrede gebyrlinjer som peker på én balansetransaksjon. */
export type FeeLineGroup = { amount: number; tax: number; lines: number }

/**
 * Hva transaksjonen kostet plattformen i gebyr. En gebyrpost (`reporting_category
 * = fee`) er gebyret selv, med negativt beløp. Andre poster (f.eks. en eldre
 * betaling på plattformkontoen) bærer gebyret i `fee`.
 */
export function feeTransactionCost(transaction: Pick<LedgerFeeTransaction, 'reporting_category' | 'amount' | 'fee'>): number {
  return transaction.fee - (transaction.reporting_category === 'fee' ? transaction.amount : 0)
}

/**
 * Avgjør per balansetransaksjon om rapportens `amount` inkluderer mva.
 *
 * Stripe sier to ting: Sigma-tabellen `itemized_fees` sier at `amount`
 * ekskluderer mva, rapportens kolonnebeskrivelse sier bare «Tax on the fee».
 * Og på plattformkontoen kommer mvaen som en egen gebyrpost sekunder etter
 * gebyret (−6,78 og −1,69, samme beskrivelse). En linje med `amount` 6,78 og
 * `tax` 1,69 som peker på gebyrposten, går da opp mot den posten alene selv om
 * kostnaden er 8,47. Å sammenligne én post med linjene som peker på den er
 * derfor ikke nok.
 *
 * I stedet samles gebyrpostene i samleposter (samme valuta, skrevet innenfor
 * `FEE_BATCH_GAP_SECONDS` av hverandre), og hele samleposten avstemmes:
 * summen av postenes kostnad (L) mot summen av `amount` (A) og `tax` (T) på
 * alle linjer som peker på postene. Poster uten linjer — mvaposten — teller med
 * i L. L = A betyr at `amount` er hele kostnaden; L = A + T at mvaen kommer i
 * tillegg. Går ingen opp, eller begge, føres ingenting.
 *
 * Toleransen er én minste enhet per linje: Stripe runder mvaen på samleposten,
 * rapporten per linje. Den er langt mindre enn mvaen, så de to lesningene kan
 * ikke forveksles.
 *
 * Samleposten må være speilet i sin helhet: ligger den nærmere kanten av et
 * tidsrom som er lest komplett (`complete`) enn `FEE_BATCH_GAP_SECONDS`, kan en
 * del mangle, og da ventes det. Ren funksjon — testet i
 * tests/unit/finance/stripe-fees.test.ts.
 */
export function detectFeeTaxTreatments(input: {
  /** Linjesummer per balansetransaksjon. Nøklene er postene det svares for. */
  groups: Map<string, FeeLineGroup>
  /** De refererte postene og alle gebyrposter rundt dem. */
  ledger: LedgerFeeTransaction[]
  /** Unix-sekunder: tidsrommene hovedboken over er lest komplett for. */
  complete: Array<{ from: number; through: number }>
  batchGapSeconds?: number
}): Map<string, FeeTaxTreatment> {
  const gap = input.batchGapSeconds ?? FEE_BATCH_GAP_SECONDS
  const treatments = new Map<string, FeeTaxTreatment>()
  const created = (transaction: LedgerFeeTransaction) => isoToUnix(transaction.created_at_stripe)
  const byId = new Map(input.ledger.map((transaction) => [transaction.id, transaction]))

  for (const id of input.groups.keys()) {
    if (!byId.has(id)) treatments.set(id, 'missing_transaction')
  }

  const batches: Array<{ transactions: LedgerFeeTransaction[]; batched: boolean }> = []
  const feeTransactions = [...byId.values()]
    .filter((transaction) => transaction.reporting_category === 'fee')
    .sort((a, b) => a.currency.localeCompare(b.currency) || created(a) - created(b))

  let current: LedgerFeeTransaction[] = []
  for (const transaction of feeTransactions) {
    const previous = current.at(-1)
    if (previous && (previous.currency !== transaction.currency || created(transaction) - created(previous) > gap)) {
      batches.push({ transactions: current, batched: true })
      current = []
    }
    current.push(transaction)
  }
  if (current.length > 0) batches.push({ transactions: current, batched: true })

  // Andre poster med gebyr i `fee` står for seg selv — de har ingen egen mvapost.
  for (const transaction of byId.values()) {
    if (transaction.reporting_category !== 'fee' && input.groups.has(transaction.id)) {
      batches.push({ transactions: [transaction], batched: false })
    }
  }

  for (const batch of batches) {
    const referenced = batch.transactions.filter((transaction) => input.groups.has(transaction.id))
    if (referenced.length === 0) continue

    const first = created(batch.transactions[0])
    const last = created(batch.transactions[batch.transactions.length - 1])
    let treatment: FeeTaxTreatment

    const covered = input.complete.some((window) => first - gap >= window.from && last + gap <= window.through)

    if (batch.batched && !covered) {
      treatment = 'ledger_incomplete'
    } else {
      let amount = 0
      let tax = 0
      let lines = 0
      for (const transaction of referenced) {
        const group = input.groups.get(transaction.id)!
        amount += group.amount
        tax += group.tax
        lines += group.lines
      }

      const cost = batch.transactions.reduce((total, transaction) => total + feeTransactionCost(transaction), 0)
      const tolerance = Math.max(lines, 1)
      const includedFits = Math.abs(cost - amount) <= tolerance
      const excludedFits = Math.abs(cost - (amount + tax)) <= tolerance

      if (tax === 0) treatment = includedFits ? 'tax_included' : 'mismatch'
      else if (excludedFits && !includedFits) treatment = 'tax_excluded'
      else if (includedFits && !excludedFits) treatment = 'tax_included'
      else treatment = 'mismatch'
    }

    for (const transaction of referenced) treatments.set(transaction.id, treatment)
  }

  return treatments
}

export type FeeLine = {
  incurred_by?: string | null
  incurred_by_type?: string | null
  balance_transaction_id?: string | null
  amount: number
  tax_amount?: number | null
  currency: string
}

export type ChargeFeeTotal = {
  /** Hele kostnaden inkl. mva, lest slik avstemmingen sa. */
  amount: number
  tax: number
  /** Null når linjene for samme betaling har ulik valuta. */
  currency: string | null
  lines: number
  /** Satt når minst én linje ikke kan avstemmes mot hovedboken. Da føres ingenting. */
  hold: FeeHoldReason | null
}

/**
 * Gebyr per betaling. Bare linjer utløst av en charge teller — gebyrer for
 * refusjoner, disputes og utbetalinger hører ikke til kjøpet. `treatments`
 * kommer fra `detectFeeTaxTreatments` og sier om mvaen skal legges til.
 */
export function sumFeesByCharge(
  entries: FeeLine[],
  treatments: Map<string, FeeTaxTreatment>,
): Map<string, ChargeFeeTotal> {
  const totals = new Map<string, ChargeFeeTotal>()

  for (const entry of entries) {
    if (entry.incurred_by_type !== 'charge' || !entry.incurred_by) continue

    const currency = entry.currency.toUpperCase()
    const tax = entry.tax_amount ?? 0
    const treatment = entry.balance_transaction_id ? treatments.get(entry.balance_transaction_id) : undefined
    const hold: FeeHoldReason | null = !entry.balance_transaction_id
      ? 'no_balance_transaction'
      : isVerifiedFeeTaxTreatment(treatment)
        ? null
        : (treatment ?? 'missing_transaction')
    const cost = entry.amount + (treatment === 'tax_excluded' ? tax : 0)
    const total = totals.get(entry.incurred_by)

    if (!total) {
      totals.set(entry.incurred_by, { amount: cost, tax, currency, lines: 1, hold })
      continue
    }

    total.amount += cost
    total.tax += tax
    total.lines += 1
    total.hold = total.hold ?? hold
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

/**
 * Idempotency key for en rapportforespørsel. Krasjer kjøringen mellom
 * Stripe-kallet og innsettingen, gir neste forsøk samme rapportkjøring tilbake.
 * Har en kjøring for intervallet feilet, må neste forsøk derimot få en ny —
 * ellers gir Stripe den feilede tilbake innen 24 t.
 */
export function feeReportIdempotencyKey(interval: { start: number; end: number }, failedAttempts: number): string {
  const key = `fee-report:${ALL_FEES_REPORT_TYPE}:${interval.start}:${interval.end}`
  return failedAttempts > 0 ? `${key}:retry-${failedAttempts}` : key
}

export type BalanceSyncWindow = { gte: number; lt: number }

/**
 * Hvor synkroniseringen av hovedboken starter. Fortsetter fra nyeste lagrede
 * transaksjon i modusen minus overlappen. Er modusen tom, starter den der
 * plattformkontoen ble opprettet — men aldri før `PLATFORM_LEDGER_FLOOR`.
 */
export function balanceSyncStart(input: { latestCreated: number | null; accountCreated: number | null }): number {
  if (input.latestCreated !== null) return input.latestCreated - BALANCE_SYNC_OVERLAP_SECONDS
  return Math.max(input.accountCreated ?? PLATFORM_LEDGER_FLOOR, PLATFORM_LEDGER_FLOOR)
}

/**
 * Neste vindu, eldst først og kant i kant. Etter et tomt vindu dobles
 * bredden (opp til `BALANCE_SYNC_MAX_WINDOW_SECONDS`), slik at en tom periode
 * ikke spiser tidsbudsjettet — markøren flytter seg bare når noe lagres, og
 * en kjøring som stopper i en tom strekning ville ellers startet på samme sted
 * i morgen. Null når vinduet ville startet etter `now`.
 */
export function nextBalanceSyncWindow(
  previous: { window: BalanceSyncWindow; count: number } | null,
  start: number,
  now: number,
): BalanceSyncWindow | null {
  const gte = previous ? previous.window.lt : start
  if (gte > now) return null

  const size =
    previous && previous.count === 0
      ? Math.min((previous.window.lt - previous.window.gte) * 2, BALANCE_SYNC_MAX_WINDOW_SECONDS)
      : BALANCE_SYNC_WINDOW_SECONDS

  return { gte, lt: gte + size }
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
  livemode: boolean,
): BalanceTransactionInsert {
  const feeId = applicationFeeIdOf(transaction)
  const link = feeId ? links.get(feeId) : undefined

  return {
    id: transaction.id,
    // Balansetransaksjonen har ikke `livemode` selv; nøkkelen som listet den avgjør.
    livemode,
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

async function listPlatformBalanceTransactions(window: BalanceSyncWindow): Promise<Stripe.BalanceTransaction[]> {
  const params: Stripe.BalanceTransactionListParams = {
    limit: 100,
    created: { gte: window.gte, lt: window.lt },
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
  livemode: boolean,
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
      .eq('livemode', livemode)
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

/** Nyeste speilede transaksjon i modusen, i Unix-sekunder. */
async function latestMirroredTransaction(db: AdminClient, livemode: boolean): Promise<number | null> {
  const { data, error } = await db
    .from('platform_balance_transactions')
    .select('created_at_stripe')
    .eq('livemode', livemode)
    .order('created_at_stripe', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Could not read the balance transaction cursor: ${error.message}`)
  return data ? isoToUnix(data.created_at_stripe) : null
}

async function platformAccountCreated(): Promise<number | null> {
  try {
    const account = await stripe.accounts.retrieve(null)
    return typeof account.created === 'number' ? account.created : null
  } catch (error) {
    console.warn(`[Fees] Could not read the platform account (${errorMessage(error)}); starting the ledger at the floor.`)
    return null
  }
}

export type BalanceSyncResult = {
  synced: number
  windows: number
  /** False når tidsbudsjettet stoppet kjøringen før den nådde nåtid. */
  complete: boolean
  /** Alt skapt før dette tidspunktet er listet (ISO). Null når ingenting ble listet. */
  syncedThrough: string | null
}

/**
 * Speiler plattformkontoens balansetransaksjoner inn i
 * `platform_balance_transactions`. Idempotent på transaksjons-ID.
 *
 * Går vindu for vindu, eldst først, og lagrer hvert vindu før neste listes.
 * Stopper kjøringen (tidsbudsjett eller at funksjonen blir drept), er alt før
 * vinduet den var i lagret, og markøren — nyeste lagrede transaksjon — ligger
 * bak hullet. Neste kjøring fortsetter derfra i stedet for å begynne på nytt.
 */
export async function syncPlatformBalanceTransactions(options: { deadline?: number } = {}): Promise<BalanceSyncResult> {
  const db = createAdminClient()
  const livemode = isStripeLiveMode()
  const deadline = options.deadline ?? Date.now() + BALANCE_SYNC_BUDGET_MS

  const latestCreated = await latestMirroredTransaction(db, livemode)
  const start = balanceSyncStart({
    latestCreated,
    accountCreated: latestCreated === null ? await platformAccountCreated() : null,
  })
  const now = Math.floor(Date.now() / 1000)

  const result: BalanceSyncResult = { synced: 0, windows: 0, complete: false, syncedThrough: null }
  let previous: { window: BalanceSyncWindow; count: number } | null = null

  for (
    let window = nextBalanceSyncWindow(null, start, now);
    window;
    window = nextBalanceSyncWindow(previous, start, now)
  ) {
    if (Date.now() > deadline) {
      console.warn(
        `[Fees] Balance transaction sync stopped at ${unixToIso(window.gte)} (time budget); continuing next run.`,
      )
      return result
    }

    const transactions = await listPlatformBalanceTransactions(window)

    if (transactions.length > 0) {
      const links = await resolveApplicationFeeLinks(db, transactions, livemode)
      const syncedAt = new Date().toISOString()

      // Eldst først også innen vinduet. Stripe lister nyeste først, og lagret i
      // den rekkefølgen ville markøren hoppet forbi et hull for godt.
      const rows = [...transactions]
        .sort((a, b) => a.created - b.created)
        .map((transaction) => toPlatformBalanceTransaction(transaction, links, syncedAt, livemode))

      for (const rowsChunk of chunk(rows, UPSERT_CHUNK_SIZE)) {
        const { error } = await db.from('platform_balance_transactions').upsert(rowsChunk, { onConflict: 'id' })
        if (error) throw new Error(`Could not store platform balance transactions: ${error.message}`)
      }
    }

    result.synced += transactions.length
    result.windows += 1
    result.syncedThrough = unixToIso(Math.min(window.lt, now))
    previous = { window, count: transactions.length }
  }

  result.complete = true
  result.syncedThrough = unixToIso(now)
  return result
}

// ─────────────────────────────────────────────────────────────
// 2. Gebyrrapporten
// ─────────────────────────────────────────────────────────────

export type FeeReportRequest = {
  requested: boolean
  reason?: string
  /**
   * Satt når kjøringer for neste intervall har feilet. Intervallkjeden står da
   * stille — ingen senere intervaller bestilles før dette lykkes — og det må
   * meldes, ikke bare logges.
   */
  stalled?: { intervalStart: string; failedRuns: number; lastError: string | null }
}

/**
 * Ber Stripe kjøre Fees report for neste intervall. Én kjøring av gangen: en
 * ventende kjøring må behandles før neste intervall kan regnes ut. Alt er
 * avgrenset til modusen nøkkelen gjelder.
 */
export async function requestFeeReportRun(): Promise<FeeReportRequest> {
  const db = createAdminClient()
  const livemode = isStripeLiveMode()

  const { data: pending, error: pendingError } = await db
    .from('stripe_fee_report_runs')
    .select('report_run_id')
    .eq('livemode', livemode)
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
    .eq('livemode', livemode)
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

  // Neste intervall regnes fra siste behandlede kjøring. Har kjøringer med
  // samme start feilet, står kjeden fast der. Det prøves igjen (feilen kan
  // være forbigående), men det meldes.
  const { data: failedRuns, error: failedError } = await db
    .from('stripe_fee_report_runs')
    .select('error')
    .eq('livemode', livemode)
    .eq('status', 'failed')
    .eq('interval_start', unixToIso(interval.start))
    .order('updated_at', { ascending: false })

  if (failedError) throw new Error(`Could not read failed fee report runs: ${failedError.message}`)

  const failedAttempts = failedRuns?.length ?? 0
  const stalled =
    failedAttempts > 0
      ? { intervalStart: unixToIso(interval.start), failedRuns: failedAttempts, lastError: failedRuns?.[0]?.error ?? null }
      : undefined

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
      { idempotencyKey: feeReportIdempotencyKey(interval, failedAttempts) },
    )
  } catch (error) {
    if (isReportUnavailableError(error)) return { requested: false, reason: FEE_REPORT_UNAVAILABLE_REASON, stalled }
    throw error
  }

  const { error: insertError } = await db.from('stripe_fee_report_runs').insert({
    report_run_id: run.id,
    livemode,
    report_type: ALL_FEES_REPORT_TYPE,
    interval_start: unixToIso(interval.start),
    interval_end: unixToIso(interval.end),
    status: 'pending',
  })

  if (insertError) {
    // Samme idempotency key innen 24 t gir en kjøring vi allerede har en rad for.
    if (insertError.code === '23505') {
      return { requested: false, reason: `report run ${run.id} is already recorded`, stalled }
    }
    throw new Error(`Could not record fee report run ${run.id}: ${insertError.message}`)
  }

  return { requested: true, stalled }
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

async function markRunFailed(db: AdminClient, rowId: string, message: string): Promise<string> {
  const { error } = await db
    .from('stripe_fee_report_runs')
    .update({ status: 'failed', error: message, processed_at: new Date().toISOString() })
    .eq('id', rowId)

  if (error) throw new Error(`Could not mark fee report run failed: ${error.message}`)
  console.error(`[Fees] Fee report run ${rowId} failed: ${message}`)
  return message
}

// ── Fordeling per ordre ──────────────────────────────────────

export type FeeAttributionOutcome = {
  /** Ordrer som fikk nye gebyrverdier. */
  reconciled: number
  /** Ordrer med gebyrlinjer som ikke kunne avstemmes mot hovedboken, og står `pending`. */
  held: number
  /** Av dem: linjene har ligget i over `STUCK_FEE_HOLD_MS`. Løser seg ikke av seg selv. */
  stuck: number
  holdReasons: Partial<Record<FeeHoldReason | 'currency_mismatch' | 'multiple_orders', number>>
  /** Betalinger med gebyrlinjer uten noen ordre (f.eks. andre betalinger på kontoen). */
  unmatchedCharges: number
}

function emptyAttributionOutcome(): FeeAttributionOutcome {
  return { reconciled: 0, held: 0, stuck: 0, holdReasons: {}, unmatchedCharges: 0 }
}

function mergeAttributionOutcome(target: FeeAttributionOutcome, source: FeeAttributionOutcome) {
  target.reconciled += source.reconciled
  target.held += source.held
  target.stuck += source.stuck
  target.unmatchedCharges += source.unmatchedCharges
  for (const [reason, count] of Object.entries(source.holdReasons) as Array<[keyof FeeAttributionOutcome['holdReasons'], number]>) {
    target.holdReasons[reason] = (target.holdReasons[reason] ?? 0) + count
  }
}

type AttributionContext = {
  db: AdminClient
  livemode: boolean
  /** Unix-sekunder: hovedboken i modusen er komplett til hit. Null = ingenting speilet. */
  ledgerCompleteThrough: number | null
  /** Linjesummer per balansetransaksjon; null = ingen lagrede linjer. Gjelder én kjøring. */
  groups: Map<string, FeeLineGroup | null>
}

async function createAttributionContext(
  db: AdminClient,
  livemode: boolean,
  ledgerCompleteThrough?: number | null,
): Promise<AttributionContext> {
  const completeThrough =
    ledgerCompleteThrough !== undefined
      ? ledgerCompleteThrough
      : await latestMirroredTransaction(db, livemode).then((latest) =>
          latest === null ? null : latest - BALANCE_SYNC_OVERLAP_SECONDS,
        )

  return { db, livemode, ledgerCompleteThrough: completeThrough, groups: new Map() }
}

type ChargeFeeLineRow = {
  incurred_by: string | null
  incurred_by_type: string | null
  balance_transaction_id: string | null
  amount: number
  tax_amount: number
  currency: string
  order_id: string | null
  created_at: string
}

async function loadChargeFeeLines(ctx: AttributionContext, chargeIds: string[]): Promise<ChargeFeeLineRow[]> {
  const lines: ChargeFeeLineRow[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await ctx.db
      .from('stripe_fee_entries')
      .select('incurred_by, incurred_by_type, balance_transaction_id, amount, tax_amount, currency, order_id, created_at')
      .eq('livemode', ctx.livemode)
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

const LEDGER_FEE_COLUMNS = 'id, reporting_category, amount, fee, currency, created_at_stripe'

/**
 * De refererte postene og alle gebyrposter rundt dem, med tidsrommene som er
 * lest komplett. Mvaposten har ingen linjer og finnes bare slik. Tidsrommene
 * slås sammen der de overlapper, slik at refererte poster langt fra hverandre
 * ikke drar med seg alt som ligger mellom.
 */
async function loadLedgerAround(
  ctx: AttributionContext,
  transactionIds: string[],
): Promise<{ ledger: LedgerFeeTransaction[]; complete: Array<{ from: number; through: number }> }> {
  const ledger = new Map<string, LedgerFeeTransaction>()

  for (const ids of chunk(transactionIds, FILTER_CHUNK_SIZE)) {
    const { data, error } = await ctx.db
      .from('platform_balance_transactions')
      .select(LEDGER_FEE_COLUMNS)
      .eq('livemode', ctx.livemode)
      .in('id', ids)

    if (error) throw new Error(`Could not read fee balance transactions: ${error.message}`)
    for (const row of data ?? []) ledger.set(row.id, row)
  }

  const ranges: Array<{ from: number; to: number }> = []
  for (const time of [...ledger.values()].map((transaction) => isoToUnix(transaction.created_at_stripe)).sort((a, b) => a - b)) {
    const last = ranges.at(-1)
    if (last && time - FEE_NEIGHBOURHOOD_SECONDS <= last.to) last.to = time + FEE_NEIGHBOURHOOD_SECONDS
    else ranges.push({ from: time - FEE_NEIGHBOURHOOD_SECONDS, to: time + FEE_NEIGHBOURHOOD_SECONDS })
  }

  for (const range of ranges) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await ctx.db
        .from('platform_balance_transactions')
        .select(LEDGER_FEE_COLUMNS)
        .eq('livemode', ctx.livemode)
        .eq('reporting_category', 'fee')
        .gte('created_at_stripe', unixToIso(range.from))
        .lte('created_at_stripe', unixToIso(range.to))
        .order('created_at_stripe', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)

      if (error) throw new Error(`Could not read fee balance transactions: ${error.message}`)
      for (const row of data ?? []) ledger.set(row.id, row)
      if (!data || data.length < PAGE_SIZE) break
    }
  }

  const syncedThrough = ctx.ledgerCompleteThrough ?? Number.NEGATIVE_INFINITY
  return {
    ledger: [...ledger.values()],
    complete: ranges.map((range) => ({ from: range.from, through: Math.min(range.to, syncedThrough) })),
  }
}

/** Linjesummer for postene, fra alle lagrede linjer i modusen — også andre betalingers. */
async function loadFeeLineGroups(ctx: AttributionContext, transactionIds: string[]): Promise<Map<string, FeeLineGroup>> {
  const unknown = transactionIds.filter((id) => !ctx.groups.has(id))

  for (const ids of chunk(unknown, FILTER_CHUNK_SIZE)) {
    const sums = new Map<string, FeeLineGroup>()

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await ctx.db
        .from('stripe_fee_entries')
        .select('balance_transaction_id, amount, tax_amount')
        .eq('livemode', ctx.livemode)
        .in('balance_transaction_id', ids)
        .order('row_key', { ascending: true })
        .range(from, from + PAGE_SIZE - 1)

      if (error) throw new Error(`Could not read fee entries by balance transaction: ${error.message}`)

      for (const row of data ?? []) {
        if (!row.balance_transaction_id) continue
        const sum = sums.get(row.balance_transaction_id) ?? { amount: 0, tax: 0, lines: 0 }
        sum.amount += row.amount
        sum.tax += row.tax_amount
        sum.lines += 1
        sums.set(row.balance_transaction_id, sum)
      }

      if (!data || data.length < PAGE_SIZE) break
    }

    for (const id of ids) ctx.groups.set(id, sums.get(id) ?? null)
  }

  const groups = new Map<string, FeeLineGroup>()
  for (const id of transactionIds) {
    const group = ctx.groups.get(id)
    if (group) groups.set(id, group)
  }
  return groups
}

async function resolveFeeTaxTreatments(ctx: AttributionContext, transactionIds: string[]) {
  if (transactionIds.length === 0) return new Map<string, FeeTaxTreatment>()

  const { ledger, complete } = await loadLedgerAround(ctx, transactionIds)
  const candidates = [...new Set([...transactionIds, ...ledger.map((transaction) => transaction.id)])]
  const groups = await loadFeeLineGroups(ctx, candidates)

  return detectFeeTaxTreatments({ groups, ledger, complete })
}

/**
 * Fører gebyret over på ordrene. Summen tas av alle lagrede linjer for
 * betalingen, ikke bare de i denne rapporten — et gebyr kan justeres i en
 * senere periode, og overlappende kjøringer skal gi samme tall.
 *
 * Linjer som ikke kan avstemmes mot hovedboken, føres ikke: ordren står
 * `pending` (en tidligere avstemt ordre settes tilbake), og neste kjøring
 * prøver igjen. Et halvt riktig gebyr er verre enn et som mangler.
 */
async function attributeFeesToOrders(
  ctx: AttributionContext,
  chargeIds: string[],
  outcome: FeeAttributionOutcome,
): Promise<void> {
  const hold = (reason: keyof FeeAttributionOutcome['holdReasons'], lines: ChargeFeeLineRow[]) => {
    outcome.held += 1
    outcome.holdReasons[reason] = (outcome.holdReasons[reason] ?? 0) + 1
    const newestLine = Math.max(...lines.map((line) => Date.parse(line.created_at)))
    if (Date.now() - newestLine > STUCK_FEE_HOLD_MS) outcome.stuck += 1
  }

  for (const ids of chunk([...new Set(chargeIds)], FILTER_CHUNK_SIZE)) {
    const allLines = await loadChargeFeeLines(ctx, ids)
    if (allLines.length === 0) continue

    const chargesWithLines = [...new Set(allLines.flatMap((line) => (line.incurred_by ? [line.incurred_by] : [])))]

    const { data: orders, error: ordersError } = await ctx.db
      .from('orders')
      .select('id, stripe_charge_id, currency, stripe_fee_amount, stripe_fee_tax_amount, stripe_fee_status')
      .in('stripe_charge_id', chargesWithLines)

    if (ordersError) throw new Error(`Could not read orders for fee attribution: ${ordersError.message}`)

    const ordersByCharge = new Map<string, NonNullable<typeof orders>>()
    for (const order of orders ?? []) {
      if (!order.stripe_charge_id) continue
      ordersByCharge.set(order.stripe_charge_id, [...(ordersByCharge.get(order.stripe_charge_id) ?? []), order])
    }

    const unmatched = chargesWithLines.filter((chargeId) => !ordersByCharge.has(chargeId))
    if (unmatched.length > 0) {
      outcome.unmatchedCharges += unmatched.length
      console.warn(
        `[Fees] Fee lines for ${unmatched.length} charge(s) match no order, e.g. ${unmatched.slice(0, 3).join(', ')}`,
      )
    }
    if (ordersByCharge.size === 0) continue

    const lines = allLines.filter((line) => line.incurred_by && ordersByCharge.has(line.incurred_by))
    const transactionIds = [
      ...new Set(lines.flatMap((line) => (line.balance_transaction_id ? [line.balance_transaction_id] : []))),
    ]
    const treatments = await resolveFeeTaxTreatments(ctx, transactionIds)
    const totals = sumFeesByCharge(lines, treatments)
    const reconciledAt = new Date().toISOString()

    for (const [chargeId, matches] of ordersByCharge) {
      const total = totals.get(chargeId)
      if (!total) continue

      const chargeLines = lines.filter((line) => line.incurred_by === chargeId)

      // Samme gebyr på to ordrer ville dobbeltført kostnaden.
      if (matches.length > 1) {
        console.warn(`[Fees] Charge ${chargeId} matches ${matches.length} orders — fee not attributed.`)
        hold('multiple_orders', chargeLines)
        continue
      }

      const order = matches[0]

      if (total.hold) {
        hold(total.hold, chargeLines)

        if (order.stripe_fee_status === 'reconciled') {
          const { error } = await ctx.db.from('orders').update({ stripe_fee_status: 'pending' }).eq('id', order.id)
          if (error) throw new Error(`Could not reopen the Stripe fee on order ${order.id}: ${error.message}`)
        }
        continue
      }

      if (total.currency === null || total.currency !== order.currency.toUpperCase()) {
        console.warn(
          `[Fees] Fee currency ${total.currency ?? 'mixed'} does not match order ${order.id} (${order.currency}) — ` +
            'fee not attributed.',
        )
        hold('currency_mismatch', chargeLines)
        continue
      }

      const unchanged =
        order.stripe_fee_status === 'reconciled' &&
        order.stripe_fee_amount === total.amount &&
        order.stripe_fee_tax_amount === total.tax

      if (!unchanged) {
        const { error } = await ctx.db
          .from('orders')
          .update({
            stripe_fee_amount: total.amount,
            stripe_fee_tax_amount: total.tax,
            stripe_fee_status: 'reconciled',
            stripe_fee_reconciled_at: reconciledAt,
          })
          .eq('id', order.id)

        if (error) throw new Error(`Could not book the Stripe fee on order ${order.id}: ${error.message}`)
        outcome.reconciled += 1
      }

      if (chargeLines.some((line) => line.order_id !== order.id)) {
        const { error } = await ctx.db
          .from('stripe_fee_entries')
          .update({ order_id: order.id })
          .eq('livemode', ctx.livemode)
          .eq('incurred_by_type', 'charge')
          .eq('incurred_by', chargeId)

        if (error) throw new Error(`Could not link fee entries to order ${order.id}: ${error.message}`)
      }
    }
  }
}

/**
 * Sjekker alle ordrer som fortsatt venter på gebyret mot lagrede linjer — ikke
 * bare betalingene i dagens rapport. En ordre kan ha fått charge-ID-en etter
 * at rapporten ble behandlet (se `repairMissingChargeFacts`), eller blitt holdt
 * igjen fordi hovedboken ikke var speilet ennå.
 */
async function reattributePendingFees(options: {
  deadline?: number
  ledgerCompleteThrough?: number | null
}): Promise<FeeAttributionOutcome & { checked: number; deferred: number }> {
  const db = createAdminClient()
  const livemode = isStripeLiveMode()
  const outcome = emptyAttributionOutcome()

  // Uten lagrede linjer i modusen (testmodus har ingen rapport) er det
  // ingenting å sjekke mot.
  const { data: anyEntry, error: entryError } = await db
    .from('stripe_fee_entries')
    .select('id')
    .eq('livemode', livemode)
    .limit(1)

  if (entryError) throw new Error(`Could not read fee entries: ${entryError.message}`)
  if (!anyEntry || anyEntry.length === 0) return { ...outcome, checked: 0, deferred: 0 }

  // Alle ID-ene først: ordrer som avstemmes faller ut av filteret, og
  // sidevis lesing samtidig ville hoppet over rader.
  const chargeIds: string[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('orders')
      .select('id, stripe_charge_id')
      .eq('stripe_fee_status', 'pending')
      .not('stripe_charge_id', 'is', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(`Could not read orders awaiting fees: ${error.message}`)
    for (const row of data ?? []) if (row.stripe_charge_id) chargeIds.push(row.stripe_charge_id)
    if (!data || data.length < PAGE_SIZE) break
  }

  const unique = [...new Set(chargeIds)]
  const ctx = await createAttributionContext(db, livemode, options.ledgerCompleteThrough)
  let checked = 0

  for (const ids of chunk(unique, FILTER_CHUNK_SIZE)) {
    if (options.deadline !== undefined && Date.now() > options.deadline) {
      return { ...outcome, checked, deferred: unique.length - checked }
    }
    await attributeFeesToOrders(ctx, ids, outcome)
    checked += ids.length
  }

  return { ...outcome, checked, deferred: 0 }
}

type PendingRunRow = { id: string; report_run_id: string; created_at: string }

type FeeReportRunOutcome =
  | { status: 'pending' }
  | { status: 'failed'; error: string }
  | { status: 'processed'; entries: number; attribution: FeeAttributionOutcome }

/**
 * Behandler én ventende kjøring. Kaster ved forbigående feil, slik at raden
 * står `pending` og prøves igjen ved neste kjøring.
 */
async function processFeeReportRun(db: AdminClient, livemode: boolean, row: PendingRunRow): Promise<FeeReportRunOutcome> {
  let run: Stripe.Reporting.ReportRun
  try {
    run = await stripe.reporting.reportRuns.retrieve(row.report_run_id)
  } catch (error) {
    if (!isNotFoundError(error)) throw error
    // Kjøringen finnes ikke for nøkkelen og kommer aldri.
    return { status: 'failed', error: await markRunFailed(db, row.id, `Stripe report run not found: ${errorMessage(error)}`) }
  }

  if (run.status === 'pending') return { status: 'pending' }
  if (run.status !== 'succeeded') {
    return {
      status: 'failed',
      error: await markRunFailed(db, row.id, run.error ?? `Stripe report run ended with status ${run.status}`),
    }
  }

  const url = run.result?.url
  if (!url) {
    return { status: 'failed', error: await markRunFailed(db, row.id, 'Stripe report run succeeded without a result file') }
  }

  let text: string
  try {
    text = await downloadReportFile(url)
  } catch (error) {
    // Nedlasting feiler som regel forbigående. Men en kjøring som aldri lar seg
    // hente, skal ikke blokkere nye rapporter for alltid.
    if (Date.now() - Date.parse(row.created_at) < STALE_REPORT_RUN_MS) throw error
    return { status: 'failed', error: await markRunFailed(db, row.id, `Could not download report file: ${errorMessage(error)}`) }
  }

  let entries: FeeEntryInsert[]
  try {
    entries = buildFeeEntries(parseFeesReport(text), run.id, livemode)
  } catch (error) {
    // Samme fil gir samme feil neste gang. Kjøringen merkes feilet og meldes
    // i cron-svaret; neste forespørsel for intervallet får ny idempotency key,
    // så en rettet parser eller en ny fil fra Stripe plukkes opp.
    return { status: 'failed', error: await markRunFailed(db, row.id, `Could not parse fees report: ${errorMessage(error)}`) }
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

  const attribution = emptyAttributionOutcome()
  await attributeFeesToOrders(await createAttributionContext(db, livemode), chargeIds, attribution)

  const { error: updateError } = await db
    .from('stripe_fee_report_runs')
    .update({ status: 'processed', row_count: entries.length, processed_at: new Date().toISOString(), error: null })
    .eq('id', row.id)

  if (updateError) throw new Error(`Could not mark fee report run processed: ${updateError.message}`)

  console.log(
    `[Fees] Report run ${run.id}: ${entries.length} fee lines, ${chargeIds.length} charges, ` +
      `${attribution.reconciled} orders reconciled, ${attribution.held} held, ${unattributed} lines not tied to a charge ` +
      '(refunds, disputes, payouts, account fees)',
  )

  return { status: 'processed', entries: entries.length, attribution }
}

export type FeeReportProcessing = {
  processed: number
  entries: number
  ordersReconciled: number
  ordersHeld: number
  /** Kjøringer som feilet i denne omgangen — merket feilet, eller kastet og prøves igjen. */
  failed: number
  /** Kjøringer som ikke ble startet fordi tidsfristen var passert. */
  deferred: number
  errors: string[]
  attribution: FeeAttributionOutcome
}

/**
 * Henter ferdige rapportkjøringer, lagrer gebyrlinjene og fører dem på
 * ordrene. Feil i én kjøring stopper ikke de andre, men telles og meldes.
 */
export async function processFeeReportRuns(options: { deadline?: number } = {}): Promise<FeeReportProcessing> {
  const db = createAdminClient()
  const livemode = isStripeLiveMode()

  const { data: runs, error } = await db
    .from('stripe_fee_report_runs')
    .select('id, report_run_id, created_at')
    .eq('livemode', livemode)
    .eq('status', 'pending')
    .order('interval_start', { ascending: true })

  if (error) throw new Error(`Could not read pending fee report runs: ${error.message}`)

  const result: FeeReportProcessing = {
    processed: 0,
    entries: 0,
    ordersReconciled: 0,
    ordersHeld: 0,
    failed: 0,
    deferred: 0,
    errors: [],
    attribution: emptyAttributionOutcome(),
  }

  const pendingRuns = runs ?? []
  for (const [index, row] of pendingRuns.entries()) {
    if (options.deadline !== undefined && Date.now() > options.deadline) {
      result.deferred = pendingRuns.length - index
      break
    }

    try {
      const outcome = await processFeeReportRun(db, livemode, row)
      if (outcome.status === 'pending') continue

      if (outcome.status === 'failed') {
        result.failed += 1
        result.errors.push(`fee report run ${row.report_run_id} failed: ${outcome.error}`)
        continue
      }

      result.processed += 1
      result.entries += outcome.entries
      result.ordersReconciled += outcome.attribution.reconciled
      result.ordersHeld += outcome.attribution.held
      mergeAttributionOutcome(result.attribution, outcome.attribution)
    } catch (runError) {
      console.error(`[Fees] Could not process fee report run ${row.report_run_id}: ${errorMessage(runError)}`)
      result.failed += 1
      result.errors.push(`fee report run ${row.report_run_id} could not be processed: ${errorMessage(runError)}`)
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────
// 3. Hele avstemmingen
// ─────────────────────────────────────────────────────────────

export type StripeFeeReconciliation = {
  balanceTransactions: number
  balanceSyncComplete: boolean
  balanceSyncedThrough: string | null
  chargeFactsRepaired: number
  reportsProcessed: number
  reportsFailed: number
  ordersReconciled: number
  ordersHeld: number
  reportRequested: boolean
  /** Noe stopper gebyrbokføringen og må følges opp. Cron-ruten svarer da 500. */
  failed: boolean
  note?: string
}

function describeHolds(outcome: FeeAttributionOutcome): string {
  return Object.entries(outcome.holdReasons)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(', ')
}

/**
 * Rekkefølgen er valgt for at ingenting skal sulte ut noe annet:
 *
 *  1. Manglende charge-ID-er fylles inn, slik at gebyrlinjene har noe å treffe.
 *  2. Ferdige rapporter behandles, og 3. neste bestilles. Begge er raske og
 *     kommer før hovedboken — en treg synkronisering skal ikke stoppe dem.
 *  4. Hovedboken synkroniseres innenfor sitt eget tidsbudsjett.
 *  5. Alle ordrer som fortsatt venter, sjekkes mot lagrede linjer og den
 *     ferske hovedboken.
 *
 * En rapport bestilt i dag behandles i morgen, når Stripe har kjørt den. Hvert
 * steg feiler for seg. Feil som stopper bokføringen (feilede kjøringer, en
 * intervallkjede som står fast, ordrer som ikke lar seg avstemme over tid)
 * gir `failed`; resten er informasjon i `note`.
 */
export async function reconcileStripeFees(): Promise<StripeFeeReconciliation> {
  const startedAt = Date.now()
  const deadline = startedAt + RECONCILE_BUDGET_MS

  const summary: Omit<StripeFeeReconciliation, 'failed' | 'note'> = {
    balanceTransactions: 0,
    balanceSyncComplete: false,
    balanceSyncedThrough: null,
    chargeFactsRepaired: 0,
    reportsProcessed: 0,
    reportsFailed: 0,
    ordersReconciled: 0,
    ordersHeld: 0,
    reportRequested: false,
  }
  const failures: string[] = []
  const notes: string[] = []

  try {
    const repair = await repairMissingChargeFacts({ deadline: Math.min(startedAt + CHARGE_REPAIR_BUDGET_MS, deadline) })
    summary.chargeFactsRepaired = repair.repaired
    if (repair.failed > 0) notes.push(`charge details could not be filled in for ${repair.failed} orders`)
  } catch (error) {
    console.error(`[Fees] Charge repair failed: ${errorMessage(error)}`)
    failures.push(`charge repair failed: ${errorMessage(error)}`)
  }

  let holds: FeeAttributionOutcome | null = null
  let unmatchedCharges = 0

  try {
    const processed = await processFeeReportRuns({ deadline })
    summary.reportsProcessed = processed.processed
    summary.reportsFailed = processed.failed
    summary.ordersReconciled += processed.ordersReconciled
    failures.push(...processed.errors)
    if (processed.deferred > 0) notes.push(`${processed.deferred} fee report runs deferred to the next run`)
    holds = processed.attribution
    unmatchedCharges = processed.attribution.unmatchedCharges
  } catch (error) {
    console.error(`[Fees] Fee report processing failed: ${errorMessage(error)}`)
    failures.push(`fee report processing failed: ${errorMessage(error)}`)
  }

  try {
    const request = await requestFeeReportRun()
    summary.reportRequested = request.requested
    if (request.stalled) {
      failures.push(
        `fee reports stalled at ${request.stalled.intervalStart} after ${request.stalled.failedRuns} failed run(s)` +
          (request.stalled.lastError ? `: ${request.stalled.lastError}` : ''),
      )
    }
    if (!request.requested && request.reason) {
      console.log(`[Fees] No fee report requested: ${request.reason}`)
      if (request.reason === FEE_REPORT_UNAVAILABLE_REASON) notes.push(request.reason)
    }
  } catch (error) {
    console.error(`[Fees] Fee report request failed: ${errorMessage(error)}`)
    failures.push(`fee report request failed: ${errorMessage(error)}`)
  }

  let ledgerCompleteThrough: number | undefined
  try {
    const sync = await syncPlatformBalanceTransactions({
      deadline: Math.min(Date.now() + BALANCE_SYNC_BUDGET_MS, deadline - REATTRIBUTION_RESERVE_MS),
    })
    summary.balanceTransactions = sync.synced
    summary.balanceSyncComplete = sync.complete
    summary.balanceSyncedThrough = sync.syncedThrough
    if (sync.complete && sync.syncedThrough) {
      ledgerCompleteThrough = isoToUnix(sync.syncedThrough) - BALANCE_SYNC_OVERLAP_SECONDS
    } else {
      notes.push(`balance transaction sync reached ${sync.syncedThrough ?? 'nothing'} (time budget); continues next run`)
    }
  } catch (error) {
    console.error(`[Fees] Platform balance transaction sync failed: ${errorMessage(error)}`)
    failures.push(`balance transaction sync failed: ${errorMessage(error)}`)
  }

  try {
    const recheck = await reattributePendingFees({ deadline, ledgerCompleteThrough })
    summary.ordersReconciled += recheck.reconciled
    if (recheck.deferred > 0) notes.push(`${recheck.deferred} pending charges not re-checked (time budget)`)
    // Sjekken går gjennom alle ventende ordrer, også dem rapportbehandlingen holdt igjen.
    if (recheck.checked > 0 || recheck.deferred === 0) holds = recheck
  } catch (error) {
    console.error(`[Fees] Pending fee re-check failed: ${errorMessage(error)}`)
    failures.push(`pending fee re-check failed: ${errorMessage(error)}`)
  }

  if (holds) {
    summary.ordersHeld = holds.held
    if (holds.stuck > 0) {
      failures.push(
        `${holds.stuck} of ${holds.held} held orders' Stripe fees could not be booked for over 3 days (${describeHolds(holds)})`,
      )
    } else if (holds.held > 0) {
      notes.push(`${holds.held} orders' Stripe fees are held until they match the platform ledger (${describeHolds(holds)})`)
    }
  }
  if (unmatchedCharges > 0) notes.push(`fee lines for ${unmatchedCharges} charges match no order`)

  const messages = [...failures, ...notes]
  return {
    ...summary,
    failed: failures.length > 0,
    ...(messages.length > 0 ? { note: messages.join('; ') } : {}),
  }
}
