'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertRequirementAccess, assertShowAccess } from '@/lib/club-auth'
import { clubIdForShow } from '@/lib/club-artists'
import { runAutomaticBookingForShow, sendManualBookingOffer, startAutoBooking } from '@/lib/actions/booking'
import { runAfterResponse } from '@/lib/background'
import { ensureClubArtistForApplicant } from '@/lib/applicant-offers'
import type { SubmissionStatus, SubmissionsAudience } from '@/types/database'

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

/**
 * «Suggest line-up based on submissions» (migrasjon 101). Samme kolonne bak
 * avkrysningen på Submissions- og Lineup-fanen, så de alltid står likt.
 *
 * Ingenting sendes når den skrus på: forslaget vises først i «Suggest line-up
 * now», og bookeren bekrefter før noe går ut.
 */
export async function setSuggestFromSubmissionsAction(input: { showId: string; enabled: boolean }) {
  const showId = String(input.showId ?? '')
  await assertShowAccess(showId)

  const db = createAdminClient()
  const { error } = await db
    .from('shows')
    .update({ suggest_from_submissions: Boolean(input.enabled) })
    .eq('id', showId)

  if (error) return { ok: false as const, error: 'Could not save the setting. Try again.' }

  // En plass som ble åpnet for søknader mens showet var i gang, har fortsatt
  // sin gamle dag 1. Uten nullstilling ville motoren tatt den opp igjen på
  // dag 6 og sendt hele kvoten på én gang — uten at bookeren har sagt ja.
  // Nå står den som ikke startet, og fylles først fra «Fill the remaining
  // spots» etter forslaget.
  if (input.enabled) {
    const { error: resetError } = await db
      .from('show_requirements')
      .update({ auto_started_at: null })
      .eq('show_id', showId)
      .eq('submissions_open', true)
    if (resetError) console.error(`[Submissions] Could not reset spots on show ${showId}: ${resetError.message}`)
  }
  revalidateShow(showId)
  return { ok: true as const }
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

  // Åpner bookeren plassen, skal motoren holde seg unna — derfor ingen
  // kjøring her. Se `bookShow()`.
  //
  // Lukker hen den, er det motstatt: nå er det motoren som skal fylle
  // plassen, og bølgen begynner å telle. Uten dette ble en plass som var
  // åpen for søknader da bookingen startet, stående uten `auto_started_at`
  // for alltid — motoren så den aldri igjen, og plassen kunne bare fylles
  // for hånd.
  if (!open) {
    await startAutoBooking(showId, requirementId, { restart: true })
    runAfterResponse(`submissions-closed-${requirementId}`, async () => {
      await runAutomaticBookingForShow(showId)
      revalidateShow(showId)
    })
  }

  revalidateShow(showId)
}

// ─── Søknadsfanen ─────────────────────────────────────────────────────────────

/** Søknader bookeren fortsatt kan ta stilling til. */
const OPEN_SUBMISSION_STATUSES: SubmissionStatus[] = ['pending', 'shortlisted']

function revalidateSubmission(showId: string) {
  revalidateShow(showId)
  revalidatePath('/artist-app/open-spots')
}

/**
 * Søknaden, men bare for en booker som har tilgang til plassen den gjelder.
 * Id-en kommer fra skjemaet, så showet leses av raden — ikke av skjemaet.
 */
async function loadSubmissionForBooker(formData: FormData) {
  const submissionId = String(formData.get('submission_id') ?? '')
  if (!submissionId) throw new Error('The application is missing.')

  const db = createAdminClient()
  const { data: submission, error } = await db
    .from('show_submissions')
    .select('id, show_id, show_requirement_id, artist_id, status')
    .eq('id', submissionId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!submission) throw new Error('This application no longer exists.')

  await assertShowAccess(submission.show_id)
  return { db, submission }
}

