import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { ensureClubPayoutScheduleKnown } from '@/lib/stripe-connect'
import { createAdminClient } from '@/lib/supabase/admin'
import { osloDate } from '@/lib/ticket-sales'
import type { ClubPayout, ClubPayoutStatus } from '@/types/database'

/**
 * Utbetaling til klubbens bankkonto.
 *
 * Klubbenes Connect-kontoer står på manuell utbetaling. Pengene blir stående
 * på klubbens konto til showet er avholdt, slik at en avlysning ikke
 * etterlater en tom konto med refusjonskrav — plattformen hefter overfor
 * Stripe for negativ saldo (`losses_collector = application`).
 *
 * Beløpet som frigjøres regnes fra hovedboken (`club_releasable_amount`), ikke
 * fra Stripe-saldoen alene: saldoen blander show som er avholdt med show som
 * ennå ikke er spilt.
 *
 * Statusen er Stripes, ikke vår. At Stripe godtar forespørselen betyr bare at
 * utbetalingen er `pending` — den kan fortsatt feile i banken, også etter at
 * den er meldt `paid`. Radene følger `payout.*`-webhooks, og `syncOpenPayouts`
 * i cron fanger opp webhooks som aldri kom fram.
 *
 * Dobbel utbetaling er umulig fordi fire ting virker sammen:
 *  1. `reserve_club_payout` tar en advisory-lås per klubb, regner beløpet og
 *     skriver raden i én transaksjon. To samtidige kjøringer kan ikke
 *     reservere de samme pengene.
 *  2. Det finnes maks én `creating`-rad per klubb (unik delindeks). En kjøring
 *     som krasjer etter reservasjonen får samme rad tilbake neste gang
 *     (`resumed`), ikke en ny rad med et nytt beløp.
 *  3. Idempotency key er utledet av rad-ID-en. Et nytt forsøk på samme rad gir
 *     Stripe samme nøkkel, og Stripe svarer med utbetalingen som allerede
 *     finnes i stedet for å lage en til.
 *  4. Stripe glemmer nøkler etter 24 timer. Før en gjenopptatt rad sendes på
 *     nytt, letes det derfor etter en utbetaling med `metadata.payout_row` lik
 *     rad-ID-en. Finnes den, brukes den, og ingen ny forespørsel sendes.
 *
 * En reservasjon frigjøres (merkes `failed`) bare når Stripe har avvist
 * forespørselen endelig. Ved nettverksfeil, 5xx, rate limit eller en nøkkel
 * som er i bruk vet vi ikke om utbetalingen ble laget, og raden blir stående
 * som `creating` til neste kjøring.
 */

// ─────────────────────────────────────────────────────────────
// Konstanter og typer
// ─────────────────────────────────────────────────────────────

/** Så lenge vi lar være å prøve igjen etter at en utbetaling har feilet. */
export const PAYOUT_FAILURE_HOLD_DAYS = 3

/** En `paid` utbetaling kan snu til `failed` hos Stripe. Så lenge følges den opp. */
const PAID_RECHECK_DAYS = 14

/** Slingringsmonn mellom databaseklokka og Stripes `created` ved oppslag. */
const RESUME_LOOKBACK_SECONDS = 300

/** `reserve_club_payout` tar `integer`. */
const MAX_PG_INTEGER = 2_147_483_647

/** Rader per status-gruppe i én synk. Resten tas neste kjøring, eldst først. */
const SYNC_BATCH_SIZE = 50

/** Samtidige kall mot Stripe i synken — cron-jobben har 60 sekunder totalt. */
const SYNC_CONCURRENCY = 5

/** Samtidige databaseoppslag når rekkefølgen for frigjøringen settes. */
const ATTEMPT_LOOKUP_CONCURRENCY = 10

const DEFERRED_REASON = 'deferred to the next run — this run used up its time budget before reaching the club'

const DAY_MS = 24 * 60 * 60 * 1000

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PAYOUT_STATUSES: ClubPayoutStatus[] = ['creating', 'pending', 'in_transit', 'paid', 'failed', 'cancelled']

/**
 * Rekkefølgen en utbetaling kan bevege seg i. `failed` og `cancelled` er
 * sluttilstander; `paid` kan fortsatt bli `failed`.
 */
const PAYOUT_STATUS_RANK: Record<ClubPayoutStatus, number> = {
  creating: 0,
  pending: 1,
  in_transit: 2,
  paid: 3,
  failed: 4,
  cancelled: 4,
}

const PAYOUT_ROW_FIELDS =
  'id, club_id, amount, currency, status, stripe_payout_id, stripe_account_id, paid_at, failed_at, cancelled_at, status_synced_at, created_at'

type PayoutRow = Pick<
  ClubPayout,
  | 'id'
  | 'club_id'
  | 'amount'
  | 'currency'
  | 'status'
  | 'stripe_payout_id'
  | 'stripe_account_id'
  | 'paid_at'
  | 'failed_at'
  | 'cancelled_at'
  | 'status_synced_at'
  | 'created_at'
