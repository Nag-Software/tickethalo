import Image from 'next/image'
import Link from 'next/link'
import {
  AudioLines,
  Calendar,
  Check,
  CircleDashed,
  Clock,
  Crown,
  Mic,
  Star,
  Ticket,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { DeleteButton } from '@/components/admin/delete-button'
import type { BookingSpot } from '@/lib/booking-spots'
import { canonicalRoleLabel, canonicalRoleValue } from '@/lib/artist-roles'
import type { CanonicalArtistRole } from '@/lib/artist-roles'
import type { ShowStatus } from '@/types/database'
import { cn } from '@/lib/utils'

export type BookingCardShow = {
  id: string
  title: string
  date: string
  status: ShowStatus
  posterUrl: string | null
  capacity: number | null
  soldTickets: number
  spots: BookingSpot[]
}

export const SHOW_STATUS_LABELS: Record<ShowStatus, string> = {
  draft: 'Planning',
  booking: 'Booking',
  fullbooked: 'Fully booked',
  published: 'Published',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const SHOW_STATUS_CHIP: Record<ShowStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  booking: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  fullbooked: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',
  published: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400',
  completed: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
}

const ROLE_ICONS: Record<CanonicalArtistRole, LucideIcon> = {
  headliner: Crown,
  konferansier: Star,
  'stand-up': Mic,
  'open mic': AudioLines,
}

/** How many segments the progress bar draws before falling back to a single line. */
const MAX_PROGRESS_SEGMENTS = 12

export function RoleIcon({ roleName, className }: { roleName: string; className?: string }) {
  const canonical = canonicalRoleValue(roleName)
  const Icon = canonical ? ROLE_ICONS[canonical] : Mic
  return <Icon className={className} />
}

export function ShowBookingCard({
  show,
  deleteAction,
  linked = true,
  lineup,
}: {
  show: BookingCardShow
  /** Omit on the show's own page — the header already carries a delete button. */
  deleteAction?: (formData: FormData) => Promise<void>
  /** false on the show's own page, where every link would point at the current page. */
  linked?: boolean
  /** Replaces the read-only spot list — see `InteractiveBookingCard`. */
  lineup?: React.ReactNode
}) {
  const date = new Date(show.date)
  const day = date.getDate()
  const month = date.toLocaleDateString('en-GB', { month: 'short' })
  const year = date.getFullYear()
  const formattedDate = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  const totalSpots = show.spots.length
  const bookedSpots = show.spots.filter((spot) => spot.state === 'booked').length
  const showDetailHref = `/admin-app/shows/${show.id}`
  const Wrapper = linked ? Link : PlainLink
  const showsTicketSales = show.status === 'published' || show.status === 'completed'
  const fillPercent = show.capacity ? Math.min(Math.round((show.soldTickets / show.capacity) * 100), 100) : 0

  return (
    <article
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition',
        linked && 'hover:-translate-y-0.5 hover:shadow-md',
      )}
    >
      <header className="flex items-start gap-4 p-5">
        <Wrapper href={showDetailHref} className="shrink-0 text-center">
          <span className="flex size-14 flex-col items-center justify-center rounded-xl bg-[var(--ev-accent-fill)] leading-none text-white">
            <span className="text-2xl font-black tabular-nums">{day}</span>
            <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.16em]">{month}</span>
          </span>
          <span className="mt-1.5 block text-[11px] font-medium tabular-nums text-muted-foreground">{year}</span>
        </Wrapper>

        <div className="min-w-0 flex-1">
          <Wrapper
            href={showDetailHref}
            className={cn('line-clamp-2 text-xl font-bold leading-tight tracking-tight', linked && 'hover:underline')}
          >
            {show.title}
          </Wrapper>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="size-3.5 shrink-0" />
            {formattedDate}
          </p>
        </div>

        <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium', SHOW_STATUS_CHIP[show.status])}>
          {SHOW_STATUS_LABELS[show.status]}
        </span>
      </header>

      <Wrapper href={showDetailHref} className="block border-y bg-muted/50">
        {show.posterUrl ? (
          <div className="relative aspect-[16/9] w-full bg-zinc-950">
            <Image
              src={show.posterUrl}
              alt={show.title}
              fill
              sizes="(max-width: 1024px) 100vw, (max-width: 1536px) 50vw, 33vw"
              className="object-contain"
            />
          </div>
        ) : (<></>)
      }
        {/*} : (
          <div className="flex aspect-[11/4] w-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
            <span className="text-3xl font-light leading-none">+</span>
            <span className="max-w-[16rem] text-xs font-medium leading-5 text-balance">
              Add poster, or design one with templates based on your brand
            </span>
          </div> 
        )}
        */}
      </Wrapper>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <section className="@container overflow-hidden rounded-xl border">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Booking status</p>
              <p className="mt-0.5 text-sm font-bold tabular-nums">
                {totalSpots > 0 ? `${bookedSpots}/${totalSpots} spots filled` : 'No spots set up'}
              </p>
            </div>
            <BookingProgress booked={bookedSpots} total={totalSpots} />
          </div>

          {lineup ?? (totalSpots > 0 ? (
            <ul className="border-t">
              {show.spots.map((spot) => (
                <BookingSpotRow key={spot.key} spot={spot} />
              ))}
            </ul>
          ) : (
            <p className="border-t px-4 py-4 text-xs text-muted-foreground">
              Set up lineup spots to start booking.
            </p>
          ))}
        </section>

        {showsTicketSales && (
          <section className="rounded-xl border px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Ticket className="size-3.5" />
                Ticket sales
              </p>
              <p className="text-sm font-bold tabular-nums">
                {show.capacity == null ? `${show.soldTickets} sold` : `${show.soldTickets}/${show.capacity} sold`}
              </p>
            </div>
            {show.capacity != null && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${fillPercent}%` }} />
              </div>
            )}
          </section>
        )}

        {deleteAction && (
          <div className="mt-auto flex items-center justify-between gap-3 pt-1">
            <Link
              href={showDetailHref}
              className="rounded-lg border px-3.5 py-2 text-xs font-medium transition-colors hover:bg-muted"
            >
              View details
            </Link>
            <DeleteButton
              action={deleteAction}
              id={show.id}
              idField="show_id"
              label="Delete show"
              tone="danger"
              confirmMessage={`Delete the show "${show.title}"? This cannot be undone.`}
            />
          </div>
        )}
      </div>
    </article>
  )
}

/** Stands in for the Link when the card renders on the page it would link to. */
function PlainLink({ href, ...props }: { href: string } & React.ComponentProps<'div'>) {
  void href
  return <div {...props} />
}

export function BookingProgress({ booked, total }: { booked: number; total: number }) {
  if (total === 0) {
    return <div className="h-1.5 w-20 shrink-0 rounded-full bg-muted @[26rem]:w-36" />
  }

  if (total > MAX_PROGRESS_SEGMENTS) {
    const percent = Math.round((booked / total) * 100)
    return (
      <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted @[26rem]:w-36">
        <div className="h-full rounded-full bg-[var(--ev-accent-fill)]" style={{ width: `${percent}%` }} />
      </div>
    )
  }

  return (
    <div className="flex w-20 shrink-0 gap-1 @[26rem]:w-36">
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={cn('h-1.5 flex-1 rounded-full', index < booked ? 'bg-[var(--ev-accent-fill)]' : 'bg-muted')}
        />
      ))}
    </div>
  )
}

function BookingSpotRow({ spot }: { spot: BookingSpot }) {
  const roleLabel = canonicalRoleLabel(spot.roleName) ?? spot.roleName
  const isOpen = spot.state === 'open'

  return (
    <li className="flex items-stretch border-t text-xs first:border-t-0">
      <div className="flex w-9 shrink-0 items-center justify-center py-3 @[30rem]:w-11">
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-md text-[11px] font-bold tabular-nums',
            spot.state === 'booked' && 'bg-[var(--ev-accent-fill)] text-white',
            spot.state === 'pending' && 'bg-amber-500 text-white',
            isOpen && 'bg-muted text-muted-foreground',
          )}
        >
          {spot.position}
        </span>
      </div>

      <div
        className={cn(
          'flex w-9 shrink-0 items-center justify-center gap-1.5 py-3 @[22rem]:w-24 @[22rem]:justify-start @[22rem]:px-2.5 @[30rem]:w-28',
          spot.state === 'booked' && 'bg-[var(--ev-accent-fill)]/10 text-[var(--ev-accent)] dark:text-[var(--ev-accent-fill)]',
          spot.state === 'pending' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
          isOpen && 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
        )}
      >
        <RoleIcon roleName={spot.roleName} className="size-3.5 shrink-0" />
        <span className="hidden truncate font-medium @[22rem]:inline">{roleLabel}</span>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3">
        <span className={cn('min-w-0 flex-1 truncate', spot.artistName ? 'font-semibold' : 'text-muted-foreground')}>
          {spot.artistName ?? 'Not booked'}
        </span>
        <span className="hidden w-[5.5rem] shrink-0 truncate text-muted-foreground @[30rem]:block">{spot.feeLabel}</span>
      </div>

      <div className="flex shrink-0 items-center justify-end py-3 pr-3 @[30rem]:w-[8.25rem]">
        <SpotStatusBadge state={spot.state} />
      </div>
    </li>
  )
}

export function SpotStatusBadge({ state }: { state: BookingSpot['state'] }) {
  if (state === 'booked') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-400">
        <Check className="size-3.5" />
        Booked
      </span>
    )
  }

  if (state === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-400">
        <Clock className="size-3.5" />
        Offer sent
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-200 bg-background px-2.5 py-1 font-medium text-blue-600 dark:border-blue-900 dark:text-blue-400">
      <CircleDashed className="size-3.5" />
      Available
    </span>
  )
}
