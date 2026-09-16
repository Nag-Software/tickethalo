import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Stripe Connect for klubber.
 *
 * Klubben er selger og arrangør av showet — Tickethalo formidler adgangen.
 * Betalingen opprettes derfor på klubbens egen Connect-konto (direct charge),
 * slik at pengene er klubbens fra betalingsøyeblikket og aldri går innom
 * Tickethalos balanse. Tickethalos eneste inntekt er formidlingsprovisjonen,
 * som tas som `application_fee_amount` på betalingen.
 *
 * Utbetaling til bank står på `manual` med vilje: pengene holdes til etter
 * showet, slik at en avlysning ikke etterlater en tom konto med refusjonskrav.
 * Planen settes med Stripes Balance Settings API (`ensureManualPayoutSchedule`)
 * og speiles i `clubs.payout_schedule_interval`. Den er en del av klarheten:
 * en klubb kan ikke selge før Stripe har bekreftet `manual`. Utbetalingene
 * frigis av `lib/payouts.ts` (cron `app/api/cron/release-payouts`).
 */

/** Feltene alt Connect-arbeid trenger. Hold listen i sync med `ConnectClub`. */
export const CLUB_CONNECT_FIELDS =
  'id, name, slug, currency, legal_name, org_number, support_email, invoice_email, ' +
  'stripe_account_id, charges_enabled, payouts_enabled, onboarding_completed_at, ' +
  'platform_fee_bps, commission_vat_bps, payout_hold_days, payout_schedule_interval'

export type ConnectClub = {
  id: string
  name: string
  slug: string
  currency: string
  legal_name: string | null
  org_number: string | null
  support_email: string | null
  /** Adressen komikerne sender honorarfakturaen til. Se `lib/fee-invoices.ts`. */
  invoice_email: string | null
  stripe_account_id: string | null
  charges_enabled: boolean
  payouts_enabled: boolean
  onboarding_completed_at: string | null
  platform_fee_bps: number
  commission_vat_bps: number
  payout_hold_days: number
  /**
   * Utbetalingsplanen slik Stripe sist bekreftet den. Må være `manual` før
   * klubben kan selge. Null = ikke sjekket ennå.
   */
  payout_schedule_interval: string | null
}

/** Teatre/billettformidling. Styrer risikovurdering og enkelte betalingsmåter. */
const CLUB_MCC = '7922'

// ─────────────────────────────────────────────────────────────
// Klarhet
// ─────────────────────────────────────────────────────────────

export type ReadinessItem = {
  key:
    | 'stripe_account'
    | 'charges'
    | 'payouts'
    | 'payout_schedule'
    | 'legal_name'
    | 'org_number'
    | 'support_email'
  label: string
  done: boolean
}

/** Feltene klarheten faktisk avhenger av — så kallere slipper å hente alt. */
export type ClubReadiness = Pick<
  ConnectClub,
  | 'stripe_account_id'
  | 'charges_enabled'
  | 'payouts_enabled'
  | 'payout_schedule_interval'
  | 'legal_name'
  | 'org_number'
  | 'support_email'
>

/**
 * Hva som mangler før klubben kan selge. `legal_name` og `org_number` er med
 * fordi billetten må navngi selgeren — uten dem er formidler-strukturen bare
 * en påstand.
 *
 * Utbetalingsplanen er med fordi Stripe ellers utbetaler billettpengene før
 * showet er avholdt. Bare en plan Stripe faktisk har bekreftet som `manual`
 * teller — ukjent (null) er ikke klar.
 */
export function describeClubReadiness(club: ClubReadiness): ReadinessItem[] {
  return [
    { key: 'stripe_account', label: 'Stripe account created', done: Boolean(club.stripe_account_id) },
    { key: 'charges', label: 'Can accept payments', done: club.charges_enabled },
    { key: 'payouts', label: 'Bank account for payouts', done: club.payouts_enabled },
    {
      key: 'payout_schedule',
      label: 'Payouts held until after the show',
      done: club.payout_schedule_interval === 'manual',
    },
    { key: 'legal_name', label: 'Legal name', done: Boolean(club.legal_name?.trim()) },
    { key: 'org_number', label: 'Company registration number', done: Boolean(club.org_number?.trim()) },
  ]
}

