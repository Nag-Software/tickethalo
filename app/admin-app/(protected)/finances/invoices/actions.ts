'use server'

import { revalidatePath } from 'next/cache'
import { getDefaultClubIdForAdmin } from '@/lib/club-auth'
import { getAuthUser, getSessionProfile } from '@/lib/session'
import { setFeeInvoiceStatus } from '@/lib/fee-invoices'
import { resendFeeInvoiceEmail } from '@/lib/artist-fees'
import type { ArtistFeeInvoiceStatus } from '@/types/database'

const PATH = '/admin-app/finances/invoices'
const STATUSES: ArtistFeeInvoiceStatus[] = ['issued', 'received', 'approved', 'paid', 'rejected']

/**
 * Setter status på et fakturagrunnlag.
 *
 * Klubben kommer fra innloggingen, ikke fra skjemaet: en klubb-ID i et felt
 * ville latt hvem som helst kvittere ut en annen klubbs honorarer. Hvem som
 * trykket lagres med — et beløp som er klarert til utbetaling skal ha et navn
 * på seg, og «betalt» er statusen som stenger referansen mot dubletter.
 *
 * Handlingen returnerer `{ error }` i stedet for å kaste, slik resten av
 * finanssiden gjør: Next skjuler meldingen fra kastede feil i produksjon.
 */
export async function setFeeInvoiceStatusAction(formData: FormData): Promise<{ error: string } | undefined> {
  try {
    const id = formData.get('id')
    const status = formData.get('status')
    const rawNote = formData.get('note')
    const note = typeof rawNote === 'string' ? rawNote.trim() : null

    if (typeof id !== 'string' || !id) return { error: 'Missing invoice.' }
    // Statusen kommer fra en knapp, men check-constrainten i databasen avviser
    // bare med en rå Postgres-feil — vi stopper den her i stedet.
    if (typeof status !== 'string' || !STATUSES.includes(status as ArtistFeeInvoiceStatus)) {
      return { error: 'Unknown status.' }
    }

    const clubId = await getDefaultClubIdForAdmin()
    const user = await getAuthUser()
    const profile = user ? await getSessionProfile(user.id) : null

    await setFeeInvoiceStatus({
      id,
      clubId,
      status: status as ArtistFeeInvoiceStatus,
      handledBy: profile?.id ?? null,
      ...(note ? { note } : {}),
    })

    revalidatePath(PATH)
    revalidatePath('/admin-app/finances')
  } catch (error) {
    console.error('[FeeInvoices]', error)
    return { error: 'Could not update the invoice. Try again in a moment.' }
  }
}

/**
 * Sender fakturagrunnlaget til komikeren på nytt.
 *
 * Samme referanse og samme beløp — det er den samme regningen, ikke en ny.
 * Klubben kommer fra innloggingen, som over: et grunnlag som ikke er klubbens
 * finnes ikke herfra.
 */
export async function resendFeeInvoiceAction(formData: FormData): Promise<{ error: string } | undefined> {
  try {
    const id = formData.get('id')
    if (typeof id !== 'string' || !id) return { error: 'Missing invoice.' }

    const clubId = await getDefaultClubIdForAdmin()
    await resendFeeInvoiceEmail({ invoiceId: id, clubId })

    revalidatePath(PATH)
  } catch (error) {
    console.error('[FeeInvoices] resend', error)
    // Meldingene fra resendFeeInvoiceEmail er skrevet for å leses — «komikeren
    // har ingen e-postadresse» er noe klubben kan gjøre noe med.
    return { error: error instanceof Error ? error.message : 'Could not resend the email.' }
  }
}
