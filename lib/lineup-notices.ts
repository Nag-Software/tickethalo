import { createAdminClient } from '@/lib/supabase/admin'
import { appPath } from '@/lib/app-url'
import { requirementFeeLabel } from '@/lib/booking-spots'
import { getOsloToday } from '@/lib/event-filters'
import {
  sendBookingConfirmedEmail,
  sendOfferWithdrawnByClubEmail,
  sendRemovedFromLineupEmail,
  sendShowCancelledEmail,
  type EmailResult,
} from '@/lib/email/mailer'
import { showVenue } from '@/lib/show-venue'

/**
 * Beskjedene komikeren får når klubben endrer noe hen regner med.
 *
 * Bookingflyten varslet bare det komikeren selv satte i gang: tilbud, ja, nei.
 * Alt klubben gjorde på egen hånd — slette showet, ta noen ut av lineupen,
 * trekke et tilbud, sette noen rett inn — skjedde i stillhet. Komikeren satt
 * igjen med en bekreftelse i innboksen og en kveld holdt av til ingenting.
 *
 * To regler gjelder alle beskjedene:
 *  - Et show som er spilt varsles aldri. Å rydde i fjorårets show skal ikke
 *    sende «showet er avlyst» til noen.
 *  - Utsendingen kaster aldri. Handlingen som utløste den er allerede gjort;
 *    en e-post som feiler logges (se `deliver` i lib/email/mailer.ts).
 */

type Db = ReturnType<typeof createAdminClient>

type NoticeShow = { title: string; date: string; clubName: string | null }

export type CancellationRecipient = {
  artistId: string
  email: string
  full_name: string
  /** true = sto i lineupen. false = hadde bare et tilbud som ikke var besvart. */
  booked: boolean
}

export type ShowCancellationNotice = NoticeShow & { recipients: CancellationRecipient[] }

/** Showdatoen er en ren dato; sammenlignes med dagen i dag i Oslo. */
export function isPlayedShow(showDate: string, today: string = getOsloToday()) {
  return showDate.slice(0, 10) < today
}

/**
 * Hvem som skal ha beskjed når et show forsvinner. Én e-post per komiker:
 * står hen både i lineupen og med et åpent tilbud, er det lineupen som teller.
 */
export function cancellationRecipients(
  bookedArtistIds: string[],
  offeredArtistIds: string[],
  artists: Array<{ id: string; email: string | null; full_name: string }>,
): CancellationRecipient[] {
  const booked = new Set(bookedArtistIds)
  const everyone = [...new Set([...bookedArtistIds, ...offeredArtistIds])]
  const artistById = new Map(artists.map((artist) => [artist.id, artist]))

  return everyone.flatMap((artistId) => {
    const artist = artistById.get(artistId)
    if (!artist?.email) return []
    return [{ artistId, email: artist.email, full_name: artist.full_name, booked: booked.has(artistId) }]
  })
}

async function loadNoticeShow(db: Db, showId: string): Promise<NoticeShow | null> {
  const { data: show } = await db.from('shows').select('title, date, club_id').eq('id', showId).maybeSingle()
  if (!show || isPlayedShow(show.date)) return null

  const { data: club } = show.club_id
    ? await db.from('clubs').select('name').eq('id', show.club_id).maybeSingle()
    : { data: null }

  return { title: show.title, date: show.date, clubName: club?.name ?? null }
}

async function loadArtists(db: Db, artistIds: string[]) {
  const ids = [...new Set(artistIds)].filter(Boolean)
  if (ids.length === 0) return []
  const { data } = await db.from('artists').select('id, email, full_name').in('id', ids)
  return data ?? []
}

/**
 * Leser mottakerne FØR showet slettes.
 *
 * `delete_show()` fjerner showet, og tilbud og bekreftede spots går med i
 * kaskaden. Etterpå finnes det ingen rad igjen som sier hvem som sto der.
 */
export async function collectShowCancellationNotice(showId: string): Promise<ShowCancellationNotice | null> {
  const db = createAdminClient()
  const show = await loadNoticeShow(db, showId)
  if (!show) return null

  const [{ data: spots }, { data: offers }] = await Promise.all([
    db.from('confirmed_spots').select('artist_id').eq('show_id', showId).eq('status', 'confirmed'),
    // Et tilbud som er gått ut, men ikke merket ennå, er ikke lenger et løfte.
    db
      .from('booking_offers')
      .select('artist_id')
      .eq('show_id', showId)
      .eq('status', 'sent')
      .gt('expires_at', new Date().toISOString()),
  ])

  const bookedIds = (spots ?? []).map((spot) => spot.artist_id)
  const offeredIds = (offers ?? []).map((offer) => offer.artist_id)
  const artists = await loadArtists(db, [...bookedIds, ...offeredIds])
  const recipients = cancellationRecipients(bookedIds, offeredIds, artists)

  return recipients.length > 0 ? { ...show, recipients } : null
}

