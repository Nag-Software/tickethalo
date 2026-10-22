'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { getAuthUser, getSessionProfile } from '@/lib/session'
import {
  IMPORT_CHUNK_SIZE,
  cleanName,
  cleanPhone,
  importAdsConsentStatement,
  importConsentStatement,
  importMayGrantAds,
  isValidEmail,
  normalizeEmail,
  type ImportRow,
  type SkippedRow,
} from '@/lib/marketing/contacts'
import { chunk } from '@/lib/email/bulk'

/**
 * Klubbens e-postliste: import og sletting.
 *
 * Feil returneres som `{ error }` i stedet for å kastes: Next skjuler
 * meldingen i en kastet feil i produksjon, og klubben skal kunne lese hvorfor.
 */

export type ImportChunkResult =
  | {
      importId: string
      added: number
      updated: number
      alreadyOnList: number
      /** Fikk annonsesamtykke i denne biten — nye og eksisterende. */
      adsGranted: number
      skipped: SkippedRow[]
    }
  | { error: string }

async function currentProfileId() {
  const user = await getAuthUser()
  if (!user) return null
  return (await getSessionProfile(user.id))?.id ?? null
}

/**
 * Én bit av en import (opptil IMPORT_CHUNK_SIZE rader).
 *
 * Første bit lager importraden, og krever at klubben har krysset av for
 * samtykket — det er den avkrysningen som er grunnlaget for å sende. Resten
 * av bitene viser til samme import.
 *
 * - Ny adresse: legges til, med importen som samtykkekilde.
 * - Står på lista: navn og telefon fylles der de mangler; samtykket røres ikke.
 * - Har meldt seg av: hoppes over. En import skal aldri melde noen på igjen.
 *
 * Har klubben også bekreftet annonsesamtykke (lagret på importen), får nye
 * kontakter det, og eksisterende som ikke har det og ikke har trukket det
 * tilbake (`importMayGrantAds`). Bekreftelsen leses fra importraden, ikke fra
 * hver bit — det er den klubben krysset av for som gjelder.
 */
export async function importContactsAction(input: {
  importId: string | null
  fileName: string | null
  consentConfirmed: boolean
  adsConsentConfirmed?: boolean
  rowsTotal: number
  skippedInFile: number
  rows: ImportRow[]
}): Promise<ImportChunkResult> {
  try {
    const clubId = await getDefaultClubIdForAdmin()
    const db = createAdminClient()

    if (!Array.isArray(input.rows) || input.rows.length > IMPORT_CHUNK_SIZE) {
      return { error: `Send at most ${IMPORT_CHUNK_SIZE} rows at a time.` }
    }

    const { data: club } = await db.from('clubs').select('id, name').eq('id', clubId).maybeSingle()
    if (!club) return { error: 'Club not found.' }

    let importId = input.importId
    let adsStatement: string | null = null
    if (importId) {
      const { data: existing } = await db
        .from('club_contact_imports')
        .select('id, ads_consent_statement')
        .eq('id', importId)
        .eq('club_id', clubId)
        .maybeSingle()
      if (!existing) return { error: 'This import was not found. Start again.' }
      adsStatement = existing.ads_consent_statement
    } else {
      if (input.consentConfirmed !== true) {
        return { error: 'Confirm that these people have agreed to receive emails from you.' }
      }
      adsStatement = input.adsConsentConfirmed === true ? importAdsConsentStatement(club.name) : null
      const { data: created, error } = await db
        .from('club_contact_imports')
        .insert({
          club_id: clubId,
          imported_by: await currentProfileId(),
          file_name: input.fileName?.slice(0, 200) ?? null,
          consent_statement: importConsentStatement(club.name),
          ads_consent_statement: adsStatement,
          rows_total: Math.max(0, Math.floor(Number(input.rowsTotal) || 0)),
          skipped: Math.max(0, Math.floor(Number(input.skippedInFile) || 0)),
        })
        .select('id')
        .single()
      if (error || !created) return { error: `Could not start the import: ${error?.message ?? 'unknown error'}` }
      importId = created.id
    }

    // Nettleseren har sjekket radene, men det er den som sendte dem. Samme
    // regler en gang til, her.
    const rows = new Map<string, ImportRow>()
    for (const row of input.rows) {
      const email = normalizeEmail(row?.email)
      if (!isValidEmail(email) || rows.has(email)) continue
      rows.set(email, { line: Number(row.line) || 0, email, name: cleanName(row.name), phone: cleanPhone(row.phone) })
    }

    // Oppslaget i biter: `in()` blir en URL, og tusen adresser er for langt.
    type Existing = {
      id: string
      name: string | null
      phone: string | null
      unsubscribed_at: string | null
      ads_consent_at: string | null
      ads_withdrawn_at: string | null
    }
    const existing = new Map<string, Existing>()
    for (const emails of chunk([...rows.keys()], 200)) {
      const { data, error } = await db
        .from('club_contacts')
        .select('id, email, name, phone, unsubscribed_at, ads_consent_at, ads_withdrawn_at')
        .eq('club_id', clubId)
        .in('email', emails)
      if (error) return { error: `Could not read your list: ${error.message}` }
      for (const contact of data ?? []) existing.set(contact.email, contact)
    }

    const consentAt = new Date().toISOString()
    const statement = importConsentStatement(club.name)
    const adsFields = adsStatement
      ? {
          ads_consent_at: consentAt,
          ads_consent_source: 'import' as const,
          ads_consent_text: adsStatement,
          ads_consent_import_id: importId,
        }
      : null
    const toInsert: ImportRow[] = []
    const skipped: SkippedRow[] = []
    let updated = 0
    let alreadyOnList = 0
    let adsGranted = 0

    for (const row of rows.values()) {
      const contact = existing.get(row.email)
      if (!contact) {
        toInsert.push(row)
        continue
      }
      if (contact.unsubscribed_at) {
        skipped.push({ line: row.line, value: row.email, reason: 'unsubscribed' })
        continue
      }
      const grantAds = adsFields !== null && importMayGrantAds(contact)
      const patch = {
        ...(contact.name ? {} : row.name ? { name: row.name } : {}),
        ...(contact.phone ? {} : row.phone ? { phone: row.phone } : {}),
        ...(grantAds && adsFields ? adsFields : {}),
      }
      if (Object.keys(patch).length === 0) {
        alreadyOnList += 1
        continue
      }
      const { error } = await db.from('club_contacts').update(patch).eq('id', contact.id)
      if (error) return { error: `Could not update ${row.email}: ${error.message}` }
      updated += 1
      if (grantAds) adsGranted += 1
    }

    let added = 0
    if (toInsert.length > 0) {
      // `ignoreDuplicates`: en kontakt som kom inn via et kjøp mens importen
      // pågikk, skal ikke overskrives av den.
      const { data, error } = await db
        .from('club_contacts')
        .upsert(
          toInsert.map((row) => ({
            club_id: clubId,
            email: row.email,
            name: row.name,
            phone: row.phone,
            source: 'import' as const,
            consent_at: consentAt,
            consent_text: statement,
            consent_import_id: importId,
            ...(adsFields ?? {}),
          })),
          { onConflict: 'club_id,email', ignoreDuplicates: true },
        )
        .select('id')
      if (error) return { error: `Could not add contacts: ${error.message}` }
      added = data?.length ?? 0
      alreadyOnList += toInsert.length - added
      if (adsFields) adsGranted += added
    }

    const { data: totals } = await db
      .from('club_contact_imports')
      .select('added, updated, skipped')
      .eq('id', importId)
      .single()
    await db
      .from('club_contact_imports')
      .update({
        added: (totals?.added ?? 0) + added,
        updated: (totals?.updated ?? 0) + updated,
        skipped: (totals?.skipped ?? 0) + skipped.length,
      })
      .eq('id', importId)

    revalidatePath('/admin-app/marketing')
    return { importId, added, updated, alreadyOnList, adsGranted, skipped }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The import failed. Please try again.' }
  }
}

