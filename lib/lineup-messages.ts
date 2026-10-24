import type { CreateBatchEmailOptions } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { REPLY_TO_EMAIL, fromWithName } from '@/lib/resend'
import { createCampaign, drainCampaign, type DrainResult } from '@/lib/email/bulk'
import { requirementFeeLabel } from '@/lib/booking-spots'
import { daysBetween, osloDateString } from '@/lib/booking-schedule'
import { showVenue } from '@/lib/show-venue'
import { canonicalRoleLabel } from '@/lib/artist-roles'
import { mergeChangeNotice, type ChangeWatchedShow } from '@/lib/lineup-changes'
import { REMINDER_DAYS_BEFORE, reminderDueToday } from '@/lib/lineup-reminders'
import { clubContactEmail } from '@/lib/club-contact'
import {
  lineupArtist,
  lineupHost,
  lineupRecipients,
  type LineupArtist,
  type LineupRecipient,
  type LineupShowDetails,
  type LineupSpotRow,
} from '@/lib/lineup-communication'
import { lineupReminderTemplate, reminderBody, reminderSubject } from '@/lib/email/lineup-templates'
import type { EmailTemplate } from '@/lib/email/templates'
import type {
  ConfirmedSpotStatus,
  EmailCampaignRecipientStatus,
  LineupChangeNotice,
  LineupMessageKind,
  ShowStatus,
} from '@/types/database'

/**
 * Meldingene til lineupen — oppslag og utsending.
 *
 * En melding er to ting: en rad i `lineup_messages` (med mottakerne i
 * `lineup_message_recipients`), som portalen viser, og en utsendelse i
 * `email_campaigns`, som e-posten går gjennom. Køen i lib/email/bulk.ts
 * sørger for at ingen får samme e-post to ganger, og for leveringen per
 * adresse som historikken viser.
 */

type Db = ReturnType<typeof createAdminClient>

/** `kind` i `email_campaigns` per slag. Den delvise unike indeksen gjelder per slag. */
const CAMPAIGN_KIND: Record<LineupMessageKind, string> = {
  message: 'lineup_message',
  reminder: 'lineup_reminder',
  group_invite: 'lineup_group_invite',
}
const TEMPLATE_NAME = CAMPAIGN_KIND

// ─────────────────────────────────────────────────────────────
// Showet og lineupen
// ─────────────────────────────────────────────────────────────

export type LineupContext = {
  show: {
    id: string
    title: string
    date: string
    start_time: string | null
    venue_name: string | null
    venue_address: string | null
    currency: string
    status: ShowStatus
    deleted_at: string | null
    is_template: boolean
    club_id: string
    lineup_reminder_enabled: boolean | null
    lineup_arrival_time: string | null
    lineup_change_notice: LineupChangeNotice | null
    lineup_group_link: string | null
  }
  club: {
    id: string
    name: string
    support_email: string | null
    contact_email: string | null
    contact_phone: string | null
    lineup_reminder_default: boolean
  }
  requirements: Array<{
    id: string
    role_name: string
    lineup_position: number
    compensation_type: 'fixed' | 'percent' | null
    compensation_amount: number | null
    compensation_percent: number | null
  }>
  spots: Array<LineupSpotRow & { lineup_reminder_sent_at: string | null }>
  artists: LineupArtist[]
  /** De som får en melding nå: bekreftet lineup med e-post. */
  recipients: LineupRecipient[]
  details: LineupShowDetails
}

export function showDetails(
  show: LineupContext['show'],
  club: LineupContext['club'],
  host: LineupShowDetails['host'],
): LineupShowDetails {
  const venue = showVenue(show)
  return {
    title: show.title,
    date: show.date,
    startTime: show.start_time?.slice(0, 5) ?? null,
    arrivalTime: show.lineup_arrival_time?.slice(0, 5) ?? null,
    venue: venue.venue,
    address: venue.address,
    clubName: club.name,
    clubEmail: clubContactEmail(club),
    clubPhone: club.contact_phone?.trim() || null,
    host,
    groupLink: show.lineup_group_link,
  }
}

