'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertRequirementAccess, assertShowAccess } from '@/lib/club-auth'
import type { SubmissionsAudience } from '@/types/database'

/**
 * Handlingene bak «Open for submissions».
 *
 * Ligger her og ikke i `shows/actions.ts` fordi de samme handlingene skal
 * nås fra to hold: bookerens lineup-fane, og senere søknadsfanen. Fila i
 * `app/` er allerede 1200 linjer.
 *
 * Delingen mellom de to nivåene er den samme overalt:
 *   shows.submissions_audience    hvem som får søke — én policy per show
 *   shows.submissions_close_at    når det stenger — samme sted, samme grunn
 *   show_requirements.submissions_open  hvilke plasser som faktisk er åpne
 */

function isAudience(value: unknown): value is SubmissionsAudience {
  return value === 'roster' || value === 'everyone'
}

/**
 * Datoen kommer fra et `<input type="date">`, altså «2025-10-02» i
 * nettleserens egen tidssone-frie form. Vi lagrer slutten av dagen, ikke
 * starten: setter bookeren fristen til showdagen, mener hen «ut den dagen»,
 * ikke «midnatt, altså i går kveld».
 */
function endOfDayIso(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null

  const parsed = new Date(`${text}T23:59:59`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('The deadline is not a valid date.')
  }

  return parsed.toISOString()
}

function revalidateShow(showId: string) {
  revalidatePath(`/admin-app/shows/${showId}`)
}

/** Hvem som får søke på showets åpne plasser. */
export async function setSubmissionsAudienceAction(formData: FormData) {
  const showId = String(formData.get('show_id') ?? '')
  const audience = formData.get('submissions_audience')

  await assertShowAccess(showId)

  if (!isAudience(audience)) {
    throw new Error('Pick who is allowed to apply.')
  }

  const { error } = await createAdminClient()
    .from('shows')
    .update({ submissions_audience: audience })
    .eq('id', showId)

  if (error) throw new Error(error.message)
  revalidateShow(showId)
}

/**
 * Søknadsfristen. Tom verdi fjerner den.
 *
 * Fristen stenger bare *nye* søknader. De som allerede ligger der behandles
 * som før — ellers ville en frist gjort bookerens egen liste ubrukelig i det
 * øyeblikket den passerte.
 */
export async function setSubmissionsDeadlineAction(formData: FormData) {
  const showId = String(formData.get('show_id') ?? '')
  await assertShowAccess(showId)

  const closeAt = endOfDayIso(formData.get('submissions_close_at'))

  const { error } = await createAdminClient()
    .from('shows')
    .update({ submissions_close_at: closeAt })
    .eq('id', showId)

  if (error) throw new Error(error.message)
  revalidateShow(showId)
}

/**
 * Åpner eller lukker én lineup-plass for søknader.
 *
 * Lukking rører ikke søknadene som ligger der. Bookeren skal kunne stenge
 * tilgangen og fortsatt behandle dem hen allerede har fått.
 */
export async function toggleRequirementSubmissionsAction(formData: FormData) {
  const showId = String(formData.get('show_id') ?? '')
  const requirementId = String(formData.get('req_id') ?? '')
  const open = String(formData.get('submissions_open') ?? '') === 'true'

  await assertRequirementAccess(showId, requirementId)

  const { error } = await createAdminClient()
    .from('show_requirements')
    .update({ submissions_open: open })
    .eq('id', requirementId)
    .eq('show_id', showId)

  if (error) throw new Error(error.message)

  // Ingen `scheduleShowAutomation` her, med vilje: en åpnet plass skal
  // nettopp *ikke* bookes av motoren. Se `bookShow()`.
  revalidateShow(showId)
}
