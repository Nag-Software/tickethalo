'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import {
  type AccountSyncResult,
  CLUB_CONNECT_FIELDS,
  type ConnectClub,
  createDashboardLink,
  createOnboardingLink,
  syncAccountStatus,
  trySyncConnectedAccountName,
} from '@/lib/stripe-connect'

/**
 * The finance page in club admin. Every action resolves the club from
 * innloggingen — en klubb-ID fra skjemaet ville latt hvem som helst styre en
 * annen klubbs Stripe-konto.
 *
 * Handlingene kaster ikke. En server action som kaster gir Next-feilsiden, og
 * i produksjon skjuler Next dessuten meldingen — en klubbadmin som mangler et
 * felt ville fått «an error occurred». De returnerer `{ error }`, som
 * `ToastActionForm` viser som en toast.
 */

const PATH = '/admin-app/finances'

type ActionError = { error: string } | undefined

/**
 * Feil som skyldes Tickethalos eget Stripe-oppsett, ikke klubbens.
 *
 * «Only Stripe Connect platforms can work with other accounts» betyr at
 * API-nøkkelen appen kjører med tilhører en Stripe-konto som ikke er
 * registrert som Connect-plattform — typisk en live-nøkkel der
 * plattformprofilen ikke er fullført, eller en nøkkel fra feil konto. Det
 * samme gjelder ugyldige nøkler og test/live-forveksling.
 *
 * «Your account must be activated in order to create accounts» er samme sak
 * fra en annen kant: live-nøkkelen tilhører en plattformkonto som ikke har
 * fullført Stripes egen aktivering, og kan derfor ikke opprette Connect-kontoer.
 *
 * Klubbadmin kan ikke gjøre noe med noen av dem, og Stripes egen tekst peker
 * på en innstillingsside de ikke har tilgang til. Derfor får de vite at det er
 * vår feil, mens loggen får hele meldingen.
 */
const PLATFORM_MISCONFIGURED =
  /only stripe connect platforms|must be activated in order to create accounts|invalid api key|no such application|similar object exists in (live|test) mode/i

/**
 * Feil fra Stripe og fra våre egne guards har allerede en lesbar melding.
 * Alt annet får en nøytral tekst — en rå intern feil hjelper ingen.
 */
function toActionError(error: unknown, fallback: string): { error: string } {
  if (error instanceof Error && error.message) {
    if (PLATFORM_MISCONFIGURED.test(error.message)) {
      console.error(
        `[Finances] Stripe-oppsettet på plattformen svarer ikke: ${error.message} — ` +
          'sjekk at STRIPE_SECRET_KEY i dette miljøet tilhører Connect-plattformen ' +
          '(live krever aktivert konto på dashboard.stripe.com/account/onboarding og fullført ' +
          'plattformprofil på dashboard.stripe.com/account/applications/settings).',
      )
      return { error: 'Stripe-koblingen vår er ikke satt opp riktig. Dette er på oss — vi har fått beskjed.' }
    }

    console.error(`[Finances] ${error.message}`)
    return { error: error.message }
  }

  console.error('[Finances]', error)
  return { error: fallback }
}

async function currentClub(): Promise<ConnectClub> {
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()
  const { data } = await db.from('clubs').select(CLUB_CONNECT_FIELDS).eq('id', clubId).single()

  if (!data) throw new Error('Could not find the club.')
  return data as unknown as ConnectClub
}

/**
 * Hva klubbadmin skal få høre når utbetalingsplanen ikke er bekreftet som
 * manuell. Null er ikke det samme som automatisk: da svarte Stripe ikke, og et
 * nytt forsøk hjelper som regel.
 */
function payoutScheduleProblem(interval: string | null): { error: string } | undefined {
  if (interval === 'manual') return undefined
  if (interval === null) {
    return { error: 'Status updated — but we could not check the payout schedule with Stripe. Try again in a moment.' }
  }
  return {
    error:
      'Status updated — Stripe did not let us hold payouts until after the show, so tickets cannot go on sale yet. ' +
      'We have been notified.',
  }
}

/**
 * Navnet på kontoen hos Stripe følger klubben i Tickethalo — se
 * `connectedAccountNames`. Lyktes ikke det, skal det stå i samme toast som
 * resten av statusen, ikke bare i loggen — ellers ser Refresh ut til å ha
 * ordnet alt.
 */
function withNameProblem(message: string | undefined, nameSynced: boolean): ActionError {
  if (nameSynced) return message ? { error: message } : undefined

  return {
    error: message
      ? `${message} The club name could not be updated in Stripe either — try again in a moment.`
      : 'Status updated — but the club name could not be updated in Stripe. Try again in a moment.',
  }
}

