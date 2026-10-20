'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertShowAccess } from '@/lib/club-auth'
import { getAuthUser, getSessionProfile } from '@/lib/session'
import { appUrl } from '@/lib/app-url'
import { REPLY_TO_EMAIL, fromWithName } from '@/lib/resend'
import { sendPreparedEmail } from '@/lib/email/mailer'
import { createCampaign, drainCampaign, type DrainResult } from '@/lib/email/bulk'
import { showPromoEmail } from '@/lib/email/show-promo'
import { loadShowMaterial, type ShowMaterial } from '@/lib/marketing/show-material'
import { isMailable } from '@/lib/marketing/contacts'
import { listUnsubscribeHeaders, tokenFromUnsubscribeUrl, unsubscribePageUrl } from '@/lib/marketing/unsubscribe'

/**
 * «Send e-mail about show».
 *
 * Tre handlinger: test til meg selv, start utsendingen, fortsett den. Selve
 * sendingen er `drainCampaign` i lib/email/bulk.ts; her bestemmes hvem som
 * får den, hvordan den ser ut og at den ikke går ut to ganger ved et uhell.
 *
 * Feil returneres som `{ error }` — Next skjuler meldingen i en kastet feil
 * i produksjon.
 */

const KIND = 'show_promo'
const TEMPLATE_NAME = 'campaign_show_promo'
const MAX_SUBJECT = 200
const MAX_BODY = 20_000

export type ShowEmailDraft = { showId: string; subject: string; body: string }

export type SendProgress = DrainResult & { campaignId: string }

type ActionError = { error: string; reason?: 'already_sent' | 'already_sending' }

function cleanDraft(draft: ShowEmailDraft) {
  const subject = String(draft.subject ?? '').replace(/\s+/g, ' ').trim()
  const body = String(draft.body ?? '').replace(/\r\n?/g, '\n').trim()
  if (!subject) return { error: 'Write a subject.' }
  if (subject.length > MAX_SUBJECT) return { error: `The subject can be at most ${MAX_SUBJECT} characters.` }
  if (!body) return { error: 'Write the email.' }
  if (body.length > MAX_BODY) return { error: 'The email is too long.' }
  return { subject, body }
}

async function currentProfile() {
  const user = await getAuthUser()
  if (!user) return null
  return getSessionProfile(user.id)
}

async function loadForSending(showId: string): Promise<{ material: ShowMaterial; clubId: string; clubName: string } | ActionError> {
  const access = await assertShowAccess(showId)
  if (!access.club_id) return { error: 'This show has no club.' }
  const material = await loadShowMaterial(showId)
  if (!material || !material.club) return { error: 'Show not found.' }
  return { material, clubId: access.club_id, clubName: material.club.name }
}

/** Passer både enkelt-utsendingen (`sendPreparedEmail`) og batch-endepunktet. */
type PromoPayload = {
  from: string
  to: string
  replyTo: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
}

/** E-posten til én mottaker. Avmeldingslenken og headerne er det eneste som er personlig. */
function buildPayload(
  material: ShowMaterial,
  draft: { subject: string; body: string },
  recipient: { email: string; unsubscribeUrl: string | null },
): PromoPayload {
  const email = showPromoEmail({
    clubName: material.club?.name ?? 'Tickethalo',
    subject: draft.subject,
    body: draft.body,
    showTitle: material.show.title,
    posterUrl: material.show.posterUrl,
    ticketUrl: material.publicUrl,
    unsubscribeUrl: recipient.unsubscribeUrl,
  })
  const token = tokenFromUnsubscribeUrl(recipient.unsubscribeUrl)
  return {
    from: fromWithName(material.club?.name),
    to: recipient.email,
    // Svar på en e-post om et show går til klubben, som er avsender.
    replyTo: material.club?.supportEmail ?? REPLY_TO_EMAIL,
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers: token ? listUnsubscribeHeaders(appUrl(), token) : undefined,
  }
}

/** Alle på lista som kan få e-post. I sider på tusen — PostgREST gir aldri mer per kall. */
async function mailableContacts(clubId: string) {
  const db = createAdminClient()
  const contacts: Array<{ id: string; email: string; name: string | null; unsubscribe_token: string }> = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('club_contacts')
      .select('id, email, name, unsubscribe_token, consent_at, unsubscribed_at')
      .eq('club_id', clubId)
      .is('unsubscribed_at', null)
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`Could not read your list: ${error.message}`)
    contacts.push(...(data ?? []).filter(isMailable))
    if (!data || data.length < 1000) break
  }
  return contacts
}

