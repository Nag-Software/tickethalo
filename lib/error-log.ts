import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Feil appen melder fra om selv.
 *
 * console.error havner i Vercel-loggen, som ruller ut etter noen dager og
 * som ingen ser uten å lete. En kunde som ikke fikk billetten sin var
 * usynlig til hen skrev til oss. `recordError` logger som før *og* skriver
 * raden til `app_errors` (migrasjon 069), der superadmin ser den og
 * kvitterer den ut.
 *
 * Det som meldes er det som trenger et menneske: et kjøp som ikke ble
 * fullført, en billettepost som ikke gikk, en webhook som feilet, en
 * cron-jobb som stoppet. Ikke kundens egne feil (utsolgt, salget stengt);
 * de er svar, ikke feil.
 *
 * Funksjonen kaster aldri. En feil i feilloggen skal ikke velte det som
 * allerede gikk galt, og den skal aldri være grunnen til at et kjøp feiler.
 * Innsettingen ventes på: på Vercel kan en funksjon avsluttes før et
 * løfte ingen venter på rekker fram.
 */

export type ErrorScope = 'checkout' | 'free_tickets' | 'ticket_email' | 'stripe_webhook' | 'cron' | (string & {})

/** Stack og kontekst kappes, så én feil ikke kan fylle tabellen. */
const MAX_STACK_LENGTH = 4000
const MAX_CONTEXT_LENGTH = 4000

export type ErrorRecord = {
  scope: string
  message: string
  stack: string | null
  context: Record<string, unknown>
}

/** Det som faktisk skrives. Egen funksjon så den kan testes uten database. */
export function describeError(scope: ErrorScope, error: unknown, context: Record<string, unknown> = {}): ErrorRecord {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error && error.stack ? error.stack.slice(0, MAX_STACK_LENGTH) : null

  // Kontekst skal være JSON. Noe som ikke lar seg serialisere (sykliske
  // objekter, BigInt) erstattes med en streng, så raden skrives uansett.
  let serialised: Record<string, unknown>
  try {
    const json = JSON.stringify(context)
    serialised = json.length > MAX_CONTEXT_LENGTH ? { truncated: json.slice(0, MAX_CONTEXT_LENGTH) } : JSON.parse(json)
  } catch {
    serialised = { unserialisable: String(context) }
  }

  return { scope, message: message || 'Unknown error', stack, context: serialised }
}

export async function recordError(scope: ErrorScope, error: unknown, context: Record<string, unknown> = {}): Promise<void> {
  const record = describeError(scope, error, context)
  const contextText = Object.entries(record.context)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ')
  console.error(`[${record.scope}] ${record.message}${contextText ? ` ${contextText}` : ''}`)

  try {
    const { error: insertError } = await createAdminClient().from('app_errors').insert(record)
    if (insertError) console.error(`[error-log] Could not record the error: ${insertError.message}`)
  } catch (insertError) {
    const message = insertError instanceof Error ? insertError.message : String(insertError)
    console.error(`[error-log] Could not record the error: ${message}`)
  }
}
