'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Eye, Mail, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { showPromoEmail } from '@/lib/email/show-promo'
import {
  continueShowEmailAction,
  sendShowEmailTestAction,
  startShowEmailAction,
  type SendProgress,
} from './email-actions'

/**
 * «Send e-mail about show» — utkast, forhåndsvisning, test og utsending.
 *
 * Emnet og teksten er forhåndsutfylt og kan endres. Forhåndsvisningen bygges
 * med samme mal som serveren sender (`showPromoEmail`), så det klubben ser er
 * det publikum får.
 *
 * Utsendingen går i runder: hver server action sender så mye den rekker på
 * noen sekunder, og kortet kaller igjen til køen er tom. Lukkes fanen
 * underveis, står resten i kø og kan fortsettes herfra.
 */

export type CampaignSummary = {
  id: string
  createdAt: string
  createdBy: string | null
  status: 'sending' | 'sent' | 'failed'
  recipientCount: number
  sentCount: number
  failedCount: number
}

const number = (value: number) => value.toLocaleString('en-GB')
const people = (value: number) => `${number(value)} ${value === 1 ? 'person' : 'people'}`
const when = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' }).format(new Date(value))

export function SendEmailCard({
  showId,
  clubName,
  showTitle,
  posterUrl,
  publicUrl,
  defaultSubject,
  defaultBody,
  recipientCount,
  isPublished,
  userEmail,
  campaigns,
}: {
  showId: string
  clubName: string
  showTitle: string
  posterUrl: string | null
  publicUrl: string
  defaultSubject: string
  defaultBody: string
  recipientCount: number
  isPublished: boolean
  userEmail: string | null
  campaigns: CampaignSummary[]
}) {
  const router = useRouter()
  const [subject, setSubject] = useState(defaultSubject)
  const [body, setBody] = useState(defaultBody)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmResend, setConfirmResend] = useState(false)
  const [testing, setTesting] = useState(false)
  const [progress, setProgress] = useState<SendProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const running = campaigns.find((campaign) => campaign.status === 'sending') ?? null
  const lastSent = campaigns.find((campaign) => campaign.status === 'sent') ?? null
  const sending = progress !== null && progress.remaining > 0

  const preview = useMemo(
    () => showPromoEmail({ clubName, subject, body, showTitle, posterUrl, ticketUrl: publicUrl, unsubscribeUrl: null }),
    [clubName, subject, body, showTitle, posterUrl, publicUrl],
  )

  async function sendTest() {
    setTesting(true)
    const result = await sendShowEmailTestAction({ showId, subject, body })
    setTesting(false)
    if ('error' in result) toast.error(result.error)
    else toast.success(`Test email sent to ${result.to}`)
  }

  /** Runde etter runde til køen er tom. */
  async function drain(first: SendProgress) {
    let current = first
    setProgress(current)
    while (current.remaining > 0) {
      const next = await continueShowEmailAction({ showId, campaignId: current.campaignId })
      if ('error' in next) {
        setError(`${next.error} ${number(current.remaining)} are still waiting — continue below.`)
        setProgress(null)
        router.refresh()
        return
      }
      current = next
      setProgress(current)
    }
    setProgress(null)
    if (current.failed > 0) toast.warning(`Sent to ${people(current.sent)}. ${number(current.failed)} could not be delivered.`)
    else toast.success(`Sent to ${people(current.sent)}`)
    router.refresh()
  }

  async function startSend() {
    setError(null)
    setConfirmOpen(false)
    setProgress({ campaignId: '', status: 'sending', recipientCount, sent: 0, failed: 0, remaining: recipientCount })
    const result = await startShowEmailAction({ showId, subject, body, confirmResend })
    if ('error' in result) {
      setProgress(null)
      setError(result.error)
      return
    }
    await drain(result)
  }

  async function resume(campaign: CampaignSummary) {
    setError(null)
    setProgress({
      campaignId: campaign.id,
      status: 'sending',
      recipientCount: campaign.recipientCount,
      sent: campaign.sentCount,
      failed: campaign.failedCount,
      remaining: campaign.recipientCount - campaign.sentCount - campaign.failedCount,
    })
    const result = await continueShowEmailAction({ showId, campaignId: campaign.id })
    if ('error' in result) {
      setProgress(null)
      setError(result.error)
      return
    }
    await drain(result)
  }

  const blockedReason = isPublished ? null : 'Publish the show first — the email links to its page.'
  const canSend = isPublished && recipientCount > 0 && !sending && !running && subject.trim() !== '' && body.trim() !== ''

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <Mail className="size-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Send e-mail about show</h3>
          <p className="mt-1 text-sm text-muted-foreground">Promote your show by sending an e-mail to everyone on your list.</p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Subject</span>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            maxLength={200}
            disabled={sending}
            className="h-10 rounded-lg border bg-background px-3 text-sm outline-none focus:border-[var(--ev-accent-fill)]"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Email</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={12}
            disabled={sending}
            className="rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:border-[var(--ev-accent-fill)]"
          />
          <span className="text-xs text-muted-foreground">
            The poster, a “Get tickets” button and an unsubscribe link are added for you.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setPreviewOpen(true)}>
            <Eye />
            Preview
          </Button>
          <Button variant="outline" disabled={testing || sending || !userEmail} onClick={() => void sendTest()}>
            {testing ? 'Sending test…' : 'Send test to myself'}
          </Button>
          <Button className="ml-auto" disabled={!canSend} onClick={() => { setConfirmResend(false); setConfirmOpen(true) }}>
            <Send />
            Send email
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          {recipientCount === 0 ? (
            <>
              No one on your list yet.{' '}
              <Link href="/admin-app/marketing" className="font-medium text-foreground hover:underline">
                Go to Marketing
              </Link>{' '}
              to import contacts.
            </>
          ) : (
            <>
              Goes to {people(recipientCount)} on your list who have not unsubscribed.
              {userEmail && <> The test goes to {userEmail}.</>}
            </>
          )}
        </p>
        {blockedReason && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">{blockedReason}</p>}

        {progress && (
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
            Sending… {number(progress.sent + progress.failed)} / {number(progress.recipientCount)}
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[var(--ev-accent-fill)] transition-all"
                style={{ width: `${progress.recipientCount ? Math.round(((progress.sent + progress.failed) / progress.recipientCount) * 100) : 0}%` }}
              />
            </div>
          </div>
        )}
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {running && !progress && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <span>
              Sending paused — {number(running.recipientCount - running.sentCount - running.failedCount)} of{' '}
              {number(running.recipientCount)} left.
            </span>
            <Button size="sm" onClick={() => void resume(running)}>
              Continue sending
            </Button>
          </div>
        )}

        {campaigns.length > 0 && (
          <div className="border-t pt-4">
            <h4 className="text-xs font-medium text-muted-foreground">Sent before</h4>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="flex flex-wrap justify-between gap-x-3">
                  <span>
                    {when(campaign.createdAt)}
                    {campaign.createdBy && <span className="text-muted-foreground"> · {campaign.createdBy}</span>}
                  </span>
                  <span className="text-muted-foreground">
                    {campaign.status === 'sending'
                      ? `${number(campaign.sentCount)} of ${number(campaign.recipientCount)} sent`
                      : `${people(campaign.sentCount)}${campaign.failedCount ? ` · ${number(campaign.failedCount)} failed` : ''}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-3">
          <div>
            <DialogTitle className="text-lg font-semibold">Preview</DialogTitle>
            <DialogDescription className="mt-1 text-muted-foreground">
              From {clubName} · {preview.subject}
            </DialogDescription>
          </div>
          <iframe
            title="Email preview"
            srcDoc={preview.html}
            sandbox=""
            className="h-[70dvh] w-full rounded-lg border bg-white"
          />
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <div>
            <DialogTitle className="text-lg font-semibold">Send to {people(recipientCount)}?</DialogTitle>
            <DialogDescription className="mt-2 text-muted-foreground">
              “{subject}” goes out now to everyone on your list who has not unsubscribed. It cannot be undone.
            </DialogDescription>
          </div>
          {lastSent && (
            <label className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
              <input
                type="checkbox"
                checked={confirmResend}
                onChange={(event) => setConfirmResend(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--ev-accent-fill)]"
              />
              <span>
                <span className="font-medium">Send again anyway</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  You sent this show to {people(lastSent.sentCount)} on {when(lastSent.createdAt)}.
                </span>
              </span>
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button disabled={Boolean(lastSent) && !confirmResend} onClick={() => void startSend()}>
              Send to {people(recipientCount)}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