/**
 * Sletter en kontakt helt — for når noen ber om å bli slettet (GDPR art. 17).
 * Vil personen bare ikke ha e-post, er avmelding riktig: da står adressen
 * igjen og hindrer at en senere import legger den inn på nytt.
 */
export async function deleteContactAction(formData: FormData): Promise<{ error: string } | { ok: true }> {
  try {
    const clubId = await getDefaultClubIdForAdmin()
    const contactId = String(formData.get('contact_id') ?? '')
    if (!contactId) return { error: 'Missing contact.' }

    const { error } = await createAdminClient()
      .from('club_contacts')
      .delete()
      .eq('id', contactId)
      .eq('club_id', clubId)
    if (error) return { error: `Could not delete the contact: ${error.message}` }

    revalidatePath('/admin-app/marketing')
    return { ok: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not delete the contact.' }
  }
}

/** Avmelder på klubbens vegne — når noen ber om det på telefon eller e-post. */
export async function unsubscribeContactAction(formData: FormData): Promise<{ error: string } | { ok: true }> {
  try {
    const clubId = await getDefaultClubIdForAdmin()
    const contactId = String(formData.get('contact_id') ?? '')
    if (!contactId) return { error: 'Missing contact.' }

    const { error } = await createAdminClient()
      .from('club_contacts')
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('club_id', clubId)
      .is('unsubscribed_at', null)
    if (error) return { error: `Could not unsubscribe the contact: ${error.message}` }

    revalidatePath('/admin-app/marketing')
    return { ok: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not unsubscribe the contact.' }
  }
}

/**
 * Trekker annonsesamtykket på klubbens vegne — når noen ber om å slippe
 * annonsene, men vil ha e-postene. Kontakten blir ikke med i neste Meta-eksport.
 */
export async function stopAdsContactAction(formData: FormData): Promise<{ error: string } | { ok: true }> {
  try {
    const clubId = await getDefaultClubIdForAdmin()
    const contactId = String(formData.get('contact_id') ?? '')
    if (!contactId) return { error: 'Missing contact.' }

    const { error } = await createAdminClient()
      .from('club_contacts')
      .update({ ads_withdrawn_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('club_id', clubId)
      .not('ads_consent_at', 'is', null)
      .is('ads_withdrawn_at', null)
    if (error) return { error: `Could not stop ads for the contact: ${error.message}` }

    revalidatePath('/admin-app/marketing')
    return { ok: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not stop ads for the contact.' }
  }
}
