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
 * Økonomisiden i klubbadmin. Alle handlingene henter klubben fra
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
  if (!club.stripe_account_id) throw new Error('Klubben har ingen Stripe-konto ennå.')

  const url = await createDashboardLink(club.stripe_account_id)
  redirect(url)
}

export async function refreshClubStatusAction() {
  const club = await currentClub()
  if (!club.stripe_account_id) throw new Error('Klubben har ingen Stripe-konto ennå.')

  await syncAccountStatus(club.stripe_account_id)
  revalidatePath('/admin-app/okonomi')
}

/**
 * Selgeropplysningene står på billetten kunden får. De hører hjemme her og
 * ikke på klubbprofilen, fordi de er en forutsetning for å kunne selge —
 * ikke noe publikum ser på klubbsiden.
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
    throw new Error('Organisasjonsnummeret må være ni siffer.')
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

  if (error) throw new Error('Kunne ikke lagre selgeropplysningene.')

  revalidatePath('/admin-app/okonomi')
}
