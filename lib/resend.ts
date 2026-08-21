import { Resend } from 'resend'

export const resend = new Resend(process.env.RESEND_API_KEY || 're_missing')

export const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? 'noreply@example.com'

/**
 * Avsendernavn med klubbens navn foran vår adresse.
 *
 * Klubben er selger av billetten — da skal den også stå som avsender av den.
 * Adressen forblir vår, siden det er den som er verifisert hos Resend.
 */
export function fromWithName(displayName: string | null | undefined) {
  const trimmed = displayName?.replace(/["<>\\]/g, '').trim()
  if (!trimmed) return FROM_EMAIL

  const address = FROM_EMAIL.match(/<([^>]+)>/)?.[1] ?? FROM_EMAIL
  return `${trimmed} <${address}>`
}
