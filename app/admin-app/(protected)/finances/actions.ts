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
 */

async function currentClub(): Promise<ConnectClub> {
  const clubId = await getDefaultClubIdForAdmin()
  const db = createAdminClient()
  const { data } = await db.from('clubs').select(CLUB_CONNECT_FIELDS).eq('id', clubId).single()

  if (!data) throw new Error('Fant ikke klubben.')
  return data as unknown as ConnectClub
}

export async function startClubOnboardingAction() {
  const club = await currentClub()
  const url = await createOnboardingLink(club)
  redirect(url)
}

export async function openClubDashboardAction() {
  const club = await currentClub()
  if (!club.stripe_account_id) throw new Error('The club does not have a Stripe account yet.')

  const url = await createDashboardLink(club.stripe_account_id)
  redirect(url)
}

export async function refreshClubStatusAction() {
  const club = await currentClub()
  if (!club.stripe_account_id) throw new Error('The club does not have a Stripe account yet.')

  await syncAccountStatus(club.stripe_account_id)
  revalidatePath('/admin-app/finances')
}

/**
 * The seller details appear on the ticket the customer gets. They belong here
 * and not on the club profile, because they are a precondition for selling —
 * not something the audience sees on the club page.
 */
export async function saveSellerDetailsAction(formData: FormData) {
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
    throw new Error('The company registration number must be nine digits.')
  }

  const supportEmail = text('support_email')
  if (supportEmail && !supportEmail.includes('@')) {
    throw new Error('Support-e-posten ser ikke ut som en e-postadresse.')
  }

  const { error } = await db
    .from('clubs')
    .update({
      legal_name: text('legal_name'),
      org_number: orgNumber,
      support_email: supportEmail,
    })
    .eq('id', clubId)

  if (error) throw new Error('Could not save the seller details.')

  revalidatePath('/admin-app/finances')
}
