import type { ClubReadiness } from '@/lib/stripe-connect'

/**
 * Hvor klubben er i oppsettet for å selge billetter — ett steg om gangen.
 *
 * Klarhetslisten (`describeClubReadiness`) er en liste over alt som må være
 * på plass, og den er riktig for guards. Men som oppsett for en klubb var den
 * seks punkter de ikke så rekkefølgen i, pluss en knapp som var grå til et
 * felt i et annet kort var fylt ut. Her blir den tre steg:
 *
 *  1. seller — hvem som selger. Navn, foretaksnummer og kontaktadresse.
 *     Stripe krever adressen for å opprette kontoen, så dette må først.
 *  2. stripe — kontoen hos Stripe. Enten finnes den ikke, eller så mangler
 *     Stripe fortsatt noe fra klubben (betalinger, bankkonto). Planen for
 *     utbetaling setter vi selv og vises ikke som noe klubben skal gjøre.
 *  3. ready — alt er på plass.
 */

export type SetupStep = 'seller' | 'stripe' | 'ready'

export type ClubSetup = {
  step: SetupStep
  /** Steg 2: hva som finnes hos Stripe. Alle false når kontoen ikke finnes. */
  stripe: {
    hasAccount: boolean
    canTakePayments: boolean
    hasBankAccount: boolean
    /** Utbetalingsplanen er bekreftet manuell. Settes av oss, ikke klubben. */
    payoutsHeld: boolean
  }
}

export type SetupClub = ClubReadiness & { support_email: string | null }

export function describeClubSetup(club: SetupClub): ClubSetup {
  const stripe = {
    hasAccount: Boolean(club.stripe_account_id),
    canTakePayments: Boolean(club.stripe_account_id) && club.charges_enabled,
    hasBankAccount: Boolean(club.stripe_account_id) && club.payouts_enabled,
    payoutsHeld: Boolean(club.stripe_account_id) && club.payout_schedule_interval === 'manual',
  }

  const sellerDone = Boolean(club.legal_name?.trim()) && Boolean(club.org_number?.trim()) && Boolean(club.support_email?.trim())
  if (!sellerDone) return { step: 'seller', stripe }

  const stripeDone = stripe.hasAccount && stripe.canTakePayments && stripe.hasBankAccount && stripe.payoutsHeld
  return { step: stripeDone ? 'ready' : 'stripe', stripe }
}
