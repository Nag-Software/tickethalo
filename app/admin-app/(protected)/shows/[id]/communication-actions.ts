'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertShowAccess } from '@/lib/club-auth'
import { getAuthUser, getSessionProfile } from '@/lib/session'
import { daysBetween, osloDateString } from '@/lib/booking-schedule'
import { normalizeWhatsAppInviteLink } from '@/lib/whatsapp'
import {
  drainLineupMessage,
  loadLineupContext,
  reminderRenderer,
  sendLineupMessage,
  type LineupContext,
} from '@/lib/lineup-messages'
import {
  groupInviteBody,
  groupInviteSubject,
  lineupGroupInviteTemplate,
  lineupMessageSubject,
  lineupMessageTemplate,
} from '@/lib/email/lineup-templates'
import type { LineupRecipient } from '@/lib/lineup-communication'
import type { EmailTemplate } from '@/lib/email/templates'
import type { LineupMessageKind } from '@/types/database'

/**
 * Communication-fanen: melding til lineupen, påminnelsen, endringsdyttet
 * og invitasjonen til gruppechatten.
 *
 * Feil kommer tilbake som `{ error }` — Next skjuler meldingen i en kastet
 * feil i produksjon, og her er det feil bookeren kan gjøre noe med.
 */

const MAX_BODY = 5_000

export type LineupSendProgress = { messageId: string; sent: number; failed: number; remaining: number }
type ActionError = { error: string }

async function loadForShow(showId: string): Promise<{ context: LineupContext } | ActionError> {
  await assertShowAccess(showId)
  const context = await loadLineupContext(createAdminClient(), showId)
  if (!context) return { error: 'Show not found.' }
  return { context }
}

async function currentSender() {
  const user = await getAuthUser()
  const profile = user ? await getSessionProfile(user.id) : null
  return profile ? { profileId: profile.id, name: profile.full_name?.trim() || null, email: profile.email } : null
}

function messageRenderer(context: LineupContext, body: string, senderName: string | null) {
  return (recipient: LineupRecipient): EmailTemplate => lineupMessageTemplate({
    recipientName: recipient.name,
    clubName: context.club.name,
    senderName,
    showId: context.show.id,
    showTitle: context.show.title,
    showDate: context.show.date,
    body,
  })
}

function inviteRenderer(context: LineupContext, link: string) {
  return (recipient: LineupRecipient): EmailTemplate => lineupGroupInviteTemplate({
    recipientName: recipient.name,
    clubName: context.club.name,
    showId: context.show.id,
    showTitle: context.show.title,
    showDate: context.show.date,
    link,
  })
}

function done(showId: string, messageId: string, progress: { sent: number; failed: number; remaining: number }): LineupSendProgress {
  revalidatePath(`/admin-app/shows/${showId}`)
  return { messageId, sent: progress.sent, failed: progress.failed, remaining: progress.remaining }
}

export async function sendLineupMessageAction(input: { showId: string; body: string }): Promise<LineupSendProgress | ActionError> {
  try {
    const body = String(input.body ?? '').replace(/\r\n?/g, '\n').trim()
    if (!body) return { error: 'Write a message first.' }
    if (body.length > MAX_BODY) return { error: `The message can be at most ${MAX_BODY} characters.` }

    const loaded = await loadForShow(input.showId)
    if ('error' in loaded) return loaded
    const { context } = loaded
    const sender = await currentSender()

    const sent = await sendLineupMessage({
      context,
      kind: 'message',
      subject: lineupMessageSubject(context.show.title, context.club.name),
      body,
      sender,
      recipients: context.recipients,
      render: messageRenderer(context, body, sender?.name ?? null),
    })
    if ('error' in sent) return sent

    // Lineupen har fått beskjed — dyttet har gjort jobben sin.
    if (context.show.lineup_change_notice) {
      await createAdminClient().from('shows').update({ lineup_change_notice: null }).eq('id', context.show.id)
    }
    return done(input.showId, sent.messageId, sent)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The message could not be sent.' }
  }
}

