'use server'

import { revalidatePath } from 'next/cache'
import { checkInByCode } from '../../scanner/actions'

/**
 * Innsjekking fra verifiseringssiden — samme handling som skanneren gjør,
 * bare med skjemaet som inngang. Tilgangssjekken ligger i `checkInByCode`.
 */
export async function checkInFromVerifyAction(formData: FormData): Promise<{ error?: string } | void> {
  const showId = String(formData.get('show_id') ?? '')
  const code = String(formData.get('code') ?? '')
  if (!showId || !code) return { error: 'The ticket is missing.' }

  const result = await checkInByCode(showId, code)

  revalidatePath(`/admin-app/tickets/verify`)

  if ('notFound' in result) return { error: 'The ticket does not exist for this show.' }
  if ('alreadyUsed' in result) return { error: 'This ticket was already checked in.' }
  if ('invalid' in result) return { error: `The ticket is ${result.status}.` }
}
