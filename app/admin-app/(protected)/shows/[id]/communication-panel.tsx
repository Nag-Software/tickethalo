'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BellRing, Check, Copy, Eye, Mail, MessageCircle, Send, TriangleAlert, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { normalizeWhatsAppInviteLink } from '@/lib/whatsapp'
import type { LineupHistoryEntry } from '@/lib/lineup-messages'
import { REMINDER_DAYS_BEFORE, type ReminderPlan } from '@/lib/lineup-reminders'
import type { LineupMessageKind } from '@/types/database'
import {
  continueLineupMessageAction,
  dismissLineupChangeAction,
  sendGroupInviteAction,
  sendLineupMessageAction,
  setLineupArrivalTimeAction,
  setLineupReminderAction,
  type LineupSendProgress,
} from './communication-actions'

/**
 * Klientdelen av Communication-fanen. Dataene kommer ferdig lest fra
 * `CommunicationTab`; her skrives, sendes og kopieres det.
 */

export type CommunicationData = {
  showId: string
  showTitle: string
  clubName: string
  recipients: Array<{ artistId: string; name: string; whatsapp: string | null; waLink: string | null }>
  change: { headline: string; lines: Array<{ field: string; label: string; from: string; to: string }>; suggestion: string } | null
  reminder: {
    showSetting: boolean | null
    clubDefault: boolean
    enabled: boolean
    plan: ReminderPlan
    confirmed: number
    sent: number
    arrivalTime: string
    preview: { subject: string; html: string }
  }
  group: { name: string; pinned: string; link: string | null }
  history: LineupHistoryEntry[]
}

const comedians = (count: number) => `${count} ${count === 1 ? 'comedian' : 'comedians'}`
const when = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' }).format(new Date(value))
const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))

const CARD = 'rounded-2xl border bg-card p-5'
const INPUT = 'rounded-lg border bg-background px-3 text-sm outline-none focus:border-[var(--ev-accent-fill)]'

/** Runde etter runde til køen er tom — lineuper er små, så som regel holder én. */
async function finishSending(showId: string, first: LineupSendProgress): Promise<LineupSendProgress | { error: string }> {
  let current = first
  while (current.remaining > 0) {
    const next = await continueLineupMessageAction({ showId, messageId: current.messageId })
    if ('error' in next) return next
    if (next.remaining === current.remaining) break
    current = next
  }
  return current
}

function reportSent(result: LineupSendProgress) {
  if (result.failed > 0) toast.warning(`Sent to ${comedians(result.sent)}. ${result.failed} could not be delivered.`)
  else if (result.remaining > 0) toast.warning(`Sent to ${comedians(result.sent)}. ${result.remaining} are still waiting — continue in the history.`)
  else toast.success(`Sent to ${comedians(result.sent)}.`)
}

export function CommunicationPanel({ data }: { data: CommunicationData }) {
  const [draft, setDraft] = useState('')
  const composer = useRef<HTMLTextAreaElement>(null)

  function applySuggestion() {
    if (!data.change) return
    setDraft(data.change.suggestion)
    composer.current?.focus()
    composer.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      {data.change && <ChangeNotice showId={data.showId} change={data.change} onUse={applySuggestion} />}
      <MessageCard data={data} draft={draft} setDraft={setDraft} composer={composer} />
      <ReminderCard showId={data.showId} reminder={data.reminder} />
      <GroupChatCard data={data} />
      <HistoryCard showId={data.showId} history={data.history} />
    </div>
  )
}