/** Neste runde av en melding som ikke ble ferdig sendt. */
export async function continueLineupMessageAction(input: { showId: string; messageId: string }): Promise<LineupSendProgress | ActionError> {
  try {
    const loaded = await loadForShow(input.showId)
    if ('error' in loaded) return loaded
    const { context } = loaded
    const db = createAdminClient()

    const { data: message } = await db
      .from('lineup_messages')
      .select('id, kind, body, group_link, sender_name, sent_by, campaign_id, created_at')
      .eq('id', input.messageId)
      .eq('show_id', input.showId)
      .maybeSingle()
    if (!message?.campaign_id) return { error: 'Message not found.' }

    const [{ data: receipts }, { data: sender }] = await Promise.all([
      db.from('lineup_message_recipients').select('artist_id, email').eq('message_id', message.id),
      message.sent_by
        ? db.from('profiles').select('email').eq('id', message.sent_by).maybeSingle()
        : Promise.resolve({ data: null as { email: string } | null }),
    ])
    const artistById = new Map(context.artists.map((artist) => [artist.id, artist]))
    const recipients: LineupRecipient[] = (receipts ?? []).map((receipt) => {
      const artist = artistById.get(receipt.artist_id)
      return {
        artistId: receipt.artist_id,
        email: receipt.email,
        name: artist ? artist.stage_name?.trim() || artist.full_name : 'there',
        whatsapp: artist?.whatsapp_number ?? null,
      }
    })

    const kind = message.kind as LineupMessageKind
    const render = kind === 'group_invite' && message.group_link
      ? inviteRenderer(context, message.group_link)
      : kind === 'reminder'
        ? reminderRenderer(context, Math.max(1, daysBetween(osloDateString(new Date(message.created_at)), context.show.date.slice(0, 10))))
        : messageRenderer(context, message.body, message.sender_name)

    const progress = await drainLineupMessage(context, kind, message.campaign_id, recipients, render, sender?.email ?? null)
    return done(input.showId, message.id, progress)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The message could not be sent.' }
  }
}

/**
 * Lagrer lenken og sender den til lineupen. Bare chat.whatsapp.com-lenker:
 * den går til alle, og skal ikke kunne bli en lenke til hvor som helst.
 */
export async function sendGroupInviteAction(input: { showId: string; link: string }): Promise<LineupSendProgress | ActionError> {
  try {
    const link = normalizeWhatsAppInviteLink(input.link)
    if (!link) return { error: 'Paste the invite link from WhatsApp. It starts with https://chat.whatsapp.com/' }

    const loaded = await loadForShow(input.showId)
    if ('error' in loaded) return loaded
    const { context } = loaded

    const db = createAdminClient()
    const { error } = await db.from('shows').update({ lineup_group_link: link }).eq('id', context.show.id)
    if (error) return { error: error.message }
    const withLink: LineupContext = {
      ...context,
      show: { ...context.show, lineup_group_link: link },
      details: { ...context.details, groupLink: link },
    }

    const sent = await sendLineupMessage({
      context: withLink,
      kind: 'group_invite',
      subject: groupInviteSubject(context.show.title),
      body: groupInviteBody(context.show.title, link),
      groupLink: link,
      sender: await currentSender(),
      recipients: context.recipients,
      render: inviteRenderer(withLink, link),
    })
    if ('error' in sent) return sent
    return done(input.showId, sent.messageId, sent)
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The invite could not be sent.' }
  }
}

/** «Yes, send this». `null` = følg klubbens standard igjen. */
export async function setLineupReminderAction(input: { showId: string; enabled: boolean | null }): Promise<{ ok: true } | ActionError> {
  await assertShowAccess(input.showId)
  const { error } = await createAdminClient()
    .from('shows')
    .update({ lineup_reminder_enabled: input.enabled })
    .eq('id', input.showId)
  if (error) return { error: error.message }
  revalidatePath(`/admin-app/shows/${input.showId}`)
  return { ok: true }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export async function setLineupArrivalTimeAction(input: { showId: string; time: string }): Promise<{ ok: true } | ActionError> {
  await assertShowAccess(input.showId)
  const time = String(input.time ?? '').trim().slice(0, 5)
  if (time && !TIME.test(time)) return { error: 'Write the time as HH:MM.' }
  const { error } = await createAdminClient()
    .from('shows')
    .update({ lineup_arrival_time: time || null })
    .eq('id', input.showId)
  if (error) return { error: error.message }
  revalidatePath(`/admin-app/shows/${input.showId}`)
  return { ok: true }
}

/** Klubben har sagt fra på annen måte, eller endringen trenger ingen beskjed. */
export async function dismissLineupChangeAction(showId: string): Promise<{ ok: true } | ActionError> {
  await assertShowAccess(showId)
  const { error } = await createAdminClient().from('shows').update({ lineup_change_notice: null }).eq('id', showId)
  if (error) return { error: error.message }
  revalidatePath(`/admin-app/shows/${showId}`)
  return { ok: true }
}