export async function loadLineupContext(db: Db, showId: string): Promise<LineupContext | null> {
  const { data: show } = await db
    .from('shows')
    .select('id, title, date, start_time, venue_name, venue_address, currency, status, deleted_at, is_template, club_id, lineup_reminder_enabled, lineup_arrival_time, lineup_change_notice, lineup_group_link')
    .eq('id', showId)
    .maybeSingle()
  if (!show?.club_id) return null

  const [{ data: club }, { data: requirements }, { data: spots }] = await Promise.all([
    db.from('clubs').select('id, name, support_email, contact_email, contact_phone, lineup_reminder_default').eq('id', show.club_id).maybeSingle(),
    db
      .from('show_requirements')
      .select('id, role_name, lineup_position, compensation_type, compensation_amount, compensation_percent')
      .eq('show_id', showId)
      .order('lineup_position')
      .order('created_at'),
    db
      .from('confirmed_spots')
      .select('id, artist_id, show_requirement_id, status, lineup_reminder_sent_at, created_at')
      .eq('show_id', showId)
      .order('created_at'),
  ])
  if (!club) return null

  // Lineupens rekkefølge: plassene slik bookeren har satt dem opp.
  const position = new Map((requirements ?? []).map((requirement, index) => [requirement.id, index]))
  const orderedSpots = [...(spots ?? [])].sort(
    (a, b) => (position.get(a.show_requirement_id) ?? 99) - (position.get(b.show_requirement_id) ?? 99),
  )

  const artistIds = [...new Set(orderedSpots.map((spot) => spot.artist_id))]
  const { data: artistRows } = artistIds.length
    ? await db.from('artists').select('id, full_name, stage_name, email, whatsapp_number, whatsapp_consent_at').in('id', artistIds)
    : { data: [] }
  const artists: LineupArtist[] = (artistRows ?? []).map(lineupArtist)

  const typedShow = { ...show, club_id: show.club_id } as LineupContext['show']
  const typedRequirements = (requirements ?? []) as LineupContext['requirements']
  const typedSpots = orderedSpots as LineupContext['spots']
  const host = lineupHost(typedRequirements, typedSpots, artists)

  return {
    show: typedShow,
    club,
    requirements: typedRequirements,
    spots: typedSpots,
    artists,
    recipients: lineupRecipients(typedSpots, artists),
    details: showDetails(typedShow, club, host),
  }
}

// ─────────────────────────────────────────────────────────────
// Utsendingen
// ─────────────────────────────────────────────────────────────

export type SentLineupMessage = { messageId: string; campaignId: string } & DrainResult

export type SendLineupMessageInput = {
  context: LineupContext
  kind: LineupMessageKind
  subject: string
  /** Teksten i portalen. */
  body: string
  groupLink?: string | null
  sender: { profileId: string; name: string | null; email: string | null } | null
  recipients: LineupRecipient[]
  /** E-posten til én mottaker. */
  render: (recipient: LineupRecipient) => EmailTemplate
}

/**
 * Lagrer meldingen, legger mottakerne i kø og sender første runde.
 *
 * Svar går til den som skrev — eller til klubben, når meldingen går av
 * seg selv. Komikeren svarer på e-post; portalen er bare for lesing.
 */
