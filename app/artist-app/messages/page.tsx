import Link from 'next/link'
import { getCurrentArtist } from '@/lib/artist-portal'
import { loadInbox } from '@/lib/lineup-messages'
import { showDateLabel } from '@/lib/email/templates'
import { Chip, Empty, PageHeader, Panel, Row } from '@/components/artist/portal-ui'

/**
 * Meldingene fra klubbene, én rad per show. Komikeren kan stå på show hos
 * flere klubber, så alt henger på komikeren, ikke på klubben.
 *
 * Bare for lesing: svar går på e-post, til den som skrev.
 */
export default async function ArtistMessagesPage() {
  const { artist, db } = await getCurrentArtist()
  const threads = await loadInbox(db, artist.id)

  return (
    <>
      <PageHeader title="Messages" description="From the clubs you are booked by. Reply to the email to answer." />

      <Panel>
        {threads.length === 0 ? (
          <Empty>No messages yet. When a club writes to the line-up of a show you are on, it shows up here.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {threads.map((thread) => {
              const latest = thread.messages[0]
              return (
                <Link
                  key={thread.showId}
                  href={`/artist-app/messages/${thread.showId}`}
                  className="block rounded-[var(--ev-r-art)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]"
                >
                  <Row className="transition-colors hover:bg-[var(--ev-card-hover)]">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-[15px] font-medium">
                        {thread.unread > 0 && <span className="size-2 shrink-0 rounded-full bg-[var(--ev-accent-fill)]" aria-hidden />}
                        <span className="truncate">{thread.showTitle}</span>
                      </p>
                      <p className="mt-0.5 truncate text-[13px] text-[var(--ev-muted)]">
                        {[thread.clubName, showDateLabel(thread.showDate)].filter(Boolean).join(' · ')}
                      </p>
                      {latest && (
                        <p className="mt-1.5 line-clamp-1 text-[13px] text-[var(--ev-muted)]">{latest.body}</p>
                      )}
                    </div>
                    {thread.unread > 0 ? <Chip tone="accent">{thread.unread} new</Chip> : <Chip>{thread.messages.length}</Chip>}
                  </Row>
                </Link>
              )
            })}
          </div>
        )}
      </Panel>
    </>
  )
}
