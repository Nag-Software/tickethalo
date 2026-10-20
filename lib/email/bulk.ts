import type { CreateBatchEmailOptions } from 'resend'
import { resend } from '@/lib/resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { RETRYABLE_ERRORS, RETRY_DELAYS_MS } from './mailer'
import type { EmailCampaignRecipient, EmailCampaignStatus } from '@/types/database'

/**
 * Masseutsendelser — én e-post til mange, gjennom en kø i databasen.
 *
 * `deliver()` i mailer.ts sender én og én, og Resend slipper to kall i
 * sekundet. To tusen kontakter én og én er sytten minutter; ingen server
 * action lever så lenge. Batch-endepunktet tar hundre e-poster per kall, så
 * de samme to tusen er tjue kall og et drøyt titalls sekunder.
 *
 * Køen (`email_campaign_recipients`, migrasjon 078) gjør at en utsendelse
 * tåler å bli avbrutt. `drainCampaign` sender så mye som rekker innenfor
 * tidsbudsjettet og sier hvor mange som gjenstår; den som kalte kaller igjen.
 * Samme mønster som «Refund all» i shows/actions.ts.
 *
 * Laget for gjenbruk: «Send e-mail about show» bruker den nå, lineup-
 * kommunikasjonen i fase 3 skal bruke den med sin egen `kind` og `render`.
 */

/** Resends grense per batch-kall. */
export const BATCH_SIZE = 100
/** Litt over et halvt sekund mellom kallene holder oss under to i sekundet. */
const BATCH_SPACING_MS = 600
/** Kort med vilje — se REFUND_ALL_TIME_BUDGET_MS. Klienten kaller igjen. */
export const DEFAULT_TIME_BUDGET_MS = 8_000

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

export type BatchOutcome = { email: string; resendId: string | null; error: string | null }

/**
 * Én batch til Resend, med nye forsøk på feil som går over av seg selv.
 *
 * `permissive`: én ugyldig adresse skal ikke stoppe de nittini andre. Resend
 * svarer med id-ene for dem som gikk og en liste over indeksene som ikke gikk.
 *
 * Samme `idempotencyKey` på alle forsøk — og på neste runde, om denne døde
 * etter at Resend sendte men før vi rakk å skrive det ned. Da får ingen samme
 * e-post to ganger.
 */
export async function sendBatch(payloads: CreateBatchEmailOptions[], idempotencyKey: string): Promise<BatchOutcome[]> {
  const emailOf = (payload: CreateBatchEmailOptions) => (Array.isArray(payload.to) ? payload.to.join(', ') : payload.to)
  let failure = 'unknown error'

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    let retryable = false
    try {
      const { data, error } = await resend.batch.send(payloads, { idempotencyKey, batchValidation: 'permissive' })
      if (!error && data) {
        const failed = new Map((data.errors ?? []).map((entry) => [entry.index, entry.message]))
        const ids = [...(data.data ?? [])]
        return payloads.map((payload, index) => {
          if (failed.has(index)) return { email: emailOf(payload), resendId: null, error: failed.get(index) ?? 'rejected' }
          return { email: emailOf(payload), resendId: ids.shift()?.id ?? null, error: null }
        })
      }
      failure = error ? `${error.name}: ${error.message}` : 'empty response'
      retryable = error ? RETRYABLE_ERRORS.has(error.name) || (error.statusCode ?? 0) >= 500 : true
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err)
      retryable = true
    }

    if (!retryable || attempt === RETRY_DELAYS_MS.length) break
    await wait(RETRY_DELAYS_MS[attempt])
  }

  console.error(`[BulkEmail] batch ${idempotencyKey} failed: ${failure}`)
  return payloads.map((payload) => ({ email: emailOf(payload), resendId: null, error: failure }))
}

// ─────────────────────────────────────────────────────────────
// Køen
// ─────────────────────────────────────────────────────────────

export type CampaignRecipientInput = {
  email: string
  name?: string | null
  contactId?: string | null
  unsubscribeUrl?: string | null
}

export type CreateCampaignResult =
  | { ok: true; campaignId: string; recipientCount: number }
  | { ok: false; reason: 'already_sending' | 'no_recipients' | 'failed'; message: string }

/**
 * Lager utsendelsen og legger alle mottakerne i kø. Mottakerlista er et
 * øyeblikksbilde: melder noen seg på mens den sendes, får de ikke denne.
 */