export async function sendLineupMessage(input: SendLineupMessageInput): Promise<SentLineupMessage | { error: string }> {
  const { context, kind } = input
  if (input.recipients.length === 0) return { error: 'No one on the line-up to send to.' }

  const db = createAdminClient()
  const { data: message, error } = await db
    .from('lineup_messages')
    .insert({
      show_id: context.show.id,
      club_id: context.club.id,
      kind,
      subject: input.subject,
      body: input.body,
      group_link: input.groupLink ?? null,
      sent_by: input.sender?.profileId ?? null,
      sender_name: input.sender ? input.sender.name ?? input.sender.email : null,
      recipient_count: input.recipients.length,
    })
    .select('id')
    .single()
  if (error || !message) return { error: error?.message ?? 'The message could not be saved.' }

  const { error: recipientError } = await db.from('lineup_message_recipients').insert(
    input.recipients.map((recipient) => ({ message_id: message.id, artist_id: recipient.artistId, email: recipient.email })),
  )
  if (recipientError) {
    await db.from('lineup_messages').delete().eq('id', message.id)
    return { error: recipientError.message }
  }

  const campaign = await createCampaign({
    clubId: context.club.id,
    showId: context.show.id,
    kind: CAMPAIGN_KIND[kind],
    subject: input.subject,
    body: input.body,
    createdBy: input.sender?.profileId ?? null,
    recipients: input.recipients.map((recipient) => ({ email: recipient.email, name: recipient.name })),
  })
  if (!campaign.ok) {
    // Uten utsendelse har ingen fått noe, og da skal meldingen heller ikke stå i portalen.
    await db.from('lineup_messages').delete().eq('id', message.id)
    return { error: campaign.reason === 'already_sending' ? 'A message to this line-up is still being sent. Try again in a moment.' : campaign.message }
  }

  await db.from('lineup_messages').update({ campaign_id: campaign.campaignId }).eq('id', message.id)

  const progress = await drainLineupMessage(context, kind, campaign.campaignId, input.recipients, input.render, input.sender?.email ?? null)
  return { messageId: message.id, campaignId: campaign.campaignId, ...progress }
}

function replyToFor(context: LineupContext, senderEmail: string | null) {
  return senderEmail ?? clubContactEmail(context.club) ?? REPLY_TO_EMAIL
}

/** Én runde av køen. Kan kalles igjen til `remaining` er 0. */
export async function drainLineupMessage(
  context: LineupContext,
  kind: LineupMessageKind,
  campaignId: string,
  recipients: LineupRecipient[],
  render: (recipient: LineupRecipient) => EmailTemplate,
  senderEmail: string | null,
): Promise<DrainResult> {
  const byEmail = new Map(recipients.map((recipient) => [recipient.email.trim().toLowerCase(), recipient]))
  return drainCampaign(campaignId, {
    templateName: TEMPLATE_NAME[kind],
    render: (queued): CreateBatchEmailOptions => {
      const recipient = byEmail.get(queued.email) ?? {
        artistId: '',
        email: queued.email,
        name: queued.name ?? 'there',
        whatsapp: null,
      }
      const template = render(recipient)
      return {
        from: fromWithName(context.club.name),
        to: queued.email,
        replyTo: replyToFor(context, senderEmail),
        subject: template.subject,
        html: template.html,
        text: template.text,
      }
    },
  })
}

// ─────────────────────────────────────────────────────────────
// Historikken på fanen
// ─────────────────────────────────────────────────────────────

export type LineupHistoryEntry = {
  id: string
  kind: LineupMessageKind
  subject: string
  body: string
  groupLink: string | null
  senderName: string | null
  createdAt: string
  campaignId: string | null
  /** Utsendelsen pågår fortsatt — fanen kan sende resten. */
  sending: boolean
  recipients: Array<{
    artistId: string
    name: string
    readAt: string | null
    delivery: EmailCampaignRecipientStatus | 'unknown'
    error: string | null
  }>
}

