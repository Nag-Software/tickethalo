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
  key: 'stripe_account' | 'charges' | 'payouts' | 'legal_name' | 'org_number'
  label: string
  done: boolean
}

/** Feltene klarheten faktisk avhenger av — så kallere slipper å hente alt. */
export type ClubReadiness = Pick<
  ConnectClub,
  'stripe_account_id' | 'charges_enabled' | 'payouts_enabled' | 'legal_name' | 'org_number'
>

/**
 * Hva som mangler før klubben kan selge. `legal_name` og `org_number` er med
 * fordi billetten må navngi selgeren — uten dem er formidler-strukturen bare
 * en påstand.
 */
export function describeClubReadiness(club: ClubReadiness): ReadinessItem[] {
  return [
    { key: 'stripe_account', label: 'Stripe-konto opprettet', done: Boolean(club.stripe_account_id) },
    { key: 'charges', label: 'Kan ta imot betaling', done: club.charges_enabled },
    { key: 'payouts', label: 'Bankkonto for utbetaling', done: club.payouts_enabled },
    { key: 'legal_name', label: 'Juridisk navn', done: Boolean(club.legal_name?.trim()) },
    { key: 'org_number', label: 'Organisasjonsnummer', done: Boolean(club.org_number?.trim()) },
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

function businessProfile(club: ConnectClub): Stripe.AccountCreateParams.BusinessProfile {
  const origin = accountOrigin().replace(/\/$/, '')
  return {
    // Navnet og supportinfoen her er det kunden ser på Stripes
    // betalingskvittering. Står de tomt, framstår Tickethalo som selger.
    name: club.legal_name ?? club.name,
    url: `${origin}/clubs/${club.slug}`,
    mcc: CLUB_MCC,
    ...(club.support_email ? { support_email: club.support_email } : {}),
    support_url: `${origin}/clubs/${club.slug}`,
  }
}

/**
 * Oppretter Express-kontoen første gang, og returnerer den eksisterende ellers.
 * Idempotent på klubb-id, slik at et dobbeltklikk ikke gir to kontoer.
 */
export async function getOrCreateConnectedAccount(club: ConnectClub): Promise<string> {
  if (club.stripe_account_id) return club.stripe_account_id

  const account = await stripe.accounts.create(
    {
      type: 'express',
      country: 'NO',
      // `business_type` settes ikke: en klubb kan være AS, forening eller
      // enkeltpersonforetak, og Stripes onboarding spør om det selv.
      default_currency: club.currency.toLowerCase(),
      business_profile: businessProfile(club),
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      settings: {
        // Pengene holdes på klubbens konto til etter showet.
        payouts: { schedule: { interval: 'manual' } },
      },
      metadata: { club_id: club.id, club_slug: club.slug },
    },
    { idempotencyKey: `club-account-${club.id}` },
  )

  const db = createAdminClient()
  await db.from('clubs').update({ stripe_account_id: account.id }).eq('id', club.id)

  return account.id
}

/** Onboarding-lenke (KYC + bankkonto). Lenken er kortlivet og må hentes på nytt. */
export async function createOnboardingLink(club: ConnectClub, returnPath = '/admin-app/okonomi') {
  const accountId = await getOrCreateConnectedAccount(club)
  const origin = accountOrigin().replace(/\/$/, '')

  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${origin}${returnPath}?onboarding=refresh`,
    return_url: `${origin}${returnPath}?onboarding=done`,
  })

  return link.url
}

/** Lenke inn i klubbens eget Express-dashboard (saldo, utbetalinger, kvitteringer). */
export async function createDashboardLink(accountId: string) {
  const link = await stripe.accounts.createLoginLink(accountId)
  return link.url
}

/**
 * Speiler Stripes syn på kontoen inn i `clubs`. Kalles fra `account.updated`
 * og fra økonomisiden, slik at guards kan lese databasen i stedet for å
 * spørre Stripe på hver checkout.
 */
export async function syncAccountStatus(accountId: string) {
  const account = await stripe.accounts.retrieve(accountId)
  const db = createAdminClient()

  const chargesEnabled = account.charges_enabled === true
  const payoutsEnabled = account.payouts_enabled === true
  const complete = chargesEnabled && payoutsEnabled && account.details_submitted === true

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