>

export type PayoutClub = {
  id: string
  name: string
  currency: string
  stripe_account_id: string
  payout_schedule_interval: string | null
}

/** Klubben med tidspunktet for utbetalingsjobbens siste reservasjon, om den finnes. */
export type ReleaseCandidate = { id: string; lastAttemptAt: string | null }

export type PayoutOutcome = {
  clubId: string
  clubName: string
  /** Beløpet Stripe bekreftet i denne kjøringen, i minste valutaenhet. */
  released: number
  skipped?: string
  /** Raden i `club_payouts` kjøringen jobbet med. */
  payoutRowId?: string
  status?: ClubPayoutStatus
}

/** Feltene fra Stripe-utbetalingen som speiles i `club_payouts`. */
export type StripePayoutFacts = Pick<
  Stripe.Payout,
  'id' | 'status' | 'arrival_date' | 'failure_code' | 'failure_message'
>

export type PayoutRowPatch = Pick<
  ClubPayout,
  'status' | 'stripe_payout_id' | 'arrival_date' | 'failure_code' | 'failure_reason' | 'status_synced_at'
> &
  Partial<Pick<ClubPayout, 'paid_at' | 'failed_at' | 'cancelled_at'>>

export type LatestPayout = Pick<
  ClubPayout,
  'status' | 'stripe_payout_id' | 'failure_code' | 'failure_reason' | 'failed_at' | 'updated_at'
>

// ─────────────────────────────────────────────────────────────
// Rene hjelpere
// ─────────────────────────────────────────────────────────────

/** Stripes payout-status oversatt til vår. Stripe staver `canceled`. */
export function mapStripePayoutStatus(
  status: string | null | undefined,
): Exclude<ClubPayoutStatus, 'creating'> {
  switch (status) {
    case 'pending':
    case 'in_transit':
    case 'paid':
    case 'failed':
      return status
    case 'canceled':
      return 'cancelled'
    default:
      // En status Stripe innfører senere er i hvert fall ikke bekreftet betalt.
      // `pending` holder raden i oppfølgingen til den får en status vi kjenner.
      return 'pending'
  }
}

/**
 * Om en rad kan gå fra `from` til `to`. Webhooks kommer i vilkårlig rekkefølge,
 * og to synker kan krysse hverandre — en eldre status skal aldri skrive over
 * en nyere.
 */
export function canAdvancePayoutStatus(from: ClubPayoutStatus, to: ClubPayoutStatus): boolean {
  return PAYOUT_STATUS_RANK[to] >= PAYOUT_STATUS_RANK[from]
}

/** Deterministisk per rad: samme reservasjon gir alltid samme nøkkel hos Stripe. */
export function payoutIdempotencyKey(rowId: string): string {
  return `club-payout-${rowId}`
}

const DEFINITIVE_ERROR_TYPES = new Set([
  'StripeInvalidRequestError',
  'StripePermissionError',
  'StripeAuthenticationError',
])

/** Koder som kan komme på en ellers endelig feiltype, men som betyr «prøv igjen». */
const RETRYABLE_ERROR_CODES = new Set(['idempotency_key_in_use', 'rate_limit', 'lock_timeout'])

/**
 * Om Stripe endelig har avvist forespørselen, slik at vi vet at ingen
 * utbetaling ble laget og reservasjonen kan frigjøres.
 *
 * Alt annet — nettverksfeil, 5xx, rate limit, en nøkkel som er i bruk av en
 * samtidig forespørsel, eller en idempotency-feil — betyr at vi ikke vet. Da
 * er det tryggere å la raden stå som `creating` enn å frigjøre beløpet og
 * risikere en utbetaling til. Duck-typet på `type`, slik Stripe-SDK-et setter
 * den, så funksjonen kan testes uten SDK-klassene.
 */
export function isDefinitivePayoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const { type, code, statusCode } = error as { type?: unknown; code?: unknown; statusCode?: unknown }
  if (typeof type !== 'string' || !DEFINITIVE_ERROR_TYPES.has(type)) return false
  if (typeof code === 'string' && RETRYABLE_ERROR_CODES.has(code)) return false
  if (statusCode === 409 || statusCode === 429) return false

  return true
}

