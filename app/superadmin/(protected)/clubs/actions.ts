'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertSuperadmin } from '@/lib/superadmin-auth'

/*
 * Hver handling her spør selv om superadmin. Layouten gjør det samme for
 * sidene, men en server action er et endepunkt som kan kalles uten å ha vært
 * innom siden — og disse skriver med service-nøkkelen. Før sjekket ingen av
 * dem noe: `addClubAdminAction` kunne gjøre hvem som helst til admin for en
 * hvilken som helst klubb.
 */

// ─────────────────────────────────────────────────────────────
// Create club
// ─────────────────────────────────────────────────────────────
export async function createClubAction(formData: FormData) {
  await assertSuperadmin()
  const name = String(formData.get('name') ?? '').trim()
  const city = (formData.get('city') as string | null)?.trim() || null
  const description = (formData.get('description') as string | null)?.trim() || null

  if (!name) return { error: 'Navn er påkrevd.' }

  const slug = name
    .toLowerCase()
    .replace(/[æ]/g, 'ae')
    .replace(/[ø]/g, 'o')
    .replace(/[å]/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const db = createAdminClient()
  const { data, error } = await db
    .from('clubs')
    .insert({ name, slug, city, description })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'En klubb med dette navnet finnes allerede.' }
    return { error: 'Kunne ikke opprette klubb.' }
  }

  revalidatePath('/superadmin/clubs')
  revalidatePath('/superadmin/overview')
  redirect(`/superadmin/clubs/${data.id}`)
}

// ─────────────────────────────────────────────────────────────
// Delete club
// ─────────────────────────────────────────────────────────────
/**
 * En klubb med salg kan ikke slettes. Slettingen tar med seg oppgjør og
 * utbetalinger (`on delete cascade`, migrasjon 032) og lar showene stå igjen
 * uten klubb — regnskapet til en ekte kveld ville forsvunnet med ett klikk.
 */
export async function deleteClubAction(formData: FormData) {
  await assertSuperadmin()
  const clubId = String(formData.get('club_id') ?? '')
  if (!clubId) return { error: 'Mangler klubb.' }

  const db = createAdminClient()
  const { data: shows } = await db.from('shows').select('id').eq('club_id', clubId)
  const showIds = (shows ?? []).map((show) => show.id)

  if (showIds.length > 0) {
    const { count: orders } = await db
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .in('show_id', showIds)

    if ((orders ?? 0) > 0) {
      return { error: `Klubben har ${orders} ordrer og kan ikke slettes. Regnskapet må bli stående.` }
    }
  }

  const { error } = await db.from('clubs').delete().eq('id', clubId)
  if (error) return { error: 'Kunne ikke slette klubben.' }

  revalidatePath('/superadmin/clubs')
  revalidatePath('/superadmin/overview')
  redirect('/superadmin/clubs')
}

// ─────────────────────────────────────────────────────────────
// Add admin to club (by email)
// ─────────────────────────────────────────────────────────────
export async function addClubAdminAction(formData: FormData) {
  await assertSuperadmin()
  const clubId = String(formData.get('club_id') ?? '')
  const email = String(formData.get('email') ?? '').trim().toLowerCase()

  // Meldingene returneres, ikke kastes: Next fjerner teksten fra kastede feil
  // i produksjon, og «brukeren må registrere seg først» er hele poenget.
  if (!clubId) return { error: 'Mangler klubb.' }
  if (!email) return { error: 'E-post er påkrevd.' }

  const db = createAdminClient()

  const { data: profile } = await db
    .from('profiles')
    .select('id, role')
    .eq('email', email)
    .maybeSingle()

  if (!profile) {
    return { error: `Fant ingen bruker med e-post ${email}. Brukeren må registrere seg først.` }
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
    if (error.code === '23505') return { error: 'Denne brukeren er allerede admin for klubben.' }
    return { error: 'Kunne ikke legge til admin.' }
  }

  revalidatePath(`/superadmin/clubs/${clubId}`)
  revalidatePath('/superadmin/overview')
}

// ─────────────────────────────────────────────────────────────
// Remove admin from club
// ─────────────────────────────────────────────────────────────
export async function removeClubAdminAction(formData: FormData) {
  await assertSuperadmin()
  const membershipId = String(formData.get('membership_id') ?? '')
  const clubId = String(formData.get('club_id') ?? '')
  if (!membershipId || !clubId) return

  // Klubben er med i filteret, så et medlemskap ikke kan fjernes via en annen klubbs side.
  await createAdminClient().from('club_memberships').delete().eq('id', membershipId).eq('club_id', clubId)
  revalidatePath(`/superadmin/clubs/${clubId}`)
  revalidatePath('/superadmin/overview')
}
