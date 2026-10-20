import { createAdminClient } from '@/lib/supabase/admin'
import { isUnsubscribeToken } from './unsubscribe'

/**
 * Oppslag og endring på token, for avmeldingssiden og one-click-ruten.
 *
 * Tokenen er den eneste nøkkelen: siden er åpen for alle med lenken, uten
 * innlogging. Den kan derfor bare melde av og på igjen — aldri vise mer om
 * personen enn klubbnavnet og en maskert adresse.
 */

export type UnsubscribeTarget = {
  email: string
  clubName: string
  unsubscribedAt: string | null
}

export async function findUnsubscribeTarget(token: string): Promise<UnsubscribeTarget | null> {
  if (!isUnsubscribeToken(token)) return null
  const db = createAdminClient()
  const { data: contact } = await db
    .from('club_contacts')
    .select('email, club_id, unsubscribed_at')
    .eq('unsubscribe_token', token)
    .maybeSingle()
  if (!contact) return null

  const { data: club } = await db.from('clubs').select('name').eq('id', contact.club_id).maybeSingle()
  return { email: contact.email, clubName: club?.name ?? 'the organiser', unsubscribedAt: contact.unsubscribed_at }
}

/** Idempotent: en som allerede er avmeldt, beholder datoen fra første gang. */
export async function setUnsubscribed(token: string, unsubscribed: boolean): Promise<boolean> {
  if (!isUnsubscribeToken(token)) return false
  const db = createAdminClient()
  const query = db
    .from('club_contacts')
    .update({ unsubscribed_at: unsubscribed ? new Date().toISOString() : null })
    .eq('unsubscribe_token', token)
  const { data, error } = await (unsubscribed ? query.is('unsubscribed_at', null) : query).select('id')
  if (error) {
    console.error(`[Unsubscribe] Could not update contact: ${error.message}`)
    return false
  }
  if ((data?.length ?? 0) > 0) return true
  // Ingen rad endret: enten allerede i den tilstanden, eller ukjent token.
  return (await findUnsubscribeTarget(token)) !== null
}
