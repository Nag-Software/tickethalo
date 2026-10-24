import { isValidEmail } from '@/lib/email-address'
import { normalizeWhatsAppNumber } from '@/lib/whatsapp'
import type { Club } from '@/types/database'

/**
 * Klubbens kontakt for komikerne (ClickUp 869fm99be) — det lineupen ser som
 * «Club contact» i påminnelsen og i gruppechatten. Egen e-post og telefon,
 * fordi `support_email` står på kvitteringen til billettkjøperne, og den som
 * booker vil ofte nås et annet sted.
 *
 * Ingen Node-avhengigheter: både skjemaet og handlingen bruker den.
 */

/** E-posten lineupen ser. Tom kontakt-e-post = den billettkjøperne ser, som før. */
export function clubContactEmail(club: Pick<Club, 'contact_email' | 'support_email'>) {
  return club.contact_email?.trim() || club.support_email?.trim() || null
}

export type ClubContactInput = { email: string | null | undefined; phone: string | null | undefined }

export type ParsedClubContact =
  | { ok: true; contact_email: string | null; contact_phone: string | null }
  | { ok: false; error: string }

/**
 * Feltene fra My club, klare til å lagres. Telefonen tar det folk skriver —
 * `+47 912 34 567`, `0047…` eller bare `91234567` — og et nummer uten `+`
 * får klubbens landskode, +47 når landet mangler. Lagres som rene sifre.
 */
export function parseClubContact(input: ClubContactInput, country?: string | null): ParsedClubContact {
  const email = String(input.email ?? '').trim()
  if (email && !isValidEmail(email)) {
    return { ok: false, error: 'Enter a valid contact email, or leave it empty.' }
  }

  const phoneText = String(input.phone ?? '').trim()
  const phone = phoneText ? normalizeWhatsAppNumber(phoneText, country ?? 'NO') : null
  if (phoneText && !phone) {
    return { ok: false, error: 'Enter the contact phone with country code, like +47 912 34 567.' }
  }

  return { ok: true, contact_email: email || null, contact_phone: phone }
}