/** Unix-sekunder til `YYYY-MM-DD`. Stripe setter `arrival_date` til midnatt UTC. */
function unixToIsoDate(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/**
 * Databaseoppdateringen for en Stripe-utbetaling.
 *
 * Tidsstemplene sier når vi først så statusen. En webhook som kommer på nytt,
 * eller synken dagen etter, skal ikke flytte dem — derfor tas eksisterende
 * verdi vare på. `paid_at` fjernes ikke når en betalt utbetaling feiler: den
 * forteller at Stripe en gang meldte den betalt.
 */
export function payoutRowPatch(
  payout: StripePayoutFacts,
  now: Date,
  existing?: Pick<ClubPayout, 'paid_at' | 'failed_at' | 'cancelled_at'> | null,
): PayoutRowPatch {
  const status = mapStripePayoutStatus(payout.status)
  const at = now.toISOString()

  const patch: PayoutRowPatch = {
    status,
    stripe_payout_id: payout.id,
    arrival_date: unixToIsoDate(payout.arrival_date),
    failure_code: payout.failure_code ?? null,
    failure_reason: payout.failure_message ?? null,
    status_synced_at: at,
  }

  if (status === 'paid') patch.paid_at = existing?.paid_at ?? at
  if (status === 'failed') patch.failed_at = existing?.failed_at ?? at
  if (status === 'cancelled') patch.cancelled_at = existing?.cancelled_at ?? at

  return patch
}

/**
 * Det som faktisk kan utbetales i én valuta. Stripe holder hver valuta for seg,
 * og hovedboken regner i klubbens valuta — å summere på tvers ville gitt et
 * beløp som ikke finnes. Uten `source_type` trekker Stripe manuelle
 * utbetalinger fra `card`-saldoen, som dekker kort og de fleste andre
 * betalingsmåter.
 */
export function availablePayoutBalance(balance: Pick<Stripe.Balance, 'available'>, currency: string): number {
  const entry = balance.available.find((item) => item.currency.toLowerCase() === currency.toLowerCase())
  if (!entry) return 0

  const amount = entry.source_types ? (entry.source_types.card ?? 0) : entry.amount
  return Math.max(0, Math.min(amount, entry.amount))
}

/**
 * Hvorfor klubben hoppes over på grunn av utbetalingsplanen. Står kontoen ikke
 * på `manual`, betaler Stripe ut selv — en manuell utbetaling i tillegg ville
 * enten blitt avvist eller betalt ut de samme pengene to ganger.
 */
export function payoutScheduleSkipReason(interval: string | null | undefined): string | null {
  if (interval === 'manual') return null
  if (!interval) return 'payout schedule not confirmed as manual yet — refresh the Stripe status for the club'
  return `payout schedule is "${interval}" — Stripe pays this club out automatically`
}

/**
 * Hvorfor klubben hoppes over etter en feilet utbetaling. Feil skyldes som
 * regel bankopplysningene, og Stripe deaktiverer bankkontoen når en utbetaling
 * feiler. Å prøve igjen hver natt gir bare flere feilede rader til klubben har
 * rettet kontoen.
 */
export function payoutFailureHoldReason(latest: LatestPayout | null | undefined, now: Date): string | null {
  if (!latest || latest.status !== 'failed') return null

  const failedAt = Date.parse(latest.failed_at ?? latest.updated_at)
  if (!Number.isFinite(failedAt)) return null

  const until = failedAt + PAYOUT_FAILURE_HOLD_DAYS * DAY_MS
  if (now.getTime() >= until) return null

  const cause = latest.failure_reason ?? latest.failure_code ?? 'no reason given'
  const retryDate = new Date(until).toISOString().slice(0, 10)

  return latest.stripe_payout_id
    ? `last payout failed at the bank (${cause}) — Stripe disables the bank account after a failed payout, ` +
        `so the club must check its bank details in Stripe; retrying after ${retryDate}`
    : `Stripe rejected the last payout request (${cause}); retrying after ${retryDate}`
}

/**
 * Om fristen for å starte nytt arbeid er passert. `deadline` er epoch-ms; uten
 * frist er den aldri passert. Arbeid som er i gang fullføres — fristen settes
 * derfor med margin til funksjonens tidsgrense.
 */
export function isPastDeadline(deadline: number | undefined, now: number = Date.now()): boolean {
  return typeof deadline === 'number' && now > deadline
}

/**
 * Rekkefølgen klubbene vurderes i. Kjøringen har et tidsbudsjett, så det er
 * klubbene sist i lista som ikke rekkes når det er mye å gjøre. Uten en bevisst
 * rekkefølge ville det vært de samme klubbene dag etter dag.
 *
 * Eldst siste forsøk går først, og klubber som aldri er forsøkt aller først.
 * En klubb som fikk utbetaling i dag havner bakerst neste gang; en klubb som
 * ikke ble nådd beholder sin gamle tid og kommer foran. Likt — typisk flere
 * klubber som aldri er forsøkt — avgjøres av en nøkkel som skifter med `seed`
 * (datoen), så ikke de samme alltid står sist blant dem heller.
 */
export function orderClubsForRelease<T extends ReleaseCandidate>(clubs: readonly T[], seed: string): T[] {
  return clubs
    .map((club) => ({ club, attemptedAt: attemptTime(club.lastAttemptAt), tieBreak: rotationKey(seed, club.id) }))
    .sort((a, b) => {
      if (a.attemptedAt !== b.attemptedAt) return a.attemptedAt < b.attemptedAt ? -1 : 1
      if (a.tieBreak !== b.tieBreak) return a.tieBreak - b.tieBreak
      return a.club.id < b.club.id ? -1 : a.club.id > b.club.id ? 1 : 0
    })
    .map(({ club }) => club)
}

/** Aldri forsøkt, eller et tidspunkt som ikke kan leses, sorteres først. */
function attemptTime(value: string | null): number {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY
}

/** FNV-1a (32 bit) av `seed:id` — stabil innenfor en dag, stokket mellom dager. */
function rotationKey(seed: string, id: string): number {
  let hash = 0x811c9dc5
  const input = `${seed}:${id}`
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stripeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const { code } = error as { code?: unknown }
  return typeof code === 'string' ? code : null
}

// ─────────────────────────────────────────────────────────────
// Hovedbok
// ─────────────────────────────────────────────────────────────

/**
 * «Klar for utbetaling» fra hovedboken. Samme funksjon som reservasjonen
 * bruker, så økonomisiden og utbetalingsjobben kan aldri være uenige.
 */
export async function getReleasableAmount(
  clubId: string,
): Promise<{ earned: number; committed: number; releasable: number; cutoffDate: string | null }> {
  const db = createAdminClient()

  const { data, error } = await db.rpc('club_releasable_amount', { p_club_id: clubId }).single()
  if (error || !data) {
    throw new Error(`Could not compute the releasable amount for club ${clubId}: ${error?.message ?? 'no row'}`)
  }

  // `bigint` kan komme som streng fra PostgREST.
  return {
    earned: Number(data.earned_amount ?? 0),
    committed: Number(data.committed_amount ?? 0),
    releasable: Number(data.releasable_amount ?? 0),
    cutoffDate: data.cutoff_date ?? null,
  }
}

// ─────────────────────────────────────────────────────────────
// Frigjøring
// ─────────────────────────────────────────────────────────────

/**
 * Frigjør det som er klart for alle klubber med utbetalinger aktivert.
 *
 * Med `deadline` (epoch-ms) startes ingen ny klubb etter fristen. Klubbene som
 * ikke ble nådd telles i `deferred` og står i `outcomes`, så loggen viser hvem
 * som venter. Å stoppe midt i er trygt: en reservasjon som ikke ble bekreftet
 * gjenopptas neste kjøring. Klubbene tas i rekkefølgen fra
 * `orderClubsForRelease`, så det ikke er de samme som venter hver gang.
 */
export async function releaseDuePayouts(options?: {
  deadline?: number
}): Promise<{ clubs: number; released: number; outcomes: PayoutOutcome[]; deferred: number }> {
  const deadline = options?.deadline
  const db = createAdminClient()

  const { data, error } = await db
    .from('clubs')
    .select('id, name, currency, stripe_account_id, payout_schedule_interval')
    .eq('payouts_enabled', true)
    .not('stripe_account_id', 'is', null)

  if (error) throw new Error(`Could not load clubs for payouts: ${error.message}`)

  const [candidates, withReservation] = await Promise.all([
    withLastAttempt((data ?? []) as PayoutClub[]),
    clubsWithUnconfirmedPayout(),
  ])
  const clubs = orderClubsForRelease(candidates, osloDate())
  const outcomes: PayoutOutcome[] = []
  let deferred = 0

  for (const [index, listed] of clubs.entries()) {
    if (isPastDeadline(deadline)) {
      deferred = clubs.length - index
      for (const club of clubs.slice(index)) {
        outcomes.push({ clubId: club.id, clubName: club.name, released: 0, skipped: DEFERRED_REASON })
      }
      console.warn(`[Payouts] Time budget used up — ${deferred} of ${clubs.length} clubs deferred to the next run`)
      break
    }

    const base = { clubId: listed.id, clubName: listed.name }

    try {
      // Klubber som var onboardet før planen ble speilet i databasen står med
      // ukjent plan (null), og ingen webhook kommer av seg selv for dem. Da
      // spør vi Stripe her i stedet for å hoppe over klubben hver natt.
      // Kaster ikke: svarer Stripe ikke, er planen fortsatt ukjent og klubben
      // hoppes over som før.
      const club = await ensureClubPayoutScheduleKnown(listed)

      const scheduleSkip = payoutScheduleSkipReason(club.payout_schedule_interval)
      if (scheduleSkip) {
        outcomes.push({ ...base, released: 0, skipped: scheduleSkip })
        continue
      }

      const failureHold = payoutFailureHoldReason(await latestPayout(club.id), new Date())
      if (failureHold) {
        outcomes.push({ ...base, released: 0, skipped: failureHold })
        continue
      }

      // Uten oversikt over reservasjonene (null) behandles alle klubber som om
      // de kan ha en, slik at ingen ubekreftet utbetaling blir liggende.
      const mayHaveReservation = withReservation === null || withReservation.has(club.id)
      outcomes.push(await releaseForClub(club, mayHaveReservation))
    } catch (error) {
      // Én klubb med problemer skal ikke stoppe utbetalingen til de andre.
      const message = errorMessage(error)
      console.error(`[Payouts] Club ${listed.id}: ${message}`)
      outcomes.push({ ...base, released: 0, skipped: message })
    }
  }

  const released = outcomes.reduce((total, outcome) => total + outcome.released, 0)
  return { clubs: clubs.length, released, outcomes, deferred }
}

/**
 * Når utbetalingsjobben sist reserverte en utbetaling for hver klubb. Brukes
 * bare til rekkefølgen — et oppslag som feiler gir «aldri forsøkt», ikke en
 * klubb som hoppes over. Utbetalinger Stripe laget selv (`origin = 'stripe'`)
 * er ikke jobbens forsøk og teller ikke.
 */
async function withLastAttempt(clubs: PayoutClub[]): Promise<(PayoutClub & ReleaseCandidate)[]> {
  const db = createAdminClient()
  const result: (PayoutClub & ReleaseCandidate)[] = []

  for (let index = 0; index < clubs.length; index += ATTEMPT_LOOKUP_CONCURRENCY) {
    const batch = clubs.slice(index, index + ATTEMPT_LOOKUP_CONCURRENCY)
    const attempts = await Promise.all(
      batch.map(async (club) => {
        const { data, error } = await db
          .from('club_payouts')
          .select('created_at')
          .eq('club_id', club.id)
          .eq('origin', 'tickethalo')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (error) {
          console.warn(`[Payouts] Could not read the last payout attempt for club ${club.id}: ${error.message}`)
          return null
        }
        return data?.created_at ?? null
      }),
    )

    batch.forEach((club, position) => result.push({ ...club, lastAttemptAt: attempts[position] }))
  }

  return result
}

/**
 * Klubbene som har en ubekreftet reservasjon (`creating`). Maks én per klubb,
 * så lista er aldri lengre enn antall klubber. `null` når oppslaget feiler.
 */
async function clubsWithUnconfirmedPayout(): Promise<Set<string> | null> {
  const { data, error } = await createAdminClient()
    .from('club_payouts')
    .select('club_id')
    .eq('status', 'creating')

  if (error) {
    console.warn(`[Payouts] Could not list unconfirmed payouts: ${error.message}`)
    return null
  }
  return new Set((data ?? []).map((row) => row.club_id))
}

async function latestPayout(clubId: string): Promise<LatestPayout | null> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('club_payouts')
    .select('status, stripe_payout_id, failure_code, failure_reason, failed_at, updated_at')
    .eq('club_id', clubId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Could not read the latest payout: ${error.message}`)
  return data
}

async function releaseForClub(club: PayoutClub, mayHaveReservation: boolean): Promise<PayoutOutcome> {
  const db = createAdminClient()
  const base = { clubId: club.id, clubName: club.name }
  const currency = club.currency.toLowerCase()

  // Hovedboken først: den koster ett databasekall, saldoen et Stripe-kall. De
  // fleste klubber har ingenting til utbetaling de fleste dager, og
  // tidsbudsjettet skal gå til dem som har. Svaret er bare en forhåndssjekk —
  // reservasjonen regner på nytt under lås. En ubekreftet reservasjon må
  // gjenopptas uansett hva hovedboken sier, så da går vi rett videre.
  let releasable: number | null = null
  if (!mayHaveReservation) {
    releasable = (await getReleasableAmount(club.id)).releasable
    if (releasable <= 0) return { ...base, released: 0, skipped: 'nothing due' }
  }

  const balance = await stripe.balance.retrieve({}, { stripeAccount: club.stripe_account_id })
  const available = availablePayoutBalance(balance, currency)

  // Beløpet regnes og reserveres i databasen under lås — se toppen av filen.
  // Finnes en ubekreftet reservasjon fra før, får vi den tilbake uansett saldo.
  const { data: reservation, error: reserveError } = await db
    .rpc('reserve_club_payout', {
      p_club_id: club.id,
      p_available_amount: Math.min(available, MAX_PG_INTEGER),
      p_currency: currency.toUpperCase(),
      p_stripe_account_id: club.stripe_account_id,
    })
    .maybeSingle()

  if (reserveError) throw new Error(`Could not reserve a payout: ${reserveError.message}`)

  if (!reservation) {
    if (available > 0) return { ...base, released: 0, skipped: 'nothing due' }

    // Pengene kan være opptjent uten at Stripe har dem som tilgjengelige ennå.
    // Det er verdt å skille fra «ingenting å utbetale» i loggen.
    const due = releasable ?? (await getReleasableAmount(club.id)).releasable
    return {
      ...base,
      released: 0,
      skipped: due > 0 ? `balance not available yet (${due} due, 0 available in Stripe)` : 'nothing due',
    }
  }

  // Raden er fasiten for forespørselen. For en gjenopptatt reservasjon må
  // beløp, valuta og konto være nøyaktig de samme som sist — ellers avviser
  // Stripe idempotency key, eller pengene hentes fra feil konto.
  const { data: row, error: rowError } = await db
    .from('club_payouts')
    .select(PAYOUT_ROW_FIELDS)
    .eq('id', reservation.payout_id)
    .single()

  if (rowError || !row) {
    throw new Error(`Could not read reserved payout ${reservation.payout_id}: ${rowError?.message ?? 'no row'}`)
  }

  const accountId = row.stripe_account_id ?? club.stripe_account_id
  const outcome = { ...base, payoutRowId: row.id }

  if (reservation.resumed) {
    // En tidligere kjøring kan ha fått laget utbetalingen uten å rekke å skrive
    // det ned. Idempotency key dekker bare 24 timer, så vi slår opp selv.
    const existing = await findStripePayoutForRow(row, accountId)
    if (existing) {
      const applied = await recordCreatedPayout(row, existing)
      return { ...outcome, released: existing.amount, status: applied }
    }
  }

  let payout: Stripe.Payout
  try {
    // Ingen beskrivelse eller statement descriptor: parametrene må være de
    // samme ved hvert forsøk på raden, også etter en deploy som endrer tekst.
    payout = await stripe.payouts.create(
      {
        amount: row.amount,
        currency: row.currency.toLowerCase(),
        metadata: { club_id: row.club_id, payout_row: row.id },
      },
      { stripeAccount: accountId, idempotencyKey: payoutIdempotencyKey(row.id) },
    )
  } catch (error) {
    const message = errorMessage(error)

    if (!isDefinitivePayoutError(error)) {
      const since = row.created_at.slice(0, 16).replace('T', ' ')
      throw new Error(
        `Payout ${row.id} (reserved ${since} UTC) is unconfirmed and stays reserved; ` +
          `the next run retries it with the same idempotency key. Stripe: ${message}`,
      )
    }

    // Stripe har avvist forespørselen, så ingen utbetaling finnes. Raden
    // frigjøres, ellers blokkerer den klubben og beløpet teller som utbetalt.
    const { error: markError } = await db
      .from('club_payouts')
      .update({
        status: 'failed',
        failure_code: stripeErrorCode(error),
        failure_reason: message,
        failed_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'creating')

    if (markError) {
      throw new Error(
        `Stripe rejected payout ${row.id} (${message}), and the reservation could not be released: ${markError.message}`,
      )
    }

    throw new Error(`Stripe rejected payout ${row.id}: ${message}`)
  }

  const status = await recordCreatedPayout(row, payout)
  return { ...outcome, released: payout.amount, status }
}

/**
 * Skriver ned en utbetaling Stripe har bekreftet. Feiler skrivingen, blir raden
 * stående som `creating`; `payout.created`-webhooken eller neste kjøring finner
 * utbetalingen igjen på `metadata.payout_row`.
 */
async function recordCreatedPayout(row: PayoutRow, payout: Stripe.Payout): Promise<ClubPayoutStatus | undefined> {
  try {
    const result = await applyPayout(row, payout)
    return result.applied ? result.status : undefined
  } catch (error) {
    throw new Error(
      `Payout ${payout.id} was created in Stripe but could not be recorded on row ${row.id} ` +
        `(${errorMessage(error)}); the webhook or the next run records it`,
    )
  }
}

/** Utbetalingen en tidligere kjøring laget for raden, om den finnes. */
async function findStripePayoutForRow(
  row: Pick<PayoutRow, 'id' | 'created_at'>,
  accountId: string,
): Promise<Stripe.Payout | null> {
  const createdAt = Math.floor(Date.parse(row.created_at) / 1000)
  const params: Stripe.PayoutListParams = { limit: 100 }
  if (Number.isFinite(createdAt)) params.created = { gte: createdAt - RESUME_LOOKBACK_SECONDS }

  // Auto-paginering: en klubb med mange utbetalinger siden reservasjonen skal
  // ikke gjøre at vi overser den og sender en ny.
  for await (const payout of stripe.payouts.list(params, { stripeAccount: accountId })) {
    if (payout.metadata?.payout_row === row.id) return payout
  }

  return null
}

// ─────────────────────────────────────────────────────────────
// Status fra Stripe
// ─────────────────────────────────────────────────────────────

/**
 * Oppdaterer raden fra Stripes syn på utbetalingen. Status må bare gå framover
 * (se `canAdvancePayoutStatus`), og betingelsen ligger i selve UPDATE-en slik
 * at to samtidige synker ikke kan krysse hverandre. Rader som aldri er synket
 * (`status_synced_at` null) har en status vi satte selv — Stripe er fasit der.
 */
async function applyPayout(
  row: Pick<PayoutRow, 'id' | 'status' | 'paid_at' | 'failed_at' | 'cancelled_at'>,
  payout: StripePayoutFacts,
  now: Date = new Date(),
): Promise<{ applied: boolean; changed: boolean; status: ClubPayoutStatus }> {
  const db = createAdminClient()
  const patch = payoutRowPatch(payout, now, row)
  const allowedFrom = PAYOUT_STATUSES.filter((from) => canAdvancePayoutStatus(from, patch.status))

  const { data, error } = await db
    .from('club_payouts')
    .update(patch)
    .eq('id', row.id)
    .or(`status_synced_at.is.null,status.in.(${allowedFrom.join(',')})`)
    .select('id')

  if (error) throw new Error(`Could not update payout row ${row.id}: ${error.message}`)

  if (!data?.length) {
    console.warn(
      `[Payouts] Ignored stale status "${patch.status}" for ${payout.id} on row ${row.id} — a newer status is already recorded`,
    )
    return { applied: false, changed: false, status: row.status }
  }

  return { applied: true, changed: row.status !== patch.status, status: patch.status }
}

/**
 * Speiler én Stripe-utbetaling inn i `club_payouts`. Kalles fra `payout.*`-
 * webhooks og fra `syncOpenPayouts`.
 *
 * Utbetalingen hentes alltid på nytt fra Stripe i stedet for å stole på
 * objektet i webhooken: `payout.paid` kan komme før `payout.updated`, og en
 * eldre hendelse skal ikke rulle statusen tilbake.
 *
 * Kaster ved databasefeil, slik at webhooken svarer med feil og Stripe prøver
 * igjen.
 */
export async function syncPayoutFromStripe(payoutId: string, accountId: string): Promise<void> {
  await syncPayout(payoutId, accountId)
}

async function syncPayout(payoutId: string, accountId: string): Promise<{ changed: boolean }> {
  const db = createAdminClient()
  const payout = await stripe.payouts.retrieve(payoutId, {}, { stripeAccount: accountId })
  const now = new Date()

  const row = await findRowForPayout(payout, accountId)
  if (row) {
    const { changed } = await applyPayout(row, payout, now)
    return { changed }
  }

  // En utbetaling vi ikke laget — for eksempel fra Stripe-dashbordet, eller en
  // automatisk utbetaling på en konto som ikke står på manuell plan. Den skal
  // likevel med: pengene har forlatt klubbens saldo og teller mot det som er
  // utbetalt, ellers ville neste frigjøring betalt dem ut en gang til.
  const { data: club, error: clubError } = await db
    .from('clubs')
    .select('id')
    .eq('stripe_account_id', accountId)
    .maybeSingle()

  if (clubError) throw new Error(`Could not look up the club for ${accountId}: ${clubError.message}`)
  if (!club) {
    console.warn(`[Payouts] Payout ${payout.id} on ${accountId} matched no club — ignored`)
    return { changed: false }
  }

  const { error: insertError } = await db.from('club_payouts').insert({
    club_id: club.id,
    amount: payout.amount,
    currency: payout.currency.toUpperCase(),
    period_end: osloDate(now),
    origin: 'stripe',
    stripe_account_id: accountId,
    ...payoutRowPatch(payout, now),
  })

  if (insertError) {
    // `payout.created` og `payout.updated` kan krysse hverandre. Den som taper
    // kappløpet om `stripe_payout_id` oppdaterer raden den andre satte inn.
    if (insertError.code === '23505') {
      const raced = await findRowByStripeId(payout.id)
      if (raced) {
        const { changed } = await applyPayout(raced, payout, now)
        return { changed }
      }
    }
    throw new Error(`Could not record Stripe payout ${payout.id}: ${insertError.message}`)
  }

  return { changed: true }
}

async function findRowByStripeId(payoutId: string): Promise<PayoutRow | null> {
  const db = createAdminClient()

  const { data, error } = await db
    .from('club_payouts')
    .select(PAYOUT_ROW_FIELDS)
    .eq('stripe_payout_id', payoutId)
    .maybeSingle()

  if (error) throw new Error(`Could not look up payout ${payoutId}: ${error.message}`)
  return data
}

/**
 * Raden for en Stripe-utbetaling: først på `stripe_payout_id`, så på
 * `metadata.payout_row` — webhooken kan komme før kjøringen som laget
 * utbetalingen har rukket å skrive ned ID-en.
 */
async function findRowForPayout(payout: Stripe.Payout, accountId: string): Promise<PayoutRow | null> {
  const byStripeId = await findRowByStripeId(payout.id)
  if (byStripeId) return byStripeId

  const rowId = payout.metadata?.payout_row
  if (!rowId || !UUID_PATTERN.test(rowId)) return null

  const db = createAdminClient()
  const { data, error } = await db
    .from('club_payouts')
    .select(PAYOUT_ROW_FIELDS)
    .eq('id', rowId)
    .maybeSingle()

  if (error) throw new Error(`Could not look up payout row ${rowId}: ${error.message}`)
  if (!data) return null

  // Metadata kan redigeres i dashbordet. En rad som allerede hører til en annen
  // utbetaling eller en annen konto er ikke denne — da registreres utbetalingen
  // som sin egen rad i stedet for å overskrive en annen.
  if (data.stripe_payout_id && data.stripe_payout_id !== payout.id) {
    console.warn(`[Payouts] ${payout.id} points at row ${rowId}, which belongs to ${data.stripe_payout_id}`)
    return null
  }
  if (data.stripe_account_id && data.stripe_account_id !== accountId) {
    console.warn(`[Payouts] ${payout.id} on ${accountId} points at row ${rowId} on ${data.stripe_account_id}`)
    return null
  }

  return data
}

/**
 * Sikkerhetsnettet når webhooks ikke kommer fram: henter status for alle
 * utbetalinger som ikke er avgjort, og for betalte utbetalinger de siste
 * dagene — Stripe kan melde en `paid` utbetaling `failed` i etterkant.
 *
 * Med `deadline` (epoch-ms) startes ingen ny runde etter fristen. Radene som
 * ikke ble nådd (`deferred`) beholder sin gamle `status_synced_at` og kommer
 * derfor foran neste gang. Åpne utbetalinger står først i køen — de avgjør om
 * en klubb holdes igjen etter en feil.
 */
export async function syncOpenPayouts(options?: {
  deadline?: number
}): Promise<{ checked: number; updated: number; deferred: number }> {
  const db = createAdminClient()
  const paidSince = new Date(Date.now() - PAID_RECHECK_DAYS * DAY_MS).toISOString()
  const fields = 'id, club_id, stripe_payout_id, stripe_account_id'

  // Eldst synket først, så radene som ikke rekkes denne gangen kommer først
  // neste gang.
  const [open, recentlyPaid] = await Promise.all([
    db
      .from('club_payouts')
      .select(fields)
      .in('status', ['pending', 'in_transit'])
      .not('stripe_payout_id', 'is', null)
      .order('status_synced_at', { ascending: true, nullsFirst: true })
      .limit(SYNC_BATCH_SIZE),
    db
      .from('club_payouts')
      .select(fields)
      .eq('status', 'paid')
      .gte('paid_at', paidSince)
      .not('stripe_payout_id', 'is', null)
      .order('status_synced_at', { ascending: true, nullsFirst: true })
      .limit(SYNC_BATCH_SIZE),
  ])

  if (open.error) throw new Error(`Could not load open payouts: ${open.error.message}`)
  if (recentlyPaid.error) throw new Error(`Could not load recently paid payouts: ${recentlyPaid.error.message}`)

  const rows = [...(open.data ?? []), ...(recentlyPaid.data ?? [])]

  // Rader fra før migrasjon 047 mangler kontoen. Klubbens konto er den samme
  // med mindre klubben har byttet konto siden.
  const clubAccounts = new Map<string, string | null>()
  const clubIds = [...new Set(rows.filter((row) => !row.stripe_account_id).map((row) => row.club_id))]
  if (clubIds.length > 0) {
    const { data: clubs, error } = await db.from('clubs').select('id, stripe_account_id').in('id', clubIds)
    if (error) throw new Error(`Could not load club accounts: ${error.message}`)
    for (const club of clubs ?? []) clubAccounts.set(club.id, club.stripe_account_id)
  }

  const targets: { payoutId: string; accountId: string }[] = []
  for (const row of rows) {
    const accountId = row.stripe_account_id ?? clubAccounts.get(row.club_id) ?? null
    if (!row.stripe_payout_id || !accountId) {
      console.warn(`[Payouts] Row ${row.id} has no Stripe account to sync against`)
      continue
    }
    targets.push({ payoutId: row.stripe_payout_id, accountId })
  }

  let updated = 0
  let failed = 0
  let deferred = 0

  for (let index = 0; index < targets.length; index += SYNC_CONCURRENCY) {
    if (isPastDeadline(options?.deadline)) {
      deferred = targets.length - index
      console.warn(`[Payouts] Time budget used up — ${deferred} of ${targets.length} payouts left for the next sync`)
      break
    }

    const batch = targets.slice(index, index + SYNC_CONCURRENCY)
    const results = await Promise.allSettled(batch.map((target) => syncPayout(target.payoutId, target.accountId)))

    results.forEach((result, position) => {
      if (result.status === 'fulfilled') {
        if (result.value.changed) updated += 1
        return
      }
      failed += 1
      console.error(`[Payouts] Could not sync ${batch[position].payoutId}: ${errorMessage(result.reason)}`)
    })
  }

  const checked = targets.length - deferred
  if (failed > 0) console.error(`[Payouts] ${failed} of ${checked} payouts could not be synced`)

  return { checked, updated, deferred }
}
