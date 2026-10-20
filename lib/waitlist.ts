import { createAdminClient } from '@/lib/supabase/admin'
import { appPath } from '@/lib/app-url'
import { sendWaitlistSpotOpenEmail } from '@/lib/email/mailer'
import { OPEN_SUBMISSION_STATUSES, showClosedReason, spotAvailability } from '@/lib/open-spots'

/**
 * Når en komiker faller fra en plass som har venteliste.
 *
 * Ventelisten er ubesvarte søknader på en full plass (lib/open-spots.ts).
 * Plasser som er åpne for søknader holder motoren seg unna, så ingen andre
 * fyller setet når noen faller fra — klubben velger selv fra ventelisten
 * (eierens valg, 2026-10-20). Søknadene blir godkjennbare av seg selv i det
 * setet er ledig; denne e-posten er det som får bookeren til å se dem.
 */

type Db = ReturnType<typeof createAdminClient>

export type WaitlistNotice =
  | { sent: number }
  | { skipped: 'missing' | 'not_open' | 'show_closed' | 'still_full' | 'empty' | 'no_club' }

export async function notifyClubWaitlist(
  requirementId: string,
  db: Db = createAdminClient(),
): Promise<WaitlistNotice> {
  const { data: requirement } = await db
    .from('show_requirements')
    .select('id, show_id, role_name, quantity, submissions_open')
    .eq('id', requirementId)
    .maybeSingle()

  if (!requirement) return { skipped: 'missing' }
  // En plass som ikke er åpen for søknader fylles av motoren. Der finnes det
  // ingen venteliste å si fra om.
  if (!requirement.submissions_open) return { skipped: 'not_open' }

  const { data: show } = await db
    .from('shows')
    .select('id, title, date, status, club_id, submissions_close_at')
    .eq('id', requirement.show_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (!show) return { skipped: 'missing' }
  // Fristen gjelder nye søknader, ikke dem som står der. Bare status og dato
  // avgjør om det er noe å fylle.
  if (showClosedReason({ ...show, submissions_close_at: null })) return { skipped: 'show_closed' }
  if (!show.club_id) return { skipped: 'no_club' }

  const [{ count: filled }, { data: waiting }] = await Promise.all([
    db.from('confirmed_spots')
      .select('*', { count: 'exact', head: true })
      .eq('show_requirement_id', requirement.id)
      .in('status', ['confirmed', 'completed', 'paid']),
    db.from('show_submissions')
      .select('artist_id')
      .eq('show_requirement_id', requirement.id)
      .in('status', OPEN_SUBMISSION_STATUSES)
      .order('created_at'),
  ])

  if (spotAvailability({ quantity: requirement.quantity, filled: filled ?? 0 }).waitlist) {
    return { skipped: 'still_full' }
  }
  if (!waiting?.length) return { skipped: 'empty' }

  const artistIds = waiting.map((row) => row.artist_id)
  const [{ data: artists }, { data: memberships }] = await Promise.all([
    db.from('artists').select('id, full_name, stage_name').in('id', artistIds),
    db.from('club_memberships').select('profile_id').eq('club_id', show.club_id),
  ])

  const nameById = new Map((artists ?? []).map((artist) => [artist.id, artist.stage_name?.trim() || artist.full_name]))
  const names = artistIds.flatMap((id) => nameById.get(id) ?? [])

  const profileIds = (memberships ?? []).map((row) => row.profile_id)
  const { data: members } = profileIds.length > 0
    ? await db.from('profiles').select('email, full_name').in('id', profileIds)
    : { data: [] as Array<{ email: string; full_name: string | null }> }

  const recipients = [
    ...new Map((members ?? []).filter((member) => member.email).map((member) => [member.email.toLowerCase(), member])).values(),
  ]

  let sent = 0
  for (const member of recipients) {
    const delivery = await sendWaitlistSpotOpenEmail({
      email: member.email,
      full_name: member.full_name,
      show_title: show.title,
      show_date: show.date,
      role_name: requirement.role_name,
      waitlist: names,
      submissions_url: appPath(`/admin-app/shows/${show.id}?tab=submissions`),
    })
    if (delivery.success) sent++
  }

  if (recipients.length > 0 && sent === 0) {
    console.error(`[Waitlist] Spot-open notice for requirement ${requirement.id} reached nobody (${recipients.length} recipients)`)
  }

  return { sent }
}