function CardHeader({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">{icon}</div>
      <div className="min-w-0">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Endringsdyttet
// ─────────────────────────────────────────────────────────────

function ChangeNotice({ showId, change, onUse }: { showId: string; change: NonNullable<CommunicationData['change']>; onUse: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function dismiss() {
    setBusy(true)
    const result = await dismissLineupChangeAction(showId)
    setBusy(false)
    if ('error' in result) toast.error(result.error)
    else router.refresh()
  }

  return (
    <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5" aria-live="polite">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{change.headline}</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {change.lines.map((line) => (
              <li key={line.field} className="break-words">
                <span className="text-muted-foreground">{line.label}:</span> <s className="text-muted-foreground">{line.from}</s> → <strong>{line.to}</strong>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={onUse}>Use suggested message</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void dismiss()}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// Message line-up
// ─────────────────────────────────────────────────────────────

function MessageCard({
  data,
  draft,
  setDraft,
  composer,
}: {
  data: CommunicationData
  draft: string
  setDraft: (value: string) => void
  composer: React.RefObject<HTMLTextAreaElement | null>
}) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const count = data.recipients.length

  async function send() {
    setConfirmOpen(false)
    setSending(true)
    setError(null)
    const started = await sendLineupMessageAction({ showId: data.showId, body: draft })
    const result = 'error' in started ? started : await finishSending(data.showId, started)
    setSending(false)
    if ('error' in result) {
      setError(result.error)
      router.refresh()
      return
    }
    reportSent(result)
    setDraft('')
    router.refresh()
  }

  const names = data.recipients.map((recipient) => recipient.name)

  return (
    <section className={CARD}>
      <CardHeader
        icon={<Mail className="size-4" />}
        title="Message line-up"
        description="An email to everyone confirmed on the line-up. It also shows up in their comedian portal, and replies come back to you."
      />
      <div className="mt-5 flex flex-col gap-3">
        <p className="text-sm">
          <span className="text-muted-foreground">To: </span>
          {count === 0 ? (
            <span className="text-muted-foreground">No one is confirmed yet.</span>
          ) : (
            <>
              {comedians(count)} — {names.slice(0, 4).join(', ')}
              {names.length > 4 && ` and ${names.length - 4} more`}
            </>
          )}
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="sr-only">Message</span>
          <textarea
            ref={composer}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={6}
            maxLength={5000}
            disabled={sending}
            placeholder="Write to your line-up…"
            className={`${INPUT} py-2 leading-relaxed`}
          />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Sent from {data.clubName}. Replies go to your email.</span>
          <Button disabled={count === 0 || sending || !draft.trim()} onClick={() => setConfirmOpen(true)}>
            <Send />
            {sending ? 'Sending…' : 'Send message'}
          </Button>
        </div>
        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <div>
            <DialogTitle className="text-lg font-semibold">Send to {comedians(count)}?</DialogTitle>
            <DialogDescription className="mt-2 text-muted-foreground">
              {names.join(', ')} get the message by email now, and in their portal. It cannot be unsent.
            </DialogDescription>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => void send()}>Send message</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// Påminnelsen
// ─────────────────────────────────────────────────────────────

function reminderStatus(reminder: CommunicationData['reminder']) {
  const sentPart = reminder.sent > 0 ? `Sent to ${comedians(reminder.sent)}. ` : ''
  if (reminder.plan.kind === 'off') return 'Off — the line-up gets no reminder for this show.'
  if (reminder.plan.kind === 'closed') return reminder.sent > 0 ? `Sent to ${comedians(reminder.sent)}.` : 'It is too late to send a reminder for this show.'
  const waiting = reminder.confirmed - reminder.sent
  if (reminder.sent > 0 && waiting === 0) return `Sent to ${comedians(reminder.sent)}. Anyone confirmed later gets it the next morning.`
  return `${sentPart}Goes out ${dayLabel(reminder.plan.on)} in the morning, to everyone confirmed by then.`
}

function ReminderCard({ showId, reminder }: { showId: string; reminder: CommunicationData['reminder'] }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [arrival, setArrival] = useState(reminder.arrivalTime)
  const [previewOpen, setPreviewOpen] = useState(false)

  async function setEnabled(enabled: boolean | null) {
    setSaving(true)
    const result = await setLineupReminderAction({ showId, enabled })
    setSaving(false)
    if ('error' in result) toast.error(result.error)
    else router.refresh()
  }

  async function saveArrival() {
    if (arrival === reminder.arrivalTime) return
    const result = await setLineupArrivalTimeAction({ showId, time: arrival })
    if ('error' in result) toast.error(result.error)
    else {
      toast.success(arrival ? `Arrive by ${arrival} saved.` : 'Arrival time removed.')
      router.refresh()
    }
  }

  return (
    <section className={CARD}>
      <CardHeader
        icon={<BellRing className="size-4" />}
        title="Automatic messages"
        description="Sent for you by email and in the portal. Only to the confirmed line-up, and never for a cancelled show."
      />
      <div className="mt-5 rounded-xl border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">Reminder {REMINDER_DAYS_BEFORE} days before</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Date, start time, venue and address, their spot and fee, and who to contact.</p>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={reminder.enabled}
              disabled={saving}
              onChange={(event) => void setEnabled(event.target.checked)}
              className="size-4 accent-[var(--ev-accent-fill)]"
            />
            Yes, send this
          </label>
        </div>
        <p className="mt-3 text-sm">{reminderStatus(reminder)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Your club default is {reminder.clubDefault ? 'on' : 'off'} (My club).
          {reminder.showSetting !== null && reminder.showSetting !== reminder.clubDefault && (
            <>
              {' '}
              <button type="button" disabled={saving} onClick={() => void setEnabled(null)} className="font-medium text-foreground underline-offset-2 hover:underline">
                Use the default
              </button>
            </>
          )}
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Arrive by (optional)</span>
            <input
              type="time"
              value={arrival}
              onChange={(event) => setArrival(event.target.value)}
              onBlur={() => void saveArrival()}
              className={`${INPUT} h-9 w-32`}
            />
          </label>
          <Button variant="outline" onClick={() => setPreviewOpen(true)}>
            <Eye />
            Preview
          </Button>
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col gap-3">
          <div>
            <DialogTitle className="text-lg font-semibold">Reminder preview</DialogTitle>
            <DialogDescription className="mt-1 text-muted-foreground">{reminder.preview.subject}</DialogDescription>
          </div>
          <iframe title="Reminder preview" srcDoc={reminder.preview.html} sandbox="" className="h-[70dvh] w-full rounded-lg border bg-white" />
        </DialogContent>
      </Dialog>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// Gruppechatten
// ─────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.')
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={() => void copy()} aria-label={label}>
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

function Step({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{number}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <div className="mt-2">{children}</div>
      </div>
    </li>
  )
}

function GroupChatCard({ data }: { data: CommunicationData }) {
  const router = useRouter()
  const [open, setOpen] = useState(Boolean(data.group.link))
  const [link, setLink] = useState(data.group.link ?? '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = normalizeWhatsAppInviteLink(link)
  const count = data.recipients.length

  async function sendInvite() {
    setSending(true)
    setError(null)
    const started = await sendGroupInviteAction({ showId: data.showId, link })
    const result = 'error' in started ? started : await finishSending(data.showId, started)
    setSending(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    reportSent(result)
    router.refresh()
  }

  return (
    <section className={CARD}>
      <CardHeader
        icon={<MessageCircle className="size-4" />}
        title="Group chat"
        description="WhatsApp does not let us create the group for you. You make it in WhatsApp — we have the name, the info to pin and the invite ready."
      />
      {!open ? (
        <Button className="mt-5" variant="outline" onClick={() => setOpen(true)}>
          <Users />
          Start group chat
        </Button>
      ) : (
        <ol className="mt-5 flex flex-col gap-5">
          <Step number={1} title="Create a new group in WhatsApp with this name">
            <div className="flex items-center gap-2">
              <input readOnly value={data.group.name} onFocus={(event) => event.currentTarget.select()} className={`${INPUT} h-9 min-w-0 flex-1`} />
              <CopyButton value={data.group.name} label="Copy group name" />
            </div>
          </Step>
          <Step number={2} title="Add the line-up">
            {count === 0 ? (
              <p className="text-sm text-muted-foreground">No one is confirmed yet.</p>
            ) : (
              <ul className="flex flex-col divide-y rounded-lg border">
                {data.recipients.map((recipient) => (
                  <li key={recipient.artistId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="font-medium">{recipient.name}</span>
                      {recipient.whatsapp && <span className="ml-2 text-muted-foreground">{recipient.whatsapp}</span>}
                    </span>
                    {recipient.waLink ? (
                      <a
                        href={recipient.waLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1 rounded-4xl border px-3 text-xs font-medium hover:bg-muted"
                      >
                        Open in WhatsApp
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">No WhatsApp number — they can join with the invite link</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Step>
          <Step number={3} title="Pin this message at the top">
            <div className="flex flex-col gap-2">
              <textarea readOnly value={data.group.pinned} rows={data.group.pinned.split('\n').length + 1} onFocus={(event) => event.currentTarget.select()} className={`${INPUT} py-2 leading-relaxed`} />
              <div><CopyButton value={data.group.pinned} label="Copy pinned info" /></div>
            </div>
          </Step>
          <Step number={4} title="Paste the group invite link and send it to the line-up">
            <p className="mb-2 text-xs text-muted-foreground">In WhatsApp: group info → Invite via link → Copy link. Everyone gets it by email and in their portal.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={link}
                onChange={(event) => setLink(event.target.value)}
                placeholder="https://chat.whatsapp.com/…"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={link.trim() !== '' && !valid}
                className={`${INPUT} h-9 min-w-0 flex-1`}
              />
              <Button disabled={!valid || count === 0 || sending} onClick={() => void sendInvite()}>
                <Send />
                {sending ? 'Sending…' : 'Send invite to line-up'}
              </Button>
            </div>
            {link.trim() !== '' && !valid && (
              <p className="mt-2 text-xs text-destructive">That is not a WhatsApp group link. It starts with https://chat.whatsapp.com/</p>
            )}
            {error && <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          </Step>
        </ol>
      )}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// Historikken
// ─────────────────────────────────────────────────────────────

const KIND_LABEL: Record<LineupMessageKind, string> = {
  message: 'Message',
  reminder: 'Reminder',
  group_invite: 'Group chat invite',
}

function HistoryCard({ showId, history }: { showId: string; history: LineupHistoryEntry[] }) {
  return (
    <section className={CARD}>
      <h3 className="text-base font-semibold">History</h3>
      {history.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing sent to this line-up yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y">
          {history.map((entry) => <HistoryRow key={entry.id} showId={showId} entry={entry} />)}
        </ul>
      )}
    </section>
  )
}

function HistoryRow({ showId, entry }: { showId: string; entry: LineupHistoryEntry }) {
  const router = useRouter()
  const [continuing, setContinuing] = useState(false)
  const sent = entry.recipients.filter((recipient) => recipient.delivery === 'sent').length
  const failed = entry.recipients.filter((recipient) => recipient.delivery === 'failed')
  const read = entry.recipients.filter((recipient) => recipient.readAt).length
  const waiting = entry.recipients.filter((recipient) => recipient.delivery === 'pending').length

  async function resume() {
    setContinuing(true)
    const result = await finishSending(showId, { messageId: entry.id, sent, failed: failed.length, remaining: waiting })
    setContinuing(false)
    if ('error' in result) toast.error(result.error)
    else reportSent(result)
    router.refresh()
  }

  return (
    <li className="py-3 first:pt-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium">{KIND_LABEL[entry.kind]}</p>
        <p className="text-xs text-muted-foreground">
          {entry.senderName ?? 'Automatic'} · {when(entry.createdAt)}
        </p>
      </div>
      <details className="group mt-1">
        <summary className="cursor-pointer list-none text-sm text-muted-foreground [&::-webkit-details-marker]:hidden">
          <span className="line-clamp-2 whitespace-pre-line group-open:hidden">{entry.body}</span>
          <span className="hidden text-xs font-medium text-foreground group-open:inline">Hide</span>
        </summary>
        <p className="mt-2 whitespace-pre-line text-sm">{entry.body}</p>
        <ul className="mt-3 flex flex-col gap-1 text-xs">
          {entry.recipients.map((recipient) => (
            <li key={recipient.artistId} className="flex flex-wrap justify-between gap-2">
              <span>{recipient.name}</span>
              <span className={recipient.delivery === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
                {recipient.delivery === 'failed'
                  ? `Not delivered${recipient.error ? `: ${recipient.error}` : ''}`
                  : recipient.delivery === 'pending'
                    ? 'Waiting'
                    : 'Sent'}
                {recipient.readAt && ` · Read ${when(recipient.readAt)}`}
              </span>
            </li>
          ))}
        </ul>
      </details>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Sent to {comedians(sent)}</span>
        {failed.length > 0 && (
          <span className="inline-flex items-center gap-1 text-destructive">
            <X className="size-3" aria-hidden /> {failed.length} failed
          </span>
        )}
        <span>Read by {read} of {entry.recipients.length}</span>
        {entry.sending && waiting > 0 && (
          <Button size="xs" variant="outline" disabled={continuing} onClick={() => void resume()}>
            Continue sending ({waiting} left)
          </Button>
        )}
      </div>
    </li>
  )
}
