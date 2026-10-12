'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { parseCommissionPercent } from '@/lib/platform-fee'
import { provisionClubAdmin } from '@/lib/club-onboarding'
import { recordError } from '@/lib/error-log'
import { defaultCurrencyFor, defaultTicketVatBps, parseClubCountry, parseVatPercent } from '@/lib/ticket-vat'

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
/**
 * Oppretter klubben — og kontoen den logger inn med.
 *
 * Klubben søker med en e-postadresse, og den adressen skal være admin fra
 * første dag uten at noen må registrere seg først. Derfor lages brukeren,
 * profilen og medlemskapet her (`provisionClubAdmin`), og klubben får en
 * e-post med lenke for å sette passord. Kommer opprettelsen fra en
 * betasøknad, settes søknaden til «godkjent» og peker på klubben.
 *
 * Feiler kontoen etter at klubben er laget, blir klubben stående: et nytt
 * forsøk fra skjemaet ville laget klubb nummer to. Feilen vises på
 * klubbsiden i stedet, der «Legg til admin» gjør samme jobb på nytt.
 */
export async function createClubAction(formData: FormData) {
  await assertSuperadmin()
  const name = String(formData.get('name') ?? '').trim()
  const city = (formData.get('city') as string | null)?.trim() || null
  const description = (formData.get('description') as string | null)?.trim() || null
  const adminEmail = String(formData.get('admin_email') ?? '').trim().toLowerCase()
  const betaRequestId = String(formData.get('beta_request_id') ?? '').trim() || null

  if (!name) return { error: 'Navn er påkrevd.' }
  if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(adminEmail)) return { error: 'E-postadressen til admin ser ikke riktig ut.' }

  // Landet avgjør Stripe-kontoens land, valutaen og momsen på billettene.
  // Satsen kan endres etterpå; landet kan det ikke når Stripe-kontoen finnes.
  const parsedCountry = parseClubCountry(formData.get('country'))
  if ('error' in parsedCountry) return { error: parsedCountry.error }
  const { country } = parsedCountry

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
    .insert({
      name,
      slug,
      city,
      description,
      country,
      currency: defaultCurrencyFor(country),
      ticket_vat_bps: defaultTicketVatBps(country),
      // Stripe krever en kontaktadresse, og klubbens egen er det riktige
      // utgangspunktet. Klubben kan endre den under Finances.
      support_email: adminEmail || null,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { error: 'En klubb med dette navnet finnes allerede.' }
    return { error: 'Kunne ikke opprette klubb.' }
  }

  let adminError: string | null = null
  if (adminEmail) {
    try {
      const admin = await provisionClubAdmin({ clubId: data.id, clubName: name, email: adminEmail })
      if (!admin.emailSent) {
        adminError = `Kontoen til ${adminEmail} er opprettet, men velkomst-e-posten gikk ikke ut (${admin.emailError ?? 'ukjent feil'}). Be klubben bruke «Glemt passord».`
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      await recordError('club_onboarding', cause, { club_id: data.id, email: adminEmail })
      adminError = `Klubben er opprettet, men kontoen til ${adminEmail} ble ikke laget: ${message}`
    }
  }

  if (betaRequestId) {
    // Søknaden er behandlet. Feiler dette, er det bare et merke som mangler.
    const { error: requestError } = await db
      .from('club_beta_requests')
      .update({ status: 'approved', club_id: data.id, updated_at: new Date().toISOString() })
      .eq('id', betaRequestId)
    if (requestError) console.error(`[Superadmin] Could not mark beta request ${betaRequestId} approved: ${requestError.message}`)
  }

  revalidatePath('/superadmin/clubs')
  revalidatePath('/superadmin/overview')
  revalidatePath('/superadmin/beta-requests')
  revalidatePath('/superadmin', 'layout')
  redirect(adminError ? `/superadmin/clubs/${data.id}?adminError=${encodeURIComponent(adminError)}` : `/superadmin/clubs/${data.id}`)
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
// Commission per club
// ─────────────────────────────────────────────────────────────
/**
 * Provisjonen leses av `clubs.platform_fee_bps` ved hvert kjøp, så endringen
 * gjelder fra neste kjøp. Betalte ordrer beholder provisjonen de ble solgt
 * med — den står på ordren.
 */
export async function updateClubCommissionAction(formData: FormData) {
  await assertSuperadmin()
  const clubId = String(formData.get('club_id') ?? '')
  if (!clubId) return { error: 'Mangler klubb.' }

  const parsed = parseCommissionPercent(formData.get('commission_percent'))
  if ('error' in parsed) return { error: parsed.error }

  const { error } = await createAdminClient()
    .from('clubs')
    .update({ platform_fee_bps: parsed.bps })
    .eq('id', clubId)

  if (error) return { error: 'Kunne ikke lagre provisjonen.' }

  revalidatePath(`/superadmin/clubs/${clubId}`)
  revalidatePath('/superadmin/clubs')
  // Klubbens økonomiside viser prosenten i overskriften.
  revalidatePath('/admin-app/finances')
}

// ─────────────────────────────────────────────────────────────
// Country and ticket VAT per club
// ─────────────────────────────────────────────────────────────
/**
 * Momsen leses av `clubs.ticket_vat_bps` ved hvert kjøp og låses på ordren,
 * så endringen gjelder fra neste kjøp. Landet kan ikke byttes etter at
 * Stripe-kontoen er opprettet: kontoen er opprettet i det landet, og Stripe
 * flytter ikke en konto mellom land.
 */
export async function updateClubTaxAction(formData: FormData) {
  await assertSuperadmin()
  const clubId = String(formData.get('club_id') ?? '')
  if (!clubId) return { error: 'Mangler klubb.' }

  const parsedCountry = parseClubCountry(formData.get('country'))
  if ('error' in parsedCountry) return { error: parsedCountry.error }
  const parsedVat = parseVatPercent(formData.get('ticket_vat_percent'))
  if ('error' in parsedVat) return { error: parsedVat.error }

  const db = createAdminClient()
  const { data: club } = await db.from('clubs').select('country, stripe_account_id').eq('id', clubId).maybeSingle()
  if (!club) return { error: 'Fant ikke klubben.' }

  if (club.stripe_account_id && club.country !== parsedCountry.country) {
    return { error: 'Landet kan ikke endres etter at Stripe-kontoen er opprettet.' }
  }

  // Bytter landet før Stripe er koblet, følger valutaen med: en dansk konto
  // med NOK som standardvaluta avvises av Stripe eller selger i feil valuta.
  const countryChanged = club.country !== parsedCountry.country
  const { error } = await db
    .from('clubs')
    .update({
      country: parsedCountry.country,
      ticket_vat_bps: parsedVat.bps,
      ...(countryChanged ? { currency: defaultCurrencyFor(parsedCountry.country) } : {}),
    })
    .eq('id', clubId)

  if (error) return { error: 'Kunne ikke lagre land og moms.' }

  revalidatePath(`/superadmin/clubs/${clubId}`)
  revalidatePath('/superadmin/clubs')
  revalidatePath('/admin-app/finances')
}

// ─────────────────────────────────────────────────────────────
// Add admin to club (by email)
// ─────────────────────────────────────────────────────────────
/**
 * Finnes det ingen bruker med adressen, lages den her — samme vei som ved
 * opprettelsen av klubben. Før stoppet det med «brukeren må registrere seg
 * først», og det fantes ingen side der en klubb kunne gjøre det.
 */
export async function addClubAdminAction(formData: FormData) {
  await assertSuperadmin()
  const clubId = String(formData.get('club_id') ?? '')
  const email = String(formData.get('email') ?? '').trim().toLowerCase()

  // Meldingene returneres, ikke kastes: Next fjerner teksten fra kastede feil
  // i produksjon.
  if (!clubId) return { error: 'Mangler klubb.' }
  if (!email) return { error: 'E-post er påkrevd.' }

  const db = createAdminClient()
  const { data: club } = await db.from('clubs').select('id, name').eq('id', clubId).maybeSingle()
  if (!club) return { error: 'Fant ikke klubben.' }

  const { data: membership } = await db
    .from('club_memberships')
    .select('id, profiles!inner(email)')
    .eq('club_id', clubId)
    .eq('profiles.email', email)
    .maybeSingle()
  if (membership) return { error: 'Denne brukeren er allerede admin for klubben.' }

  try {
    const admin = await provisionClubAdmin({ clubId, clubName: club.name, email })
    revalidatePath(`/superadmin/clubs/${clubId}`)
    revalidatePath('/superadmin/overview')
    if (!admin.emailSent) {
      return { error: `${email} har fått tilgang, men e-posten gikk ikke ut (${admin.emailError ?? 'ukjent feil'}). Be dem bruke «Glemt passord».` }
    }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    await recordError('club_onboarding', cause, { club_id: clubId, email })
    return { error: message }
  }
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
