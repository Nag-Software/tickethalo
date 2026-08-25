'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import {
  CLUB_CONNECT_FIELDS,
  type ConnectClub,
  createDashboardLink,
  createOnboardingLink,
  syncAccountStatus,
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
 * Feil fra Stripe og fra våre egne guards har allerede en lesbar melding.
 * Alt annet får en nøytral tekst — en rå intern feil hjelper ingen.
 */
function toActionError(error: unknown, fallback: string): { error: string } {
  if (error instanceof Error && error.message) {
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

export async function startClubOnboardingAction(): Promise<ActionError> {
  let url: string

  try {
    url = await createOnboardingLink(await currentClub())
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

    const status = await syncAccountStatus(club.stripe_account_id)
    revalidatePath(PATH)

    // Ikke en feil, men verdt å si: statusen er hentet, og Stripe mangler
    // fortsatt noe. Uten dette ser knappen ut til å ikke gjøre noe.
    if (!status.chargesEnabled || !status.payoutsEnabled) {
      return { error: 'Status updated — Stripe still needs more information from the club.' }
    }
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
    const clubId = await getDefaultClubIdForAdmin()
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

    const supportEmail = text('support_email')
    if (supportEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(supportEmail)) {
      return { error: 'That does not look like an email address.' }
    }

    const { error } = await db
      .from('clubs')
      .update({
        legal_name: text('legal_name'),
        org_number: orgNumber,
        support_email: supportEmail,
      })
      .eq('id', clubId)

    if (error) {
      console.error(`[Finances] Could not save seller details: ${error.message}`)
      return { error: 'Could not save the seller details. Try again in a moment.' }
    }

    revalidatePath(PATH)
  } catch (error) {
    return toActionError(error, 'Could not save the seller details.')
  }
}