/** Kort liste over hva som mangler, til feilmeldinger i admin. */
export function missingReadinessLabels(club: ClubReadiness | null): string[] {
  if (!club) return ['Showet er ikke koblet til en klubb']
  return describeClubReadiness(club)
    .filter((item) => !item.done)
    .map((item) => item.label)
}

/** Én kilde til sannhet for alle guards: checkout, publisering og cron. */
export function isClubPayoutReady<T extends ClubReadiness>(club: T | null | undefined): club is T {
  if (!club) return false
  return describeClubReadiness(club).every((item) => item.done)
}

// ─────────────────────────────────────────────────────────────
// Konto
// ─────────────────────────────────────────────────────────────

function accountOrigin() {
  if (process.env.APP_URL) return process.env.APP_URL
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  // Her, i motsetning til e-postlenkene, er VERCEL_URL brukbar: brukeren står
  // i nettleseren på samme deploy og sendes rett tilbake dit.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

/**
 * Klubbsiden, men bare når den faktisk kan nås utenfra.
 *
 * Stripe avviser `business_profile.url` som ikke er offentlig — i utvikling
 * er origin `http://localhost:3000`, og da må feltet utelates. Onboardingen
 * spør klubben om nettadressen selv når den mangler.
 */
function publicClubUrl(club: ConnectClub): string | null {
  const origin = accountOrigin().replace(/\/$/, '')

  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:') return null
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname)) return null
  if (/\.local$/i.test(parsed.hostname)) return null

  return `${origin}/clubs/${club.slug}`
}


/**
 * Oppretter kontoen første gang, og returnerer den eksisterende ellers.
 * Idempotent på klubb-id, slik at et dobbeltklikk ikke gir to kontoer.
 *
 * Kontoen opprettes med Accounts v2 (`/v2/core/accounts`). Stripe har stengt
 * v1-oppretting for nye Connect-integrasjoner. `merchant`-konfigurasjonen er
 * den som gjør klubben til merchant of record — nettopp det direct charges
 * krever, og det formidler-strukturen bygger på.
 */
export async function getOrCreateConnectedAccount(club: ConnectClub): Promise<string> {
  if (club.stripe_account_id) {
    // En konto som ble opprettet mens Stripe ikke svarte på utbetalingsplanen,
    // ville ellers stått «ikke klar» til noen trykket Refresh. «Continue setup»
    // går hit, så planen rettes på veien til onboardingen.
    if (club.payout_schedule_interval !== 'manual') {
      await storePayoutSchedule(club.id, club.stripe_account_id)
    }
    return club.stripe_account_id
  }

  const contactEmail = club.support_email?.trim()
  if (!contactEmail) {
    // Stripe krever kontakt-e-post for merchant-konfigurasjonen, og adressen
    // er uansett klubbens kontaktpunkt mot billettkjøperen.
    throw new Error('Fyll inn kontakt for billettkjøpere før du kobler Stripe-kontoen.')
  }

  const clubUrl = publicClubUrl(club)

  const account = await stripe.v2.core.accounts.create(
    {
      display_name: club.legal_name ?? club.name,
      contact_email: contactEmail,
      // Express-dashbordet gir klubben en enkel oversikt over egne utbetalinger
      // uten at de trenger et fullt Stripe-oppsett.
      dashboard: 'express',
      identity: {
        country: 'no',
        // `entity_type` settes ikke: en klubb kan være AS, forening eller
        // enkeltpersonforetak, og onboardingen spør om det selv.
      },
      configuration: {
        merchant: {
          mcc: CLUB_MCC,
          // `stripe_balance.payouts` bes ikke om: den følger med
          // merchant-konfigurasjonen, og leses tilbake i syncAccountStatus.
          capabilities: {
            card_payments: { requested: true },
          },
          support: {
            email: contactEmail,
            ...(clubUrl ? { url: clubUrl } : {}),
          },
        },
      },
      defaults: {
        currency: club.currency.toLowerCase(),
        // Stripe krever `application` på begge når dashbordet er `express`.
        // Det betyr at Tickethalo betaler Stripes behandlingsgebyr og hefter
        // for tap. Gebyret trekkes fra plattformens saldo, aldri fra klubbens
        // betaling, så klubben sitter igjen med nøyaktig 90 % (brutto minus
        // provisjonen). Se lib/stripe-fees.ts for hvordan gebyret bokføres.
        responsibilities: {
          fees_collector: 'application',
          losses_collector: 'application',
        },
      },
      metadata: { club_id: club.id, club_slug: club.slug },
    },
    { idempotencyKey: `club-account-v2-${club.id}` },
  )

  const db = createAdminClient()
  const { error } = await db.from('clubs').update({ stripe_account_id: account.id }).eq('id', club.id)
  if (error) {
    // Kontoen finnes hos Stripe, men ikke hos oss. Et nytt forsøk bruker samme
    // idempotency key og får samme konto tilbake så lenge Stripe husker
    // nøkkelen, så det er tryggere å feile her enn å sende klubben videre med
    // en konto vi ikke har lagret.
    console.error(`[Connect] Could not store Stripe account ${account.id} on club ${club.id}: ${error.message}`)
    throw new Error('Could not save the Stripe account. Try again in a moment.')
  }

  await storePayoutSchedule(club.id, account.id)

  return account.id
}

