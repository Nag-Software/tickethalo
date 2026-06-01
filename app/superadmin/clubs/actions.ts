'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'

const RESERVED_CLUB_SLUGS = new Set([
  'admin-app',
  'api',
  'artist-app',
  'artists',
  'booking-offer',
  'checkout',
  'events',
  'login',
  'signup',
  'superadmin',
])

// ─────────────────────────────────────────────────────────────
// Create club
// ─────────────────────────────────────────────────────────────
export async function createClubAction(formData: FormData) {
  const name = (formData.get('name') as string).trim()
  const city = (formData.get('city') as string | null)?.trim() || null
  const description = (formData.get('description') as string | null)?.trim() || null

  if (!name) throw new Error('Navn er påkrevd.')

  const slug = name
    .toLowerCase()
    .replace(/[æ]/g, 'ae')
    .replace(/[ø]/g, 'o')
    .replace(/[å]/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  if (!slug) throw new Error('Klubbnavnet må inneholde minst én bokstav eller ett tall.')
  if (RESERVED_CLUB_SLUGS.has(slug)) throw new Error('Dette klubbnavnet gir en reservert slug. Velg et annet navn.')

  const db = createAdminClient()
  const { data, error } = await db
    .from('clubs')
    .insert({ name, slug, city, description })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') throw new Error('En klubb med dette navnet finnes allerede.')
    throw new Error('Kunne ikke opprette klubb.')
  }

  revalidatePath('/superadmin/clubs')
  redirect(`/superadmin/clubs/${data.id}`)
}

// ─────────────────────────────────────────────────────────────
// Delete club
// ─────────────────────────────────────────────────────────────
export async function deleteClubAction(clubId: string) {
  const db = createAdminClient()
  await db.from('clubs').delete().eq('id', clubId)
  revalidatePath('/superadmin/clubs')
  redirect('/superadmin/clubs')
}

// ─────────────────────────────────────────────────────────────
// Add admin to club (by email)
// ─────────────────────────────────────────────────────────────
export async function addClubAdminAction(formData: FormData) {
  const clubId = formData.get('club_id') as string
  const email = (formData.get('email') as string).trim().toLowerCase()

  if (!email) throw new Error('E-post er påkrevd.')

  const db = createAdminClient()

  // Find or create profile by email
  const { data: profile } = await db
    .from('profiles')
    .select('id, role')
    .eq('email', email)
    .single()

  if (!profile) {
    throw new Error(`Fant ingen bruker med e-post ${email}. Brukeren må registrere seg først.`)
  }

  // Ensure profile has at least admin role
  if (profile.role === 'artist' || profile.role === 'staff') {
    await db
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', profile.id)
  }

  const { error } = await db
    .from('club_memberships')
    .insert({ club_id: clubId, profile_id: profile.id })

  if (error) {
    if (error.code === '23505') throw new Error('Denne brukeren er allerede admin for klubben.')
    throw new Error('Kunne ikke legge til admin.')
  }

  revalidatePath(`/superadmin/clubs/${clubId}`)
}

// ─────────────────────────────────────────────────────────────
// Remove admin from club
// ─────────────────────────────────────────────────────────────
export async function removeClubAdminAction(membershipId: string, clubId: string) {
  const db = createAdminClient()
  await db.from('club_memberships').delete().eq('id', membershipId)
  revalidatePath(`/superadmin/clubs/${clubId}`)
}
