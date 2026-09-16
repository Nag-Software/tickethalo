'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, ChevronRight, Inbox, Megaphone, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { RoleIcon } from '@/components/admin/show-booking-card'
import {
  approveSubmissionAction,
  declineSubmissionAction,
  reopenSubmissionAction,
} from '@/lib/actions/submissions'
import { LineupCallout, SpotNumber, spotCardClass } from './lineup-ui'
import type { SubmissionGroup, SubmissionItem } from './submissions-data'

/**
 * Søknadsfanen: komikerne som har meldt seg på showets åpne plasser.
 *
 * Tegnet med de samme delene som lineup-fanen — én kortflate per plass, med
 * plassnummer og rolle i hodet — så bookeren kjenner igjen plassene hen
 * åpnet. Hver søknad er én rad: hvem (lenke til profilen), hva hen skrev,
 * og ja eller nei.
 */

type Filter = 'waiting' | 'handled' | 'all'

const OPEN_STATUSES = new Set(['pending', 'shortlisted'])
const PILL_CLASS = 'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium'

function isWaiting(item: SubmissionItem) {
  return OPEN_STATUSES.has(item.status)
}

/** Hva som skjedde med en behandlet søknad — og med tilbudet den ble. */
function outcome(item: SubmissionItem): { label: string; className: string } {
  switch (item.status) {
    case 'accepted':
      switch (item.offerStatus) {
        case 'accepted':
          return { label: 'Booked', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' }
        case 'declined':
          return { label: 'Turned down the offer', className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400' }
        case 'expired':
          return { label: 'Offer expired', className: 'bg-muted text-muted-foreground' }
        case 'cancelled':
          return { label: 'Offer cancelled', className: 'bg-muted text-muted-foreground' }
        case 'filled_by_other':
          return { label: 'Spot went to someone else', className: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400' }
        default:
          return { label: 'Offer sent', className: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400' }
      }
    case 'declined':
      return { label: 'Declined', className: 'bg-muted text-muted-foreground' }
    case 'withdrawn':
      return { label: 'Withdrew', className: 'bg-muted text-muted-foreground' }
    case 'filled_by_other':
      return { label: 'Spot filled', className: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400' }
    default:
      return { label: 'Waiting', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400' }
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function SubmissionsTab({
  showId,
  groups,
}: {
  showId: string
  groups: SubmissionGroup[]
}) {
  const allItems = groups.flatMap((group) => group.items)
  const waitingCount = allItems.filter(isWaiting).length
  const handledCount = allItems.length - waitingCount
  const offersSent = allItems.filter((item) => item.status === 'accepted').length
  const anyOpen = groups.some((group) => group.open)

  // Starter på det som venter — med mindre ingenting gjør det.
  const [filter, setFilter] = React.useState<Filter>(waitingCount > 0 ? 'waiting' : 'all')

  const lineupHref = `/admin-app/shows/${showId}?tab=lineup`

  if (allItems.length === 0) {
    return (
      <LineupCallout
        title={anyOpen ? 'No applications yet' : 'No spots are open for submissions'}
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={lineupHref}>
              {anyOpen ? 'Submission settings' : 'Open a spot'}
              <ChevronRight data-icon="inline-end" />
            </Link>
          </Button>
        }
      >
        <p className="text-[13px] text-muted-foreground">
          {anyOpen
            ? 'Comedians who apply for your open spots show up here, ready for a yes or a no.'
            : 'Open a lineup spot for submissions and comedians can apply for it themselves. Their applications land here.'}
        </p>
      </LineupCallout>
    )
  }

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        filter === 'all' ? true : filter === 'waiting' ? isWaiting(item) : !isWaiting(item),
      ),
    }))
    // En åpen plass uten søknader blir stående under «Waiting» og «All»: den
    // sier at det er stille, ikke at plassen er borte.
    .filter((group) => group.items.length > 0 || (group.open && filter !== 'handled'))

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'waiting', label: 'Waiting', count: waitingCount },
    { key: 'handled', label: 'Handled', count: handledCount },
    { key: 'all', label: 'All', count: allItems.length },
  ]

  return (
    <div className="space-y-3">
      {/* ── Oppsummering og filter ─────────────────────────────── */}
      <div className={cn(spotCardClass, 'flex flex-wrap items-center gap-x-3 gap-y-2 py-2 pl-4 pr-3')}>
        <Inbox className="size-[18px] shrink-0 text-[var(--ev-accent-fill)]" aria-hidden />
        <span className="text-sm font-bold whitespace-nowrap">
          {waitingCount > 0
            ? `${waitingCount} waiting for an answer`
            : 'All caught up'}
        </span>
        {offersSent > 0 && (
          <span className="text-[13px] whitespace-nowrap text-muted-foreground">
            {offersSent} offer{offersSent === 1 ? '' : 's'} sent from applications
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-4xl bg-muted p-[3px]" role="tablist" aria-label="Filter applications">
            {filters.map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={filter === key}
                onClick={() => setFilter(key)}
                className={cn(
                  'inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-4xl px-3 text-[13px] font-medium transition-colors',
                  filter === key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
                <span className={cn('tabular-nums', filter === key ? 'opacity-70' : 'opacity-60')}>{count}</span>
              </button>
            ))}
          </div>
          <Link
            href={lineupHref}
            className="hidden text-[13px] whitespace-nowrap text-muted-foreground hover:text-foreground sm:inline"
          >
            Settings
          </Link>
        </div>
      </div>

      {visibleGroups.length === 0 && (
        <div className={cn(spotCardClass, 'flex flex-col items-center gap-1 px-6 py-12 text-center')}>
          <Check className="mb-1 size-6 text-[var(--ev-accent-fill)]" aria-hidden />
          <p className="text-sm font-semibold">
            {filter === 'waiting' ? 'Nothing waiting' : 'Nothing handled yet'}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {filter === 'waiting'
              ? 'Every application has an answer. New ones show up here.'
              : 'Applications you approve or decline move here.'}
          </p>
        </div>
      )}

      {visibleGroups.map((group) => (
        <SpotGroup key={group.requirementId} group={group} lineupHref={lineupHref} />
      ))}
    </div>
  )
}

// ─── Én plass ────────────────────────────────────────────────────────────────

function SpotGroup({ group, lineupHref }: { group: SubmissionGroup; lineupHref: string }) {
  const isFull = group.filled >= group.quantity

  return (
    <section className={cn(spotCardClass, 'overflow-hidden')} aria-label={`${group.roleName} applications`}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5 sm:px-5">
        <SpotNumber position={group.position} />
        <RoleIcon roleName={group.roleName} className="size-5 shrink-0 text-[var(--ev-accent-fill)]" />
        <span className="truncate text-base font-bold">{group.roleName}</span>
        <span className="text-[13px] whitespace-nowrap text-muted-foreground">{group.feeLabel}</span>

        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              PILL_CLASS,
              isFull
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {isFull ? 'Filled' : `${group.filled} of ${group.quantity} filled`}
          </span>
          <span
            className={cn(
              PILL_CLASS,
              'gap-1',
              group.open ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground',
            )}
            title={group.open ? 'Comedians can apply for this spot' : 'Closed for new applications'}
          >
            <Megaphone className="size-3" aria-hidden />
            {group.open ? 'Open' : 'Closed'}
          </span>
        </div>
      </header>

      {group.items.length === 0 ? (
        <p className="border-t px-4 py-5 text-[13px] text-muted-foreground sm:px-5">
          No applications for this spot yet.{' '}
          <Link href={lineupHref} className="underline underline-offset-[3px] hover:text-foreground">
            Change who can apply
          </Link>
        </p>
      ) : (
        <ul className="divide-y border-t">
          {group.items.map((item) => (
            <SubmissionRow key={item.id} item={item} roleName={group.roleName} />
          ))}
        </ul>
      )}
    </section>
  )
}

// ─── Én søknad ───────────────────────────────────────────────────────────────

function SubmissionRow({ item, roleName }: { item: SubmissionItem; roleName: string }) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const waiting = isWaiting(item)
  const profileHref = `/admin-app/artists/${item.artist.id}`

  function run(
    action: (fd: FormData) => Promise<unknown>,
    { success, failure }: { success: (result: unknown) => void; failure: string },
  ) {
    const fd = new FormData()
    fd.set('submission_id', item.id)

    startTransition(async () => {
      try {
        const result = await action(fd)
        success(result)
        router.refresh()
      } catch (err: unknown) {
        toast.error((err as Error)?.message || failure)
      }
    })
  }

  function approve() {
    run(approveSubmissionAction, {
      failure: 'Could not approve the application',
      success: () =>
        toast.success(`Offer sent to ${item.artist.name}`, {
          description: `They get a booking offer for ${roleName} to accept or decline.`,
        }),
    })
  }

  function decline() {
    run(declineSubmissionAction, {
      failure: 'Could not decline the application',
      success: () =>
        toast(`Declined ${item.artist.name}`, {
          action: { label: 'Undo', onClick: reopen },
        }),
    })
  }

  function reopen() {
    run(reopenSubmissionAction, {
      failure: 'Could not reopen the application',
      success: () => toast.success(`${item.artist.name} is back in Waiting`),
    })
  }

  const result = outcome(item)

  return (
    <li
      className={cn(
        'flex flex-col gap-3 px-4 py-4 transition-opacity sm:flex-row sm:items-start sm:gap-4 sm:px-5',
        pending && 'opacity-60',
      )}
    >
      <div className="min-w-0 flex-1">
        <Link href={profileHref} className="group flex min-w-0 items-start gap-3 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <Avatar className="size-11">
            {item.artist.imageUrl && <AvatarImage src={item.artist.imageUrl} alt="" />}
            <AvatarFallback className="text-sm font-semibold">{initials(item.artist.name)}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 space-y-0.5 pt-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold underline-offset-[3px] group-hover:underline">
                {item.artist.name}
              </span>
              {item.artist.legalName && (
                <span className="truncate text-[13px] text-muted-foreground">{item.artist.legalName}</span>
              )}
              <ChevronRight
                className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
            </div>

            <p className="text-[13px] text-muted-foreground">
              {[...item.artist.details, `Applied ${item.appliedLabel}`].join(' · ')}
            </p>

            {(item.source === 'invitation' || !item.onRoster || item.flagged || item.status === 'shortlisted') && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {item.status === 'shortlisted' && (
                  <span className="rounded-md bg-[var(--ev-accent-fill)]/10 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                    Shortlisted
                  </span>
                )}
                {item.source === 'invitation' && (
                  <span className="rounded-md bg-[var(--ev-accent-fill)]/10 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                    Invited
                  </span>
                )}
                {!item.onRoster && (
                  <span
                    className="rounded-md bg-background px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border"
                    title="Approving adds this comedian to your club"
                  >
                    New to your club
                  </span>
                )}
                {item.flagged && (
                  <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                    Flagged
                  </span>
                )}
              </div>
            )}
          </div>
        </Link>

        {item.message && (
          <blockquote className="mt-2.5 ml-14 rounded-xl bg-muted/60 px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-line text-foreground/90">
            {item.message}
          </blockquote>
        )}
      </div>

      <div className="flex shrink-0 flex-col items-stretch gap-1.5 pl-14 sm:items-end sm:pl-0">
        {waiting ? (
          <>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={decline}
                disabled={pending}
                className="flex-1 sm:flex-none"
              >
                <X data-icon="inline-start" />
                Decline
              </Button>
              <Button
                size="sm"
                onClick={approve}
                disabled={pending || Boolean(item.blocker)}
                title={item.blocker ?? `Send ${item.artist.name} a booking offer`}
                className="flex-1 sm:flex-none"
              >
                <Check data-icon="inline-start" />
                Approve
              </Button>
            </div>
            <p className="text-xs text-muted-foreground sm:text-right">
              {item.blocker ?? (item.onRoster ? 'Approving sends a booking offer' : 'Approving adds them and sends an offer')}
            </p>
          </>
        ) : (
          <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-1">
            <span className={cn(PILL_CLASS, result.className)}>{result.label}</span>
            <div className="flex items-center gap-2">
              {item.respondedLabel && (
                <span className="text-xs text-muted-foreground">{item.respondedLabel}</span>
              )}
              {item.status === 'declined' && (
                <button
                  type="button"
                  onClick={reopen}
                  disabled={pending}
                  className="cursor-pointer text-xs font-medium underline underline-offset-[3px] hover:text-foreground disabled:opacity-50"
                >
                  Undo
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </li>
  )
}