export async function createCampaign(input: {
  clubId: string
  showId: string | null
  kind: string
  subject: string
  body: string
  createdBy: string | null
  recipients: CampaignRecipientInput[]
}): Promise<CreateCampaignResult> {
  const unique = new Map<string, CampaignRecipientInput>()
  for (const recipient of input.recipients) {
    const email = recipient.email.trim().toLowerCase()
    if (email && !unique.has(email)) unique.set(email, { ...recipient, email })
  }
  if (unique.size === 0) return { ok: false, reason: 'no_recipients', message: 'There is no one to send to.' }

  const db = createAdminClient()
  const { data: campaign, error } = await db
    .from('email_campaigns')
    .insert({
      club_id: input.clubId,
      show_id: input.showId,
      kind: input.kind,
      subject: input.subject,
      body: input.body,
      created_by: input.createdBy,
      status: 'sending',
      recipient_count: unique.size,
    })
    .select('id')
    .single()

  if (error || !campaign) {
    // Den delvise unike indeksen: en utsendelse av samme show pågår allerede.
    if (error?.code === '23505') {
      return { ok: false, reason: 'already_sending', message: 'This show is already being sent. Wait for it to finish.' }
    }
    return { ok: false, reason: 'failed', message: error?.message ?? 'Could not create the send.' }
  }

  for (const rows of chunk([...unique.values()], 1000)) {
    const { error: queueError } = await db.from('email_campaign_recipients').insert(rows.map((recipient) => ({
      campaign_id: campaign.id,
      email: recipient.email,
      name: recipient.name ?? null,
      contact_id: recipient.contactId ?? null,
      unsubscribe_url: recipient.unsubscribeUrl ?? null,
    })))
    if (queueError) {
      // En halv kø er verre enn ingen: den ville sendt til noen og latt som
      // resten ikke fantes.
      await db.from('email_campaigns').delete().eq('id', campaign.id)
      return { ok: false, reason: 'failed', message: queueError.message }
    }
  }

  return { ok: true, campaignId: campaign.id, recipientCount: unique.size }
}

export type DrainResult = {
  status: EmailCampaignStatus
  recipientCount: number
  sent: number
  failed: number
  remaining: number
}

export type RenderRecipient = (
  recipient: Pick<EmailCampaignRecipient, 'email' | 'name' | 'contact_id' | 'unsubscribe_url'>,
) => CreateBatchEmailOptions

/** Tellerne på utsendelsen, talt fra køen — ikke lagt sammen underveis, så de alltid stemmer. */
async function countRecipients(campaignId: string) {
  const db = createAdminClient()
  const count = async (status: EmailCampaignRecipient['status']) => {
    const { count: value } = await db
      .from('email_campaign_recipients')
      .select('email', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', status)
    return value ?? 0
  }
  const [pending, sent, failed] = await Promise.all([count('pending'), count('sent'), count('failed')])
  return { pending, sent, failed }
}

/**
 * Sender det som står i kø, til køen er tom eller tiden er ute.
 *
 * Kan kalles så mange ganger det trengs; en mottaker som er sendt, sendes
 * aldri igjen. Når køen er tom settes utsendelsen til `sent` (eller `failed`
 * om ingen gikk ut), og den delvise unike indeksen slipper neste utsendelse.
 */
export async function drainCampaign(
  campaignId: string,
  options: { render: RenderRecipient; templateName: string; timeBudgetMs?: number },
): Promise<DrainResult> {
  const db = createAdminClient()
  const startedAt = Date.now()
  const budget = options.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS
  let firstBatch = true

  while (Date.now() - startedAt < budget) {
    const { data: pending, error } = await db
      .from('email_campaign_recipients')
      .select('email, name, contact_id, unsubscribe_url')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .order('email')
      .limit(BATCH_SIZE)

    if (error) throw new Error(`Could not read the send queue: ${error.message}`)
    if (!pending || pending.length === 0) break

    if (!firstBatch) await wait(BATCH_SPACING_MS)
    firstBatch = false

    const payloads = pending.map((recipient) => options.render(recipient))
    // Samme sett med mottakere gir samme nøkkel, også i neste runde.
    const key = `campaign-${campaignId}-${pending[0].email}-${pending.length}`.slice(0, 256)
    const outcomes = await sendBatch(payloads, key)
    const sentAt = new Date().toISOString()

    const { error: markError } = await db.from('email_campaign_recipients').upsert(
      outcomes.map((outcome, index) => ({
        campaign_id: campaignId,
        email: pending[index].email,
        status: outcome.error ? 'failed' as const : 'sent' as const,
        resend_id: outcome.resendId,
        error: outcome.error,
        sent_at: outcome.error ? null : sentAt,
      })),
      { onConflict: 'campaign_id,email' },
    )
    if (markError) throw new Error(`Could not record the send: ${markError.message}`)

    // Sporet, som for enkelt-e-postene. Feiler loggen, går utsendelsen videre.
    const { error: logError } = await db.from('email_logs').insert(outcomes.map((outcome, index) => ({
      recipient_email: outcome.email,
      subject: payloads[index].subject ?? null,
      template_name: options.templateName,
      resend_email_id: outcome.resendId,
      status: outcome.error ? 'failed' as const : 'sent' as const,
      error_message: outcome.error,
      sent_at: outcome.error ? null : sentAt,
    })))
    if (logError) console.warn(`[BulkEmail] Could not write email_logs: ${logError.message}`)
  }

  const counts = await countRecipients(campaignId)
  const done = counts.pending === 0
  const status: EmailCampaignStatus = done ? (counts.sent === 0 && counts.failed > 0 ? 'failed' : 'sent') : 'sending'

  await db
    .from('email_campaigns')
    .update({
      sent_count: counts.sent,
      failed_count: counts.failed,
      status,
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq('id', campaignId)

  return {
    status,
    recipientCount: counts.pending + counts.sent + counts.failed,
    sent: counts.sent,
    failed: counts.failed,
    remaining: counts.pending,
  }
}