/**
 * Bookeren godtar søknaden og velger plassen: et vanlig tilbud går ut for
 * den plassen, og komikeren svarer på det som på alle andre tilbud. Her
 * slutter søknaden. Komikeren søkte på showet, ikke plassen — plassen er
 * klubbens valg (prosjektleder, 2026-11-15).
 *
 * Søknaden låses først (`pending` → `accepted` med vilkår på status), så to
 * klikk — eller to bookere — ikke sender to tilbud. Feiler tilbudet, settes
 * den tilbake.
 *
 * Et show åpent for «Everyone» slipper inn komikere klubben ikke har knyttet
 * til seg, og tilbud kan bare gå til klubbens egne. Å godta en slik søknad er
 * å si ja til komikeren, så koblingen lages her, med rollen hen søkte på.
 */
export async function approveSubmissionAction(formData: FormData): Promise<{ artistName: string }> {
  const { db, submission } = await loadSubmissionForBooker(formData)
  const { show_id: showId, artist_id: artistId } = submission
  const requirementId = String(formData.get('show_requirement_id') ?? '')
  if (!requirementId) throw new Error('Pick the spot to offer.')
  await assertRequirementAccess(showId, requirementId)

  if (!OPEN_SUBMISSION_STATUSES.includes(submission.status)) {
    throw new Error('This application has already been handled.')
  }

  const { data: claimed, error: claimError } = await db
    .from('show_submissions')
    .update({ status: 'accepted', responded_at: new Date().toISOString(), show_requirement_id: requirementId })
    .eq('id', submission.id)
    .in('status', OPEN_SUBMISSION_STATUSES)
    .select('id')

  if (claimError) throw new Error(claimError.message)
  if (!claimed?.length) throw new Error('This application has already been handled.')

  const clubId = await clubIdForShow(db, showId)
  let connectedHere = false

  try {
    if (!clubId) throw new Error('This show is not connected to a club, so no comedians can be booked for it.')

    const { data: requirement } = await db
      .from('show_requirements')
      .select('role_name')
      .eq('id', requirementId)
      .single()
    connectedHere = await ensureClubArtistForApplicant(db, {
      clubId,
      artistId,
      roleName: requirement?.role_name ?? null,
    })

    // Har bookeren tidligere tatt komikeren av dette showet, er et ja nå et
    // nytt valg — samme opprydding som «Send offer…» gjør.
    await db.from('show_artist_booking_exclusions').delete().eq('show_id', showId).eq('artist_id', artistId)

    const { offerId: token, artistName } = await sendManualBookingOffer(showId, artistId, requirementId)

    const { data: offer } = await db.from('booking_offers').select('id').eq('token', token).maybeSingle()
    if (offer) {
      await db.from('show_submissions').update({ booking_offer_id: offer.id }).eq('id', submission.id)
    }

    revalidateSubmission(showId)
    revalidatePath('/admin-app/bookings')
    return { artistName }
  } catch (error) {
    await db
      .from('show_submissions')
      .update({ status: submission.status, responded_at: null, show_requirement_id: null })
      .eq('id', submission.id)

    if (connectedHere && clubId) {
      await db.from('club_artists').delete().eq('club_id', clubId).eq('artist_id', artistId)
    }

    throw error
  }
}

/**
 * Bookeren sier nei. Ingen e-post går ut — komikeren ser svaret under
 * «Open spots», og et nei skal ikke lande i innboksen som en avvisning.
 */
export async function declineSubmissionAction(formData: FormData) {
  const { db, submission } = await loadSubmissionForBooker(formData)

  const { data, error } = await db
    .from('show_submissions')
    .update({ status: 'declined', responded_at: new Date().toISOString(), show_requirement_id: null })
    .eq('id', submission.id)
    .in('status', OPEN_SUBMISSION_STATUSES)
    .select('id')

  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('This application has already been handled.')

  revalidateSubmission(submission.show_id)
}

/**
 * Angrer et nei. Bare et nei: en godtatt søknad har blitt et tilbud, og det
 * trekkes tilbake i lineupen, ikke her.
 */
export async function reopenSubmissionAction(formData: FormData) {
  const { db, submission } = await loadSubmissionForBooker(formData)

  const { data, error } = await db
    .from('show_submissions')
    .update({ status: 'pending', responded_at: null })
    .eq('id', submission.id)
    .eq('status', 'declined')
    .select('id')

  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Only a declined application can be reopened.')

  revalidateSubmission(submission.show_id)
}