/**
 * Sørger for at klubbens utbetalingsplan står på `manual`, og returnerer
 * planen slik Stripe rapporterer den.
 *
 * Pengene skal bli stående på klubbens konto til showet er avholdt. En
 * automatisk plan sender billettpengene til banken fortløpende, og et avlyst
 * show etterlater da en tom konto med refusjonskrav.
 *
 * Balance Settings er Stripes anbefalte API for utbetalingsplanen på
 * Accounts v2 — v1 `accounts.update` med `settings.payouts` er det ikke.
 * Klarheten blokkerer salg til `manual` er bekreftet, så en feil her kan ikke
 * lenger i det stille la en klubb selge med automatiske utbetalinger: den gir
 * en klubb som ikke er klar, og en logglinje.
 *
 * Returnerer
 *  - `'manual'` når planen står (eller nå er satt) på manuell,
 *  - planen Stripe viser (`daily`, `weekly`, …) når endringen ble avvist —
 *    den er kjent og ikke manuell, og skal blokkere salg,
 *  - `null` når planen ikke kunne leses. Ukjent er ikke det samme som
 *    automatisk, så kallerne lar da siste bekreftede verdi stå.
 *
 * Idempotent: står planen allerede på `manual`, blir det bare ett oppslag.
 */
export async function ensureManualPayoutSchedule(accountId: string): Promise<string | null> {
  let current: string | null
  try {
    const settings = await stripe.balanceSettings.retrieve(undefined, { stripeAccount: accountId })
    current = payoutInterval(settings)
  } catch (error) {
    console.error(`[Connect] Could not read the payout schedule on ${accountId}: ${describeStripeError(error)}`)
    return null
  }

  if (current === 'manual') return current

  try {
    const updated = await stripe.balanceSettings.update(
      { payments: { payouts: { schedule: { interval: 'manual' } } } },
      { stripeAccount: accountId },
    )
    const interval = payoutInterval(updated)

    if (interval !== 'manual') {
      console.error(
        `[Connect] Payout schedule on ${accountId} is ${interval ?? 'unknown'} after asking Stripe for manual. ` +
          'The club cannot sell until Stripe confirms manual payouts.',
      )
    }
    return interval
  } catch (error) {
    console.error(
      `[Connect] Could not set manual payout schedule on ${accountId} (currently ${current ?? 'unknown'}): ` +
        `${describeStripeError(error)}. The club cannot sell until Stripe confirms manual payouts.`,
    )
    return current
  }
}

function payoutInterval(settings: Stripe.BalanceSettings): string | null {
  return settings.payments?.payouts?.schedule?.interval ?? null
}