function report(label: string, results: EmailResult[]) {
  const failed = results.filter((result) => !result.success).length
  if (results.length > 0) {
    console.log(`[LineupNotices] ${label}: ${results.length - failed} sent, ${failed} failed`)
  }
  return { sent: results.length - failed, failed }
}

/** Én og én, ikke parallelt: Resend slipper to kall i sekundet. */
export async function sendShowCancellationNotices(notice: ShowCancellationNotice | null) {
  if (!notice) return { sent: 0, failed: 0 }

  const results: EmailResult[] = []
  for (const recipient of notice.recipients) {
    results.push(
      await sendShowCancelledEmail({
        email: recipient.email,
        full_name: recipient.full_name,
        show_title: notice.title,
        show_date: notice.date,
        club_name: notice.clubName,
        booked: recipient.booked,
      }),
    )
  }
  return report(`show cancelled "${notice.title}"`, results)
}

/**
 * Hvem som står på en plass akkurat nå — leses før plassen slettes, av samme
 * grunn som over: kravet tar spots og tilbud med seg i kaskaden.
 */
export async function requirementOccupants(db: Db, showId: string, requirementId: string) {
  const [{ data: spots }, { data: offers }] = await Promise.all([
    db
      .from('confirmed_spots')
      .select('artist_id')
      .eq('show_id', showId)
      .eq('show_requirement_id', requirementId)
      .eq('status', 'confirmed'),
    db
      .from('booking_offers')
      .select('artist_id')
      .eq('show_id', showId)
      .eq('show_requirement_id', requirementId)
      .eq('status', 'sent')
      .gt('expires_at', new Date().toISOString()),
  ])

  const removed = [...new Set((spots ?? []).map((spot) => spot.artist_id))]
  const withdrawn = [...new Set((offers ?? []).map((offer) => offer.artist_id))].filter((id) => !removed.includes(id))
  return { removed, withdrawn }
}

/** Klubben tok komikerne ut av lineupen; showet går som planlagt. */
export async function notifyRemovedFromLineup(showId: string, artistIds: string[]) {
  if (artistIds.length === 0) return { sent: 0, failed: 0 }
  const db = createAdminClient()
  const show = await loadNoticeShow(db, showId)
  if (!show) return { sent: 0, failed: 0 }

  const results: EmailResult[] = []
  for (const artist of await loadArtists(db, artistIds)) {
    if (!artist.email) continue
    results.push(
      await sendRemovedFromLineupEmail({
        email: artist.email,
        full_name: artist.full_name,
        show_title: show.title,
        show_date: show.date,
        club_name: show.clubName,
      }),
    )
  }
  return report(`removed from lineup "${show.title}"`, results)
}

/** Klubben trakk tilbud som ikke var besvart. */
export async function notifyOfferWithdrawn(showId: string, artistIds: string[]) {
  if (artistIds.length === 0) return { sent: 0, failed: 0 }
  const db = createAdminClient()
  const show = await loadNoticeShow(db, showId)
  if (!show) return { sent: 0, failed: 0 }

  const results: EmailResult[] = []
  for (const artist of await loadArtists(db, artistIds)) {
    if (!artist.email) continue
    results.push(
      await sendOfferWithdrawnByClubEmail({
        email: artist.email,
        full_name: artist.full_name,
        show_title: show.title,
        show_date: show.date,
        club_name: show.clubName,
      }),
    )
  }
  return report(`offer withdrawn "${show.title}"`, results)
}

/**
 * Klubben satte komikeren rett inn i lineupen — lagt til for hånd, byttet inn,
 * eller et tilbud bookeren selv markerte som godtatt. Hen har ikke svart på
 * noe, og uten denne visste hen ikke at hen var booket.
 */
export async function notifyAddedToLineup(showId: string, artistId: string, requirementId: string | null) {
  const db = createAdminClient()
  const { data: show } = await db
    .from('shows')
    .select('title, date, start_time, venue_name, venue_address, currency')
    .eq('id', showId)
    .maybeSingle()
  if (!show || isPlayedShow(show.date)) return { sent: 0, failed: 0 }

  const [{ data: requirement }, artists] = await Promise.all([
    requirementId
      ? db
        .from('show_requirements')
        .select('role_name, compensation_type, compensation_amount, compensation_percent')
        .eq('id', requirementId)
        .maybeSingle()
      : Promise.resolve({ data: null }),
    loadArtists(db, [artistId]),
  ])

  const artist = artists[0]
  if (!artist?.email) return { sent: 0, failed: 0 }

  const result = await sendBookingConfirmedEmail({
    email: artist.email,
    full_name: artist.full_name,
    show_title: show.title,
    show_date: show.date,
    show_time: show.start_time?.slice(0, 5) ?? null,
    venue: showVenue(show).line,
    fee_label: requirement ? requirementFeeLabel(requirement, show.currency || 'NOK') : null,
    portal_url: appPath('/artist-app/bookings'),
    added_by_club: true,
  })
  return report(`added to lineup "${show.title}"`, [result])
}