export async function loadLineupHistory(db: Db, showId: string, limit = 50): Promise<LineupHistoryEntry[]> {
  const { data: messages } = await db
    .from('lineup_messages')
    .select('id, kind, subject, body, group_link, sender_name, created_at, campaign_id')
    .eq('show_id', showId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (!messages || messages.length === 0) return []

  const messageIds = messages.map((message) => message.id)
  const campaignIds = messages.flatMap((message) => (message.campaign_id ? [message.campaign_id] : []))
  const [{ data: recipients }, { data: deliveries }, { data: campaigns }] = await Promise.all([
    db.from('lineup_message_recipients').select('message_id, artist_id, email, read_at').in('message_id', messageIds),
    campaignIds.length
      ? db.from('email_campaign_recipients').select('campaign_id, email, status, error').in('campaign_id', campaignIds)
      : Promise.resolve({ data: [] as Array<{ campaign_id: string; email: string; status: EmailCampaignRecipientStatus; error: string | null }> }),
    campaignIds.length
      ? db.from('email_campaigns').select('id, status').in('id', campaignIds)
      : Promise.resolve({ data: [] as Array<{ id: string; status: string }> }),
  ])

  const artistIds = [...new Set((recipients ?? []).map((row) => row.artist_id))]
  const { data: artists } = artistIds.length
    ? await db.from('artists').select('id, full_name, stage_name').in('id', artistIds)
    : { data: [] }
  const nameById = new Map((artists ?? []).map((artist) => [artist.id, artist.stage_name?.trim() || artist.full_name]))
  const deliveryByKey = new Map((deliveries ?? []).map((row) => [`${row.campaign_id}:${row.email}`, row]))
  const sendingCampaigns = new Set((campaigns ?? []).filter((row) => row.status === 'sending').map((row) => row.id))

  return messages.map((message) => ({
    id: message.id,
    kind: message.kind as LineupMessageKind,
    subject: message.subject,
    body: message.body,
    groupLink: message.group_link,
    senderName: message.sender_name,
    createdAt: message.created_at,
    campaignId: message.campaign_id,
    sending: Boolean(message.campaign_id && sendingCampaigns.has(message.campaign_id)),
    recipients: (recipients ?? [])
      .filter((row) => row.message_id === message.id)
      .map((row) => {
        const delivery = message.campaign_id ? deliveryByKey.get(`${message.campaign_id}:${row.email.trim().toLowerCase()}`) : undefined
        return {
          artistId: row.artist_id,
          name: nameById.get(row.artist_id) ?? row.email,
          readAt: row.read_at,
          delivery: delivery?.status ?? 'unknown',
          error: delivery?.error ?? null,
        }
      }),
  }))
}

// ─────────────────────────────────────────────────────────────
// Komikerens innboks
// ─────────────────────────────────────────────────────────────

export async function countUnreadLineupMessages(db: Db, artistId: string) {
  const { count } = await db
    .from('lineup_message_recipients')
    .select('message_id', { count: 'exact', head: true })
    .eq('artist_id', artistId)
    .is('read_at', null)
  return count ?? 0
}

export type InboxMessage = {
  id: string
  kind: LineupMessageKind
  subject: string
  body: string
  groupLink: string | null
  senderName: string | null
  createdAt: string
  readAt: string | null
}

export type InboxThread = {
  showId: string
  showTitle: string
  showDate: string
  clubName: string | null
  unread: number
  messages: InboxMessage[]
}

/** Alle meldingene komikeren har fått, gruppert per show, nyeste tråd først. */
export async function loadInbox(db: Db, artistId: string, showId?: string): Promise<InboxThread[]> {
  const { data: receipts } = await db
    .from('lineup_message_recipients')
    .select('message_id, read_at')
    .eq('artist_id', artistId)
    .limit(1000)
  if (!receipts || receipts.length === 0) return []

  let query = db
    .from('lineup_messages')
    .select('id, show_id, kind, subject, body, group_link, sender_name, created_at')
    .in('id', receipts.map((receipt) => receipt.message_id))
    .order('created_at', { ascending: false })
  if (showId) query = query.eq('show_id', showId)
  const { data: messages } = await query
  if (!messages || messages.length === 0) return []

  const showIds = [...new Set(messages.map((message) => message.show_id))]
  const { data: shows } = await db.from('shows').select('id, title, date, club_id').in('id', showIds)
  const clubIds = [...new Set((shows ?? []).flatMap((show) => (show.club_id ? [show.club_id] : [])))]
  const { data: clubs } = clubIds.length ? await db.from('clubs').select('id, name').in('id', clubIds) : { data: [] }

  const readById = new Map(receipts.map((receipt) => [receipt.message_id, receipt.read_at]))
  const clubName = new Map((clubs ?? []).map((club) => [club.id, club.name]))
  const showById = new Map((shows ?? []).map((show) => [show.id, show]))

  const threads = new Map<string, InboxThread>()
  for (const message of messages) {
    const show = showById.get(message.show_id)
    if (!show) continue
    const thread = threads.get(show.id) ?? {
      showId: show.id,
      showTitle: show.title,
      showDate: show.date,
      clubName: show.club_id ? clubName.get(show.club_id) ?? null : null,
      unread: 0,
      messages: [],
    }
    const readAt = readById.get(message.id) ?? null
    if (!readAt) thread.unread += 1
    thread.messages.push({
      id: message.id,
      kind: message.kind as LineupMessageKind,
      subject: message.subject,
      body: message.body,
      groupLink: message.group_link,
      senderName: message.sender_name,
      createdAt: message.created_at,
      readAt,
    })
    threads.set(show.id, thread)
  }
  // Meldingene kom nyeste først, så den første i hver tråd er den siste som kom.
  return [...threads.values()]
}

export async function markThreadRead(db: Db, artistId: string, showId: string) {
  const { data: messages } = await db.from('lineup_messages').select('id').eq('show_id', showId)
  const ids = (messages ?? []).map((message) => message.id)
  if (ids.length === 0) return 0
  const { data } = await db
    .from('lineup_message_recipients')
    .update({ read_at: new Date().toISOString() })
    .eq('artist_id', artistId)
    .in('message_id', ids)
    .is('read_at', null)
    .select('message_id')
  return (data ?? []).length
}

// ─────────────────────────────────────────────────────────────
// Endringsdyttet
// ─────────────────────────────────────────────────────────────

/**
 * Kalles etter at showdetaljene er lagret. Bare når noen står i lineupen
 * — et show uten lineup har ingen å varsle — og bare før showet er spilt.
 */
export async function noteLineupChange(
  db: Db,
  showId: string,
  before: ChangeWatchedShow & { lineup_change_notice: LineupChangeNotice | null },
  after: ChangeWatchedShow,
) {
  const next = mergeChangeNotice(before.lineup_change_notice, before, after)
  if (JSON.stringify(next) === JSON.stringify(before.lineup_change_notice ?? null)) return

  if (next) {
    const playedDate = [before.date, after.date].every((date) => date.slice(0, 10) < osloDateString())
    if (playedDate) return
    const { count } = await db
      .from('confirmed_spots')
      .select('id', { count: 'exact', head: true })
      .eq('show_id', showId)
      .eq('status', 'confirmed')
    if (!count) return
  }

  const { error } = await db.from('shows').update({ lineup_change_notice: next }).eq('id', showId)
  if (error) console.warn(`[LineupChanges] Could not record the change on show ${showId}: ${error.message}`)
}

// ─────────────────────────────────────────────────────────────
// Påminnelsen 5 dager før
// ─────────────────────────────────────────────────────────────

export type ReminderRunResult = { shows: number; reminded: number; failed: number; skipped: number }

/** Malen til én komiker: rolle og honorar for akkurat hens plass. */
export function reminderRenderer(context: LineupContext, daysLeft: number) {
  const spotByArtist = new Map(context.spots.map((spot) => [spot.artist_id, spot]))
  const requirementById = new Map(context.requirements.map((requirement) => [requirement.id, requirement]))
  return (recipient: LineupRecipient) => {
    const spot = spotByArtist.get(recipient.artistId)
    const requirement = spot ? requirementById.get(spot.show_requirement_id) : undefined
    return lineupReminderTemplate({
      recipientName: recipient.name,
      artistId: recipient.artistId,
      showId: context.show.id,
      details: context.details,
      daysLeft,
      roleName: requirement ? canonicalRoleLabel(requirement.role_name) : null,
      feeLabel: requirement ? requirementFeeLabel(requirement, context.show.currency || 'NOK') : null,
    })
  }
}

/**
 * Den daglige kjøringen. `showIds` avgrenser til bestemte show — brukt når
 * den prøves lokalt mot produksjonsbasen, så ingen andre får noe.
 */
export async function sendDueLineupReminders(
  now: Date = new Date(),
  options: { deadline?: number; showIds?: string[] } = {},
): Promise<ReminderRunResult> {
  const db = createAdminClient()
  const today = osloDateString(now)
  const result: ReminderRunResult = { shows: 0, reminded: 0, failed: 0, skipped: 0 }

  let query = db
    .from('shows')
    .select('id, date, status, deleted_at, is_template, lineup_reminder_enabled, club_id')
    .gt('date', today)
    .lte('date', new Date(Date.parse(`${today}T00:00:00Z`) + REMINDER_DAYS_BEFORE * 86_400_000).toISOString().slice(0, 10))
    .is('deleted_at', null)
    .eq('is_template', false)
    .not('status', 'in', '(cancelled,completed)')
  if (options.showIds) query = query.in('id', options.showIds)
  const { data: shows, error } = await query
  if (error) throw new Error(`Could not read shows for reminders: ${error.message}`)

  const clubIds = [...new Set((shows ?? []).flatMap((show) => (show.club_id ? [show.club_id] : [])))]
  const { data: clubs } = clubIds.length
    ? await db.from('clubs').select('id, lineup_reminder_default').in('id', clubIds)
    : { data: [] }
  const clubDefault = new Map((clubs ?? []).map((club) => [club.id, club.lineup_reminder_default]))

  for (const show of shows ?? []) {
    if (options.deadline && Date.now() > options.deadline) break
    if (!show.club_id || !reminderDueToday(show, clubDefault.get(show.club_id), now)) continue

    const context = await loadLineupContext(db, show.id)
    if (!context) continue
    const waiting = context.spots.filter((spot) => spot.status === 'confirmed' && !spot.lineup_reminder_sent_at)
    if (waiting.length === 0) continue

    // Plassene merkes før sending. Går to kjøringer samtidig, får bare
    // den ene plassen — og ingen får påminnelsen to ganger.
    const { data: claimed } = await db
      .from('confirmed_spots')
      .update({ lineup_reminder_sent_at: now.toISOString() })
      .in('id', waiting.map((spot) => spot.id))
      .is('lineup_reminder_sent_at', null)
      .eq('status', 'confirmed')
      .select('id, artist_id, status')
    const recipients = lineupRecipients(
      (claimed ?? []) as Array<{ artist_id: string; status: ConfirmedSpotStatus }>,
      context.artists,
      ['confirmed'],
    )
    if (recipients.length === 0) continue

    const daysLeft = daysBetween(today, show.date.slice(0, 10))
    const sent = await sendLineupMessage({
      context,
      kind: 'reminder',
      subject: reminderSubject(context.details.title, context.details.date),
      body: reminderBody(context.details),
      sender: null,
      recipients,
      render: reminderRenderer(context, daysLeft),
    })
    result.shows += 1
    if ('error' in sent) {
      // Plassen er merket, og påminnelsen sendes ikke på nytt: én for mye
      // er verre enn én som mangler. Feilen står i loggen.
      console.error(`[LineupReminders] Show ${show.id}: ${sent.error}`)
      result.failed += recipients.length
      continue
    }

    let progress: DrainResult = sent
    while (progress.remaining > 0 && (!options.deadline || Date.now() < options.deadline)) {
      progress = await drainLineupMessage(context, 'reminder', sent.campaignId, recipients, reminderRenderer(context, daysLeft), null)
    }
    result.reminded += progress.sent
    result.failed += progress.failed
    result.skipped += progress.remaining
  }

  return result
}