/**
 * Melding og request-ID fra Stripe-feilen. Request-ID-en er det Stripe-support
 * trenger. Aldri hele feilobjektet: det har med seg rå request-data.
 */
function describeStripeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const requestId = (error as { requestId?: unknown }).requestId
  return typeof requestId === 'string' ? `${error.message} (request ${requestId})` : error.message
}

/**
 * Håndhever planen og speiler resultatet i `clubs`. `null` (Stripe svarte
 * ikke) skrives ikke: en forbigående feil skal verken viske ut en bekreftet
 * `manual` eller late som planen er sjekket.
 */
async function storePayoutSchedule(clubId: string, accountId: string): Promise<string | null> {
  const interval = await ensureManualPayoutSchedule(accountId)
  if (interval === null) return null

  const db = createAdminClient()
  const { error } = await db
    .from('clubs')
    .update({ payout_schedule_interval: interval, payout_schedule_checked_at: new Date().toISOString() })
    .eq('id', clubId)

  if (error) {
    // Ikke kastet: onboardingen kan fortsette. Klubben står som ikke klar til
    // neste synk skriver planen — det er den trygge feilen.
    console.error(`[Connect] Could not store payout schedule for club ${clubId}: ${error.message}`)
  }
  return interval
}

/** Onboarding-lenke (KYC + bankkonto). Lenken er kortlivet og må hentes på nytt. */
export async function createOnboardingLink(club: ConnectClub, returnPath = '/admin-app/finances') {
  const accountId = await getOrCreateConnectedAccount(club)
  const origin = accountOrigin().replace(/\/$/, '')

  const link = await stripe.v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant'],
        refresh_url: `${origin}${returnPath}?onboarding=refresh`,
        return_url: `${origin}${returnPath}?onboarding=done`,
      },
    },
  })

  return link.url
}

/**
 * Lenke inn i klubbens eget Express-dashboard (saldo, utbetalinger,
 * kvitteringsinnstilling). Stripe avviser lenken før onboardingen er
 * fullført, så feilen oversettes til noe klubben kan handle på.
 */
export async function createDashboardLink(accountId: string) {
  try {
    const link = await stripe.accounts.createLoginLink(accountId)
    return link.url
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('has not completed onboarding')) {
      throw new Error('Stripe-dashbordet åpnes først når onboardingen er fullført.')
    }
    throw error
  }
}

export type AccountSyncResult = {
  /** Null = ingen klubb har kontoen. Da er ingenting hentet fra Stripe. */
  clubId: string | null
  chargesEnabled: boolean
  payoutsEnabled: boolean
  /** Planen Stripe rapporterte. Null = kunne ikke leses denne gangen. */
  payoutScheduleInterval: string | null
}

/**
 * Speiler Stripes syn på kontoen inn i `clubs`. Kalles fra `account.updated`,
 * `balance_settings.updated` og fra økonomisiden, slik at guards kan lese
 * databasen i stedet for å spørre Stripe på hver checkout.
 *
 * Utbetalingsplanen håndheves og skrives i samme oppdatering. Er den endret
 * bort fra `manual` (f.eks. i Stripe-dashbordet), settes den tilbake her —
 * og klarer Stripe ikke det, står klubben som ikke klar.
 *
 * v2 svarer med null for det meste med mindre feltene bes om eksplisitt —
 * derav `include`.
 */
