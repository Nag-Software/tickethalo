import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, MessageCircle } from 'lucide-react'
import { getCurrentArtist } from '@/lib/artist-portal'
import { loadInbox } from '@/lib/lineup-messages'
import { showDateLabel } from '@/lib/email/templates'
import { Chip, PageHeader, Panel, portalButton } from '@/components/artist/portal-ui'
import type { LineupMessageKind } from '@/types/database'
import { MarkThreadRead } from './mark-read'

const KIND_LABEL: Record<LineupMessageKind, string> = {
  message: 'Message',
  reminder: 'Reminder',
  group_invite: 'Group chat',
}

const when = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' }).format(new Date(value))

/** Meldingene om ett show. Bare dem komikeren selv fikk — `loadInbox` leser via mottakerradene. */
export default async function ArtistMessageThreadPage({ params }: { params: Promise<{ showId: string }> }) {
  const { showId } = await params
  const { artist, db } = await getCurrentArtist()
  const [thread] = await loadInbox(db, artist.id, showId)
  if (!thread) notFound()

  const groupLink = thread.messages.find((message) => message.groupLink)?.groupLink ?? null

  return (
    <>
      <MarkThreadRead showId={showId} unread={thread.unread} />
      <Link href="/artist-app/messages" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-[var(--ev-muted)] hover:text-[var(--ev-text)]">
        <ArrowLeft className="size-4" aria-hidden />
        All messages
      </Link>
      <PageHeader
        title={thread.showTitle}
        description={[thread.clubName, showDateLabel(thread.showDate)].filter(Boolean).join(' · ')}
        actions={
          groupLink ? (
            <a href={groupLink} target="_blank" rel="noreferrer" className={portalButton.primary}>
              <MessageCircle className="size-4" aria-hidden />
              Join the group chat
            </a>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3">
        {thread.messages.map((message) => (
          <Panel key={message.id} className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Chip tone={message.readAt ? 'neutral' : 'accent'}>{KIND_LABEL[message.kind]}</Chip>
                <span className="text-[13px] text-[var(--ev-muted)]">
                  {message.senderName ? `${message.senderName}, ${thread.clubName ?? 'the club'}` : thread.clubName ?? 'The club'}
                </span>
              </div>
              <span className="text-[12.5px] text-[var(--ev-faint)]">{when(message.createdAt)}</span>
            </div>
            <p className="whitespace-pre-line break-words text-[14.5px] leading-relaxed">{message.body}</p>
            {message.groupLink && (
              <a href={message.groupLink} target="_blank" rel="noreferrer" className={`${portalButton.secondary} w-fit`}>
                Join the group chat
              </a>
            )}
          </Panel>
        ))}
      </div>

      <p className="text-[13px] text-[var(--ev-muted)]">
        To answer, reply to the email you got. It goes straight to the club.
      </p>
    </>
  )
}
