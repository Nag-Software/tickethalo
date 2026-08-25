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
 * Se `app/api/cron/release-payouts`.
 */

/** Feltene alt Connect-arbeid trenger. Hold listen i sync med `ConnectClub`. */
export const CLUB_CONNECT_FIELDS =
  'id, name, slug, currency, legal_name, org_number, support_email, ' +
  'stripe_account_id, charges_enabled, payouts_enabled, onboarding_completed_at, ' +
  'platform_fee_bps, commission_vat_bps, payout_hold_days, absorb_stripe_fee'

export type ConnectClub = {
  id: string
  name: string
  slug: string
  currency: string
  legal_name: string | null
  org_number: string | null
  support_email: string | null
  stripe_account_id: string | null
  charges_enabled: boolean
  payouts_enabled: boolean
  onboarding_completed_at: string | null
  platform_fee_bps: number
  commission_vat_bps: number
  payout_hold_days: number
  absorb_stripe_fee: boolean
}

/** Teatre/billettformidling. Styrer risikovurdering og enkelte betalingsmåter. */
const CLUB_MCC = '7922'

// ─────────────────────────────────────────────────────────────
// Klarhet
// ─────────────────────────────────────────────────────────────

export type ReadinessItem = {
  key: 'stripe_account' | 'charges' | 'payouts' | 'legal_name' | 'org_number' | 'support_email'
  label: string
  done: boolean
}

/** Feltene klarheten faktisk avhenger av — så kallere slipper å hente alt. */
export type ClubReadiness = Pick<
  ConnectClub,
  'stripe_account_id' | 'charges_enabled' | 'payouts_enabled' | 'legal_name' | 'org_number' | 'support_email'
>

/**
 * Hva som mangler før klubben kan selge. `legal_name` og `org_number` er med
 * fordi billetten må navngi selgeren — uten dem er formidler-strukturen bare
 * en påstand.
 */
export function describeClubReadiness(club: ClubReadiness): ReadinessItem[] {
  return [
    { key: 'stripe_account', label: 'Stripe account created', done: Boolean(club.stripe_account_id) },
    { key: 'charges', label: 'Can accept payments', done: club.charges_enabled },
    { key: 'payouts', label: 'Bank account for payouts', done: club.payouts_enabled },
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
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
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
  if (club.stripe_account_id) return club.stripe_account_id

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
        // Det betyr at Tickethalo betaler Stripes gebyrer og hefter for tap —
        // se kommentaren i lib/stripe-fees.ts om hva det gjør med oppgjøret.
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
  await db.from('clubs').update({ stripe_account_id: account.id }).eq('id', club.id)

  await holdPayouts(account.id)

  return account.id
}

/**
 * Utbetaling settes til manuell, slik at pengene blir stående på klubbens
 * konto til showet er avholdt. Uten dette kan et avlyst show etterlate en tom
 * konto med refusjonskrav.
 *
 * Utbetalingsplanen finnes ikke i v2-oppretting ennå. v2-konto-ID-er er
 * gyldige på v1-kontoendepunktene, så den settes der.
 */
async function holdPayouts(accountId: string) {
  try {
    await stripe.accounts.update(accountId, {
      settings: { payouts: { schedule: { interval: 'manual' } } },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `[Connect] Could not set manual payout schedule on ${accountId}: ${message}. ` +
        'Funds may be paid out before the show — set the schedule manually in Stripe.',
    )
  }
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

/**
 * Speiler Stripes syn på kontoen inn i `clubs`. Kalles fra `account.updated`
 * og fra økonomisiden, slik at guards kan lese databasen i stedet for å
 * spørre Stripe på hver checkout.
 *
 * v2 svarer med null for det meste med mindre feltene bes om eksplisitt —
 * derav `include`.
 */
export async function syncAccountStatus(accountId: string) {
  const account = await stripe.v2.core.accounts.retrieve(accountId, {
    include: ['configuration.merchant', 'requirements'],
  })

  const capabilities = account.configuration?.merchant?.capabilities
  const chargesEnabled = capabilities?.card_payments?.status === 'active'
  const payoutsEnabled = capabilities?.stripe_balance?.payouts?.status === 'active'
  const complete = chargesEnabled && payoutsEnabled

  const db = createAdminClient()
  const { data } = await db
    .from('clubs')
    .update({
      charges_enabled: chargesEnabled,
      payouts_enabled: payoutsEnabled,
      requirements_due: account.requirements ?? null,
      ...(complete ? { onboarding_completed_at: new Date().toISOString() } : {}),
    })
    .eq('stripe_account_id', accountId)
    .select('id')
    .maybeSingle()

  if (!data) {
    console.warn(`[Connect] account.updated for ${accountId} matched no club`)
  }

  return { chargesEnabled, payoutsEnabled }
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