export async function syncAccountStatus(accountId: string): Promise<AccountSyncResult> {
  const db = createAdminClient()

  // Klubben slås opp først. Et event for en konto vi ikke kjenner — i verste
  // fall plattformkontoen selv — skal verken koste Stripe-kall eller få
  // utbetalingsplanen sin satt til manuell.
  const { data: club, error: lookupError } = await db
    .from('clubs')
    .select('id')
    .eq('stripe_account_id', accountId)
    .maybeSingle()

  // Detaljene logges her. Meldingen som kastes kan havne i en toast på
  // økonomisiden, og en databasefeil sier ingenting til en klubbadmin.
  if (lookupError) {
    console.error(`[Connect] Could not look up the club for ${accountId}: ${lookupError.message}`)
    throw new Error('Could not update the Stripe status. Try again in a moment.')
  }
  if (!club) {
    console.warn(`[Connect] Status sync for ${accountId} matched no club — ignored`)
    return { clubId: null, chargesEnabled: false, payoutsEnabled: false, payoutScheduleInterval: null }
  }

  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ['configuration.merchant', 'requirements'],
  })

  const capabilities = account.configuration?.merchant?.capabilities
  const chargesEnabled = capabilities?.card_payments?.status === 'active'
  const payoutsEnabled = capabilities?.stripe_balance?.payouts?.status === 'active'
  const complete = chargesEnabled && payoutsEnabled

  const payoutScheduleInterval = await ensureManualPayoutSchedule(accountId)
  const now = new Date().toISOString()

  const { error } = await db
    .from('clubs')
    .update({
      charges_enabled: chargesEnabled,
      payouts_enabled: payoutsEnabled,
      requirements_due: account.requirements ?? null,
      ...(complete ? { onboarding_completed_at: now } : {}),
      // Null betyr at Stripe ikke svarte på planen. Siste bekreftede verdi får
      // stå, i stedet for at en forbigående feil stenger salget for en klubb
      // som er i orden — eller at `checked_at` later som planen er sjekket.
      ...(payoutScheduleInterval !== null
        ? { payout_schedule_interval: payoutScheduleInterval, payout_schedule_checked_at: now }
        : {}),
    })
    .eq('id', club.id)

  if (error) {
    // Kastes, slik at webhooken svarer 500 og Stripe prøver igjen.
    console.error(`[Connect] Could not store Stripe status for club ${club.id}: ${error.message}`)
    throw new Error('Could not update the Stripe status. Try again in a moment.')
  }

  return { clubId: club.id, chargesEnabled, payoutsEnabled, payoutScheduleInterval }
}

/** Saldo på klubbens konto. `available` er det som kan utbetales nå. */
export async function getAccountBalance(accountId: string) {
  const balance = await stripe.balance.retrieve(undefined, { stripeAccount: accountId })
  const sum = (entries: Stripe.Balance.Available[]) =>
    entries.reduce((total, entry) => total + entry.amount, 0)

  return {
    available: sum(balance.available),
    pending: sum(balance.pending),
    currency: balance.available[0]?.currency?.toUpperCase() ?? 'NOK',
  }
}

// ─────────────────────────────────────────────────────────────
// Provisjon
// ─────────────────────────────────────────────────────────────

/** Formidlingsprovisjonen for et beløp, i minste valutaenhet. */
export function commissionFor(amount: number, club: Pick<ConnectClub, 'platform_fee_bps'>) {
  return Math.round((amount * club.platform_fee_bps) / 10000)
}

/** Henter klubben bak et show, med feltene Connect-arbeidet trenger. */
export async function getClubForShow(showId: string): Promise<ConnectClub | null> {
  const db = createAdminClient()
  const { data: show } = await db.from('shows').select('club_id').eq('id', showId).single()
  if (!show?.club_id) return null

  const { data: club } = await db
    .from('clubs')
    .select(CLUB_CONNECT_FIELDS)
    .eq('id', show.club_id)
    .single()

  // Feltlisten er en konstant, ikke en literal, så Supabase-typene kan ikke
  // utlede raden. `ConnectClub` er kontrakten mot CLUB_CONNECT_FIELDS.
  return (club as unknown as ConnectClub | null) ?? null
}

/**
 * Guard for publisering. Et show som legges ut for salg uten en ferdig
 * Connect-konto ville tatt imot penger uten mottaker — og uten selgeridentitet
 * på billetten.
 */
export async function assertClubCanSell(showId: string) {
  const club = await getClubForShow(showId)
  if (isClubPayoutReady(club)) return club

  const missing = missingReadinessLabels(club).join(', ')
  throw new Error(
    `Klubben er ikke klar for billettsalg ennå. Mangler: ${missing}. ` +
      'Fullfør oppsettet under Økonomi.',
  )
}