/** Testen går til den som er logget inn — aldri til lista. */
export async function sendShowEmailTestAction(draft: ShowEmailDraft): Promise<{ ok: true; to: string } | ActionError> {
  try {
    const cleaned = cleanDraft(draft)
    if ('error' in cleaned) return { error: cleaned.error! }
    const loaded = await loadForSending(draft.showId)
    if ('error' in loaded) return loaded

    const profile = await currentProfile()
    if (!profile?.email) return { error: 'Could not find your email address.' }

    const payload = buildPayload(loaded.material, cleaned, { email: profile.email, unsubscribeUrl: null })
    const result = await sendPreparedEmail('campaign_show_promo_test', {
      ...payload,
      subject: `[Test] ${payload.subject}`,
    })
    if (!result.success) return { error: `The test email could not be sent: ${result.error ?? 'unknown error'}` }
    return { ok: true, to: profile.email }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The test email could not be sent.' }
  }
}

/**
 * Starter utsendingen og sender første runde.
 *
 * Er showet sendt før, må klubben ha krysset av for «Send again anyway» —
 * ellers stopper vi og sier når og til hvor mange. Pågår en utsending
 * allerede (en annen fane), fortsetter vi den i stedet for å lage en til.
 */
export async function startShowEmailAction(
  draft: ShowEmailDraft & { confirmResend: boolean },
): Promise<SendProgress | ActionError> {
  try {
    const cleaned = cleanDraft(draft)
    if ('error' in cleaned) return { error: cleaned.error! }
    const loaded = await loadForSending(draft.showId)
    if ('error' in loaded) return loaded
    const { material, clubId } = loaded

    if (material.show.status !== 'published') {
      return { error: 'Publish the show first. The email links to its page, and people cannot buy tickets before it is published.' }
    }

    const db = createAdminClient()
    const { data: previous } = await db
      .from('email_campaigns')
      .select('id, status, sent_count, created_at')
      .eq('show_id', draft.showId)
      .eq('kind', KIND)
      .order('created_at', { ascending: false })

    const running = (previous ?? []).find((campaign) => campaign.status === 'sending')
    if (running) {
      return { error: 'This show is already being sent. Continue that send instead.', reason: 'already_sending' }
    }
    const sent = (previous ?? []).find((campaign) => campaign.status === 'sent')
    if (sent && !draft.confirmResend) {
      const when = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' })
        .format(new Date(sent.created_at))
      return { error: `You already sent this show to ${sent.sent_count} people on ${when}. Tick “Send again anyway” to send it again.`, reason: 'already_sent' }
    }

    const contacts = await mailableContacts(clubId)
    const origin = appUrl()
    const profile = await currentProfile()
    const created = await createCampaign({
      clubId,
      showId: draft.showId,
      kind: KIND,
      subject: cleaned.subject,
      body: cleaned.body,
      createdBy: profile?.id ?? null,
      recipients: contacts.map((contact) => ({
        email: contact.email,
        name: contact.name,
        contactId: contact.id,
        unsubscribeUrl: unsubscribePageUrl(origin, contact.unsubscribe_token),
      })),
    })
    if (!created.ok) {
      return { error: created.message, reason: created.reason === 'already_sending' ? 'already_sending' : undefined }
    }

    const progress = await drainCampaign(created.campaignId, {
      templateName: TEMPLATE_NAME,
      render: (recipient) => buildPayload(material, cleaned, { email: recipient.email, unsubscribeUrl: recipient.unsubscribe_url }),
    })
    revalidatePath(`/admin-app/shows/${draft.showId}`)
    return { campaignId: created.campaignId, ...progress }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The email could not be sent.' }
  }
}

/** Neste runde av en utsending som ikke ble ferdig. Teksten er den som ble lagret da den startet. */
export async function continueShowEmailAction(input: { showId: string; campaignId: string }): Promise<SendProgress | ActionError> {
  try {
    const loaded = await loadForSending(input.showId)
    if ('error' in loaded) return loaded

    const { data: campaign } = await createAdminClient()
      .from('email_campaigns')
      .select('id, subject, body, status')
      .eq('id', input.campaignId)
      .eq('show_id', input.showId)
      .eq('club_id', loaded.clubId)
      .maybeSingle()
    if (!campaign) return { error: 'Send not found.' }

    const draft = { subject: campaign.subject, body: campaign.body }
    const progress = await drainCampaign(campaign.id, {
      templateName: TEMPLATE_NAME,
      render: (recipient) => buildPayload(loaded.material, draft, { email: recipient.email, unsubscribeUrl: recipient.unsubscribe_url }),
    })
    revalidatePath(`/admin-app/shows/${input.showId}`)
    return { campaignId: campaign.id, ...progress }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The email could not be sent.' }
  }
}