export async function startClubOnboardingAction(): Promise<ActionError> {
  let url: string

  try {
    const club = await currentClub()

    // Er Stripe-kontoen ferdig og det bare er utbetalingsplanen som mangler,
    // har onboardingen ingenting å vise klubben — planen settes av oss, ikke
    // av klubben. Da synkes status i stedet for en rundtur til Stripe.
    if (
      club.stripe_account_id &&
      club.charges_enabled &&
      club.payouts_enabled &&
      club.payout_schedule_interval !== 'manual'
    ) {
      const status = await syncAccountStatus(club.stripe_account_id)
      revalidatePath(PATH)

      if (status.chargesEnabled && status.payoutsEnabled) {
        return payoutScheduleProblem(status.payoutScheduleInterval)
      }
      // Stripe trenger mer fra klubben likevel — videre til onboardingen.
    }

    url = await createOnboardingLink(club)
  } catch (error) {
    return toActionError(error, 'Could not open Stripe onboarding. Try again in a moment.')
  }

  // Utenfor try: `redirect` kaster en NEXT_REDIRECT som må slippe gjennom.
  redirect(url)
}

export async function openClubDashboardAction(): Promise<ActionError> {
  let url: string

  try {
    const club = await currentClub()
    if (!club.stripe_account_id) return { error: 'The club does not have a Stripe account yet.' }

    url = await createDashboardLink(club.stripe_account_id)
  } catch (error) {
    return toActionError(error, 'Could not open the Stripe dashboard.')
  }

  redirect(url)
}

export async function refreshClubStatusAction(): Promise<ActionError> {
  try {
    const club = await currentClub()
    if (!club.stripe_account_id) return { error: 'The club does not have a Stripe account yet.' }

    // Samme knapp retter navnet på kontoen, så en klubb som byttet navn før
    // navnet fulgte med slipper å lagre noe på nytt. De to er uavhengige og
    // går samtidig, så knappen ikke venter på to Stripe-rundturer etter
    // hverandre. Navnesynken kaster aldri, og ventes inn også når
    // statussynken kaster: sendes svaret før den er ferdig, kan funksjonen
    // fryses midt i, og navnet blir stående.
    const nameSync = trySyncConnectedAccountName(club)
    let status: AccountSyncResult
    try {
      status = await syncAccountStatus(club.stripe_account_id)
    } finally {
      await nameSync
    }
    const nameSynced = await nameSync
    revalidatePath(PATH)

    // Ikke en feil, men verdt å si: statusen er hentet, og Stripe mangler
    // fortsatt noe. Uten dette ser knappen ut til å ikke gjøre noe.
    if (!status.chargesEnabled || !status.payoutsEnabled) {
      return withNameProblem('Status updated — Stripe still needs more information from the club.', nameSynced)
    }

    // Kontoen er i orden hos Stripe, men salget åpner ikke før utbetalingene
    // holdes til etter showet. Sjekklista viser det, men knappen bør si hvorfor.
    const scheduleProblem = payoutScheduleProblem(status.payoutScheduleInterval)
    return withNameProblem(scheduleProblem?.error, nameSynced)
  } catch (error) {
    return toActionError(error, 'Could not reach Stripe. Try again in a moment.')
  }
}

/**
 * The seller details appear on the ticket the customer gets. They belong here
 * and not on the club profile, because they are a precondition for selling —
 * not something the audience sees on the club page.
 */
export async function saveSellerDetailsAction(formData: FormData): Promise<ActionError> {
  try {
    const club = await currentClub()
    const db = createAdminClient()

    const text = (key: string) => {
      const value = formData.get(key)
      if (typeof value !== 'string') return null
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed.slice(0, 200) : null
    }

    const orgNumber = text('org_number')?.replace(/\s/g, '') ?? null
    if (orgNumber && !/^\d{9}$/.test(orgNumber)) {
      return { error: 'The company registration number must be nine digits.' }
    }

    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

    const supportEmail = text('support_email')
    if (supportEmail && !email.test(supportEmail)) {
      return { error: 'That does not look like an email address.' }
    }

    // Fakturaadressen går ut til komikerne i honorar-eposten. En skrivefeil
    // her sender fakturaen ingen steder, og oppdages først når noen purrer.
    const invoiceEmail = text('invoice_email')
    if (invoiceEmail && !email.test(invoiceEmail)) {
      return { error: 'That does not look like an invoicing email address.' }
    }

    const legalName = text('legal_name')

    const { error } = await db
      .from('clubs')
      .update({
        legal_name: legalName,
        org_number: orgNumber,
        support_email: supportEmail,
        invoice_email: invoiceEmail,
      })
      .eq('id', club.id)

    if (error) {
      console.error(`[Finances] Could not save seller details: ${error.message}`)
      return { error: 'Could not save the seller details. Try again in a moment.' }
    }

    revalidatePath(PATH)

    // Det juridiske navnet er også kontoens navn i Stripe-dashbordet. Går
    // Stripe ned akkurat nå, står opplysningene lagret likevel — knappen
    // Refresh prøver navnet på nytt.
    if (!(await trySyncConnectedAccountName({ ...club, legal_name: legalName }))) {
      return {
        error:
          'Seller details saved — but the name could not be updated in Stripe. Use Refresh under Stripe status to try again.',
      }
    }
  } catch (error) {
    return toActionError(error, 'Could not save the seller details.')
  }
}
