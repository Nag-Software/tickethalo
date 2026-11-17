'use client'

import * as React from 'react'
import { ArrowRight, ChevronDown, ChevronUp, CircleHelp, GripVertical, Plus, RefreshCw, ShieldCheck, Sparkles, TriangleAlert, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatDuration } from '@/lib/spot-duration'
import { Avatar as UiAvatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SkillLevelBadge } from '@/components/admin/artist-badges'
import { RoleIcon } from '@/components/admin/show-booking-card'
import { allocateWave, type AllocationSpot } from '@/lib/booking-rules'
import type {
  LineupQueue,
  LineupQueueSpot,
  PlanSkipReason,
  QueueComedian,
  QueueOfferState,
} from '@/lib/booking-engine'
import { SKILL_REQUIREMENT_LABELS } from '@/lib/artist-score'
import { getLineupQueueAction, saveLineupQueueAction, startBookingAction } from '../actions'
import { LineupCallout, SuggestFromSubmissionsToggle } from './lineup-ui'

type LoadedQueue = Extract<LineupQueue, { ok: true }>
type Addable = QueueComedian & { removed: boolean }

const SKIP_TEXT: Record<PlanSkipReason, string> = {
  not_running: 'This show is not booking right now.',
  no_spots: 'Add at least one lineup spot first.',
  show_day: 'It is the day of the show. No offers go out today — book comedians directly.',
  no_candidates: 'No comedians on your list can be booked for this date.',
  load_failed: 'Could not load the line-up. Try again.',
}

const STATE_TEXT: Record<QueueOfferState, string> = {
  sent: 'Offer sent',
  accepted: 'Said yes',
  booked: 'Booked',
  declined: 'Said no',
  expired: 'No answer',
}

const STATE_CLASS: Record<QueueOfferState, string> = {
  sent: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  booked: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  declined: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
  expired: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

function countWord(n: number) {
  return NUMBER_WORDS[n] ?? String(n)
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name
}

/** «Fri 4 Dec» — samme korte form i overskriften og fristen. */
function shortDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' }).format(date)
}

/**
 * Grunnen til at komikeren står der hen står: når hen spilte her sist.
 *
 * Motoren sprer bookingene, så den som ikke har vært her på lenge, kommer
 * høyt. Uten den linjen ser rekkefølgen tilfeldig ut.
 */
function lastHereText(date: string | null, today: Date) {
  if (!date) return 'Never played here'
  const then = Date.parse(`${date}T12:00:00Z`)
  if (Number.isNaN(then)) return 'Played here before'
  const days = Math.round((today.getTime() - then) / (24 * 60 * 60 * 1000))
  if (days < 0) return `Also booked here ${shortDate(date)}`
  if (days === 0) return 'Played here today'
  if (days < 14) return `Last here ${days} day${days === 1 ? '' : 's'} ago`
  if (days < 70) return `Last here ${Math.round(days / 7)} weeks ago`
  const months = Math.round(days / 30)
  return `Last here ${months} month${months === 1 ? '' : 's'} ago`
}

type Props = {
  showId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Utkast: «Start booking». Show i gang: «Save order». */
  mode: 'start' | 'review'
  canStartBooking?: boolean
  bookingBlockers?: string[]
  /**
   * Bare disse plassene startes — kortet for resten av plassene på et show
   * i booking. Utelatt = alle (utkast).
   */
  spotIds?: string[]
}

/**
 * «Review your line-up»: køen per plass, før og etter at bookingen starter.
 *
 * Bookerne ville se hvem den automatiske bookeren skriver til, og bestemme
 * rekkefølgen selv. Hver plass har en kø: de øverste får tilbud når
 * bookingen starter, de neste bare om ingen sier ja. Motoren følger køen i
 * hver bølge — se `spotOrder` i lib/booking-rules.ts.
 *
 * Hvem som faktisk får tilbud nå, regnes med `allocateWave`, den samme
 * funksjonen motoren bruker. Står noen først i to køer, viser raden hvilken
 * plass som får hen.
 */
export function LineupQueueDialog({ showId, open, onOpenChange, mode, canStartBooking = true, bookingBlockers = [], spotIds }: Props) {
  const spotIdsKey = spotIds?.join(',') ?? ''
  const router = useRouter()
  const [data, setData] = React.useState<LoadedQueue | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [queues, setQueues] = React.useState<Record<string, QueueComedian[]>>({})
  const [addable, setAddable] = React.useState<Record<string, Addable[]>>({})
  const [isLoading, startLoading] = React.useTransition()
  const [isSaving, startSaving] = React.useTransition()

  const load = React.useCallback(() => {
    startLoading(async () => {
      try {
        const result = await getLineupQueueAction(showId, spotIdsKey ? spotIdsKey.split(',') : undefined)
        if (!result.ok) {
          setData(null)
          setError(SKIP_TEXT[result.reason])
          return
        }
        setError(null)
        setData(result)
        setQueues(Object.fromEntries(result.spots.map((spot) => [spot.requirementId, spot.queue])))
        setAddable(Object.fromEntries(result.spots.map((spot) => [spot.requirementId, spot.addable])))
        setSelectedId((current) =>
          current && result.spots.some((spot) => spot.requirementId === current)
            ? current
            : result.spots.find((spot) => !spot.note)?.requirementId ?? result.spots[0]?.requirementId ?? null,
        )
      } catch (err: unknown) {
        setError((err as Error)?.message ?? 'Could not load the line-up')
      }
    })
  }, [showId, spotIdsKey])

  React.useEffect(() => {
    if (open) load()
  }, [open, load])

  const activeSpots = React.useMemo(
    () => (data?.spots ?? []).filter((spot) => !spot.note && spot.nowCount + spot.tomorrowCount + spot.slotsNeeded > 0),
    [data],
  )

  // Samme fordeling som motoren: hvem som får tilbud nå, og på hvilken plass.
  const allocation = React.useMemo(() => {
    const spots: AllocationSpot[] = activeSpots
      .filter((spot) => spot.nowCount > 0)
      .map((spot) => ({
        requirementId: spot.requirementId,
        lineupPosition: spot.position,
        slotsNeeded: spot.slotsNeeded,
        maxNewOffers: spot.nowCount,
        candidateCount: (queues[spot.requirementId]?.length ?? 0)
          + (addable[spot.requirementId] ?? []).filter((row) => !row.removed).length,
        order: (queues[spot.requirementId] ?? []).map((row) => row.artistId),
      }))
    return allocateWave(spots)
  }, [activeSpots, queues, addable])

  const offeredFor = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const row of allocation) map.set(row.artistId, row.requirementId)
    return map
  }, [allocation])

  const spotById = React.useMemo(
    () => new Map((data?.spots ?? []).map((spot) => [spot.requirementId, spot])),
    [data],
  )

  const selected = selectedId ? spotById.get(selectedId) ?? null : null
  const offersNow = allocation.length
  const spotsNow = new Set(allocation.map((row) => row.requirementId)).size

  function move(requirementId: string, from: number, to: number) {
    setQueues((prev) => {
      const list = [...(prev[requirementId] ?? [])]
      if (to < 0 || to >= list.length || from === to) return prev
      const [item] = list.splice(from, 1)
      list.splice(to, 0, item)
      return { ...prev, [requirementId]: list }
    })
  }

  function remove(requirementId: string, index: number) {
    const row = queues[requirementId]?.[index]
    if (!row) return
    setQueues((prev) => ({ ...prev, [requirementId]: (prev[requirementId] ?? []).filter((_, i) => i !== index) }))
    setAddable((prev) => ({ ...prev, [requirementId]: [{ ...row, removed: true }, ...(prev[requirementId] ?? [])] }))
  }

  function add(requirementId: string, artistId: string) {
    const row = addable[requirementId]?.find((item) => item.artistId === artistId)
    if (!row) return
    setAddable((prev) => ({ ...prev, [requirementId]: (prev[requirementId] ?? []).filter((item) => item.artistId !== artistId) }))
    setQueues((prev) => ({
      ...prev,
      [requirementId]: [...(prev[requirementId] ?? []), {
        artistId: row.artistId,
        name: row.name,
        initials: row.initials,
        imageUrl: row.imageUrl,
        skillLevel: row.skillLevel,
        lastClubBookingDate: row.lastClubBookingDate,
        applied: row.applied,
      }],
    }))
  }

  function queuesPayload() {
    return JSON.stringify(Object.fromEntries(activeSpots.map((spot) => [spot.requirementId, {
      order: (queues[spot.requirementId] ?? []).map((row) => row.artistId),
      removed: (addable[spot.requirementId] ?? []).filter((row) => row.removed).map((row) => row.artistId),
    }])))
  }

  function submit() {
    const fd = new FormData()
    fd.set('show_id', showId)
    fd.set('queues', queuesPayload())
    if (spotIdsKey) fd.set('spot_ids', spotIdsKey)

    startSaving(async () => {
      try {
        if (mode === 'start') {
          const result = await startBookingAction(fd)
          const sent = result?.offersSent
          const what = spotIdsKey ? 'Auto-booking started on the remaining spots' : 'Booking started'
          toast.success(sent == null
            ? `${what}! Offers go out to matching artists.`
            : `${what}! ${sent} offer${sent === 1 ? '' : 's'} sent.`)
        } else {
          await saveLineupQueueAction(fd)
          toast.success('Queue saved. Offers follow the new order.')
        }
        onOpenChange(false)
        router.refresh()
      } catch (err: unknown) {
        toast.error((err as Error)?.message ?? 'Could not save the queue')
      }
    })
  }

  const busy = isLoading || isSaving
  const today = React.useMemo(() => new Date(), [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92dvh] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        {/* ── Header ── */}
        <div className="flex items-start gap-3 border-b px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base font-bold">Review your line-up</DialogTitle>
            <DialogDescription className="mt-0.5 truncate text-xs text-muted-foreground">
              {data
                ? [
                  shortDate(data.show.date),
                  data.show.venue,
                  `Line-up deadline ${shortDate(data.show.lineupDeadline)}`,
                ].filter(Boolean).join(' · ')
                : 'Loading the queue…'}
            </DialogDescription>
          </div>
          <QueueHelp rush={data?.rush ?? false} started={data?.show.started ?? false} />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={load}
            disabled={busy}
            aria-label="Suggest again"
            title="Suggest again — discards your changes"
          >
            <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>

        {/* ── Garantien ──
            Bookerne var redde for at samme komiker kunne bli booket på to
            plasser. Det står derfor framme, over hele lineupen, ikke bak Help.
            Motoren hopper over alle som alt er spurt på showet (`involved` i
            loadShowPlan: tilbud ute, booket, sagt nei eller ikke svart), og
            fordeler hver bølge med `allocateWave`. */}
        {data && (
          <div className="flex items-center gap-2 border-b bg-emerald-50 px-4 py-2 text-xs text-emerald-900 sm:px-5 dark:bg-emerald-950/40 dark:text-emerald-200">
            <ShieldCheck className="size-4 shrink-0" aria-hidden />
            <p>
              <span className="font-semibold">One spot per comedian.</span>{' '}
              No one gets offers for two spots on this show — not even after saying no.
            </p>
          </div>
        )}

        {/* ── Body ── */}
        {error ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{error}</p>
        ) : !data ? (
          <div className="space-y-2 px-5 py-6">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted/50" />)}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col sm:grid sm:grid-cols-[13.5rem_minmax(0,1fr)]">
            {/* Plassene: liste på desktop, vannrett velger på mobil. */}
            <nav
              aria-label="Lineup spots"
              className="flex shrink-0 gap-1.5 overflow-x-auto border-b px-3 py-2.5 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-2.5 sm:py-3"
            >
              {data.spots.map((spot) => {
                const first = firstInLine(spot, queues[spot.requirementId] ?? [], offeredFor)
                const isSelected = spot.requirementId === selectedId
                return (
                  <button
                    key={spot.requirementId}
                    type="button"
                    onClick={() => setSelectedId(spot.requirementId)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={cn(
                      'flex min-w-36 shrink-0 items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors sm:min-w-0',
                      isSelected ? 'bg-muted text-foreground ring-1 ring-border' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                    )}
                  >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--ev-accent-fill)]/10 text-[11px] font-bold text-[var(--ev-accent-fill)]">
                      {spot.position}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{spot.roleName}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {spot.note === 'submissions_open'
                          ? 'Open for submissions'
                          : spot.note === 'paused'
                            ? 'Paused'
                            : spot.note === 'filled'
                            ? 'Filled'
                            : spot.note === 'not_started'
                            ? 'Not started'
                            : first ? `${firstName(first)} first` : 'No one in the queue'}
                      </span>
                    </span>
                  </button>
                )
              })}
            </nav>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              {selected && (
                <SpotQueue
                  spot={selected}
                  rows={queues[selected.requirementId] ?? []}
                  addable={addable[selected.requirementId] ?? []}
                  offeredFor={offeredFor}
                  spotById={spotById}
                  rush={data.rush}
                  started={data.show.started}
                  today={today}
                  disabled={busy}
                  onMove={(from, to) => move(selected.requirementId, from, to)}
                  onRemove={(index) => remove(selected.requirementId, index)}
                  onAdd={(artistId) => add(selected.requirementId, artistId)}
                  onSelectSpot={setSelectedId}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-3 sm:px-5">
          <div className="min-w-0 basis-full text-xs text-muted-foreground sm:flex-1 sm:basis-auto">
            {mode === 'start' && !canStartBooking ? (
              <span className="font-medium text-amber-700 dark:text-amber-400">{bookingBlockers[0] ?? 'Fix the lineup spots first'}</span>
            ) : data ? (
              <>
                <span className="font-semibold text-foreground">{offersNow} offer{offersNow === 1 ? '' : 's'}</span>
                {` to ${offersNow === 1 ? 'one comedian' : `${countWord(offersNow)} different comedians`} · ${spotsNow} spot${spotsNow === 1 ? '' : 's'}`}
              </>
            ) : null}
          </div>
          <Button type="button" variant="ghost" className="ml-auto sm:ml-0" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            type="button"
            className="rounded-xl px-5"
            onClick={submit}
            disabled={busy || !data || (mode === 'start' && !canStartBooking)}
          >
            {isSaving ? (mode === 'start' ? 'Starting…' : 'Saving…') : mode === 'start' ? 'Start booking →' : 'Save order'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Forklaringen bak (?) i hodet.
 *
 * Hjelpeteksten på hver plass ble for mye å lese hver gang. Køen sier selv
 * hvem som spørres og hvem som hoppes over; hvordan det virker, står her,
 * ett klikk unna. Garantien om én plass per komiker står ikke her, men
 * framme i båndet øverst — den skal ses uten å lete.
 */
function QueueHelp({ rush, started }: { rush: boolean; started: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <CircleHelp className="size-4" />
          Help
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 text-sm leading-relaxed">
        <div className="flex gap-2.5">
          <GripVertical className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-semibold">Who gets asked first</p>
            <p className="text-muted-foreground">
              {rush
                ? `Drag to set the order. The line-up deadline is close, so the top of each queue gets offers at once when you ${started ? 'save' : 'start'}.`
                : `Drag to set the order. The top of each queue gets offers when you ${started ? 'save' : 'start'}. If none of them accept, the next ones get an offer the next morning, until the spot is filled.`}
            </p>
          </div>
        </div>
        <div className="flex gap-2.5">
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-semibold">Skipped here</p>
            <p className="text-muted-foreground">
              A comedian at the top of two queues gets the offer for one of them. On the other spot they are listed under Skipped here, with the spot they get instead.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Den som spørres først på plassen: den som får tilbudet nå, ellers toppen av køen. */
function firstInLine(spot: LineupQueueSpot, rows: QueueComedian[], offeredFor: ReadonlyMap<string, string>) {
  const offered = rows.find((row) => offeredFor.get(row.artistId) === spot.requirementId)
  const waiting = rows.find((row) => !offeredFor.has(row.artistId))
  return (offered ?? waiting ?? null)?.name ?? null
}

type Divider = 'now' | 'tomorrow' | 'later' | 'rush'

/**
 * Så mange i køen vises før «Show more». Bookerne leste en lang kø som en
 * liste over alle som kanskje fikk tilbud; de fem øverste er dem det gjelder.
 */
const VISIBLE_QUEUE = 5

function dividerText(kind: Divider, started: boolean) {
  switch (kind) {
    case 'rush':
      return 'Line-up deadline is close — all offers go out at once'
    case 'now':
      return started ? 'Offers sent when you save' : 'Offers sent when you start'
    case 'tomorrow':
      return 'Wave 2 · tomorrow morning if still open'
    case 'later':
      return 'Later waves · until the spot is filled'
  }
}

function SpotQueue({
  spot,
  rows,
  addable,
  offeredFor,
  spotById,
  rush,
  started,
  today,
  disabled,
  onMove,
  onRemove,
  onAdd,
  onSelectSpot,
}: {
  spot: LineupQueueSpot
  rows: QueueComedian[]
  addable: Addable[]
  offeredFor: ReadonlyMap<string, string>
  spotById: ReadonlyMap<string, LineupQueueSpot>
  rush: boolean
  started: boolean
  today: Date
  disabled: boolean
  onMove: (from: number, to: number) => void
  onRemove: (index: number) => void
  onAdd: (artistId: string) => void
  onSelectSpot: (requirementId: string) => void
}) {
  const [dragIndex, setDragIndex] = React.useState<number | null>(null)
  const [dropIndex, setDropIndex] = React.useState<number | null>(null)
  const [adding, setAdding] = React.useState(false)

  // Low slipper alle inn, så her står det rett ut.
  const criterion = spot.minSkillLevel && spot.minSkillLevel !== 'low' ? SKILL_REQUIREMENT_LABELS[spot.minSkillLevel] : 'Any skill level'
  // En pauset plass kan ordnes før bookeren velger «Auto-book new» — det er
  // nettopp da køen betyr noe.
  // En plass som ikke er startet, er ikke med i det som lagres (`activeSpots`),
  // så den kan ikke ordnes her — det gjøres når den startes fra kortet.
  const editable = !spot.note || spot.note === 'paused'

  const [showAll, setShowAll] = React.useState(false)

  // En komiker får aldri to tilbud på samme show (`allocateWave`). Den som får
  // tilbudet på en annen plass, hoppes over her — og flyttes ned i en egen
  // liste, så den som står øverst alltid er den som spørres først.
  const here: Array<{ row: QueueComedian; index: number }> = []
  const elsewhere: Array<{ row: QueueComedian; index: number; spot: LineupQueueSpot | null }> = []
  rows.forEach((row, index) => {
    const offeredOn = offeredFor.get(row.artistId)
    if (offeredOn != null && offeredOn !== spot.requirementId) {
      elsewhere.push({ row, index, spot: spotById.get(offeredOn) ?? null })
    } else {
      here.push({ row, index })
    }
  })

  const items = here.map(({ row, index }, place) => {
    let divider: Divider | null = null
    if (place === 0 && spot.nowCount > 0) divider = rush ? 'rush' : 'now'
    else if (place > 0 || spot.nowCount === 0) {
      if (rush) {
        if (place === spot.nowCount) divider = 'later'
      } else if (place === spot.nowCount && spot.tomorrowCount > 0) divider = 'tomorrow'
      else if (place === spot.nowCount + spot.tomorrowCount) divider = 'later'
    }
    // Opp/ned bytter med naboen i den synlige køen, ikke med en som er
    // flyttet ned fordi hen spørres på en annen plass.
    const before = here[place - 1]?.index
    const after = here[place + 1]?.index
    return { row, index, place, divider, before, after }
  })
  const shown = showAll ? items : items.slice(0, VISIBLE_QUEUE)
  const hiddenCount = items.length - shown.length

  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-2 text-base font-bold">
          <RoleIcon roleName={spot.roleName} className="size-[18px] shrink-0 text-[var(--ev-accent-fill)]" />
          <span className="truncate">#{spot.position} {spot.roleName}</span>
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {[criterion, formatDuration(spot.durationMinutes), `${spot.matchCount} match`].filter(Boolean).join(' · ')}
        </p>
      </div>

      {spot.note === 'submissions_open' ? (
        <p className="rounded-xl bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
          This spot is open for submissions. Comedians apply, and no offers go out automatically.
        </p>
      ) : spot.note === 'paused' ? (
        <p className="rounded-xl bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
          A comedian was removed from this spot. No offers go out until you choose yourself or pick Auto-book new in the line-up.
        </p>
      ) : spot.note === 'not_started' ? (
        <p className="rounded-xl bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
          Auto-booking has not started on this spot, so no offers go out. Start it from Fill the remaining spots in the line-up.
        </p>
      ) : spot.note === 'filled' ? (
        <p className="rounded-xl bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
          This spot is filled, or every seat has an offer waiting for an answer.
        </p>
      ) : null}

      {spot.asked.length > 0 && (
        <ul className="space-y-1.5" aria-label="Already asked">
          {spot.asked.map((row) => (
            <li key={row.artistId} className="flex items-center gap-2.5 rounded-xl border border-dashed px-2.5 py-2 opacity-80">
              <Avatar comedian={row} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
              <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', STATE_CLASS[row.state])}>
                {STATE_TEXT[row.state]}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editable && (
        <ol className="space-y-1.5" aria-label={`Queue for ${spot.roleName}`}>
          {shown.map(({ row, index, place, divider, before, after }) => (
            <React.Fragment key={row.artistId}>
              {divider && (
                <li aria-hidden className="flex items-center gap-2 pt-1.5 text-[11px] font-medium text-muted-foreground">
                  <span className="shrink-0">{dividerText(divider, started)}</span>
                  <span className="h-px flex-1 border-t border-dashed" />
                </li>
              )}
              <li
                draggable={!disabled}
                onDragStart={(event) => {
                  setDragIndex(index)
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(event) => {
                  if (dragIndex == null) return
                  event.preventDefault()
                  setDropIndex(index)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  if (dragIndex != null) onMove(dragIndex, index)
                  setDragIndex(null)
                  setDropIndex(null)
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setDropIndex(null)
                }}
                className={cn(
                  'flex items-center gap-2 rounded-xl border bg-background px-1.5 py-1.5 transition-colors sm:gap-2.5 sm:px-2',
                  dragIndex === index && 'opacity-50',
                  dropIndex === index && dragIndex !== index && 'border-[var(--ev-accent-fill)]',
                )}
              >
                <GripVertical className="hidden size-4 shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing sm:block" aria-hidden />
                {/* Nummeret viker for bildet på mobil: rekkefølgen ses uansett,
                    ansiktet er det bookeren kjenner igjen. */}
                <span className="hidden w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground sm:block">{place + 1}</span>
                <Avatar comedian={row} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm font-medium" title={row.name}>{row.name}</span>
                    <span className="shrink-0"><SkillLevelBadge level={row.skillLevel} compact /></span>
                    {row.applied && (
                      <span className="shrink-0 rounded-full bg-[var(--ev-accent-fill)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ev-accent-fill)]">
                        Applied
                      </span>
                    )}
                  </div>
                  {/* Brytes på mobil i stedet for å kuttes: det er grunnen til
                      at raden står der, og den må kunne leses. */}
                  <p className="text-[11px] leading-snug text-muted-foreground sm:truncate">
                    {lastHereText(row.lastClubBookingDate, today)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <IconButton label={`Move ${row.name} up`} onClick={() => before != null && onMove(index, before)} disabled={disabled || before == null}>
                    <ChevronUp className="size-4" />
                  </IconButton>
                  <IconButton label={`Move ${row.name} down`} onClick={() => after != null && onMove(index, after)} disabled={disabled || after == null}>
                    <ChevronDown className="size-4" />
                  </IconButton>
                  <IconButton label={`Remove ${row.name} from the queue`} onClick={() => onRemove(index)} disabled={disabled}>
                    <X className="size-4" />
                  </IconButton>
                </div>
              </li>
            </React.Fragment>
          ))}
          {hiddenCount > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                Show {hiddenCount} more in the queue
              </button>
            </li>
          )}
          {showAll && items.length > VISIBLE_QUEUE && (
            <li>
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="w-full rounded-xl px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                Show only the top {VISIBLE_QUEUE}
              </button>
            </li>
          )}
          {here.length === 0 && (
            <li className="rounded-xl bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
              No one on your list can take this spot that evening.
            </li>
          )}
        </ol>
      )}

      {editable && elsewhere.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 pt-1.5 text-[11px] font-medium text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Skipped here
          </p>
          <ul className="space-y-1.5" aria-label="Asked for another spot">
            {elsewhere.map(({ row, index, spot: other }) => (
              <li key={row.artistId} className="flex items-center gap-2.5 rounded-xl border border-dashed px-2.5 py-1.5">
                <span className="opacity-60"><Avatar comedian={row} /></span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-muted-foreground">{row.name}</span>
                  {other ? (
                    <button
                      type="button"
                      onClick={() => onSelectSpot(other.requirementId)}
                      className="inline-flex max-w-full items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                    >
                      <ArrowRight className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">Gets #{other.position} {other.roleName} instead</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Gets another spot instead</span>
                  )}
                </div>
                <IconButton label={`Remove ${row.name} from the queue`} onClick={() => onRemove(index)} disabled={disabled}>
                  <X className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editable && addable.length > 0 && (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding((value) => !value)} disabled={disabled}>
            <Plus data-icon="inline-start" />
            Add comedian
          </Button>
          {adding && (
            <ul className="mt-1.5 max-h-56 space-y-1 overflow-y-auto rounded-xl border p-1.5">
              {addable.map((row) => (
                <li key={row.artistId}>
                  <button
                    type="button"
                    onClick={() => {
                      onAdd(row.artistId)
                      setAdding(false)
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
                  >
                    <Avatar comedian={row} />
                    <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                    {row.removed && <span className="shrink-0 text-[11px] text-muted-foreground">Removed</span>}
                    <SkillLevelBadge level={row.skillLevel} compact />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

/** Profilbildet, med initialene bare til bildet har lastet eller om det mangler. */
function Avatar({ comedian }: { comedian: Pick<QueueComedian, 'name' | 'initials' | 'imageUrl'> }) {
  return (
    <UiAvatar className="size-9 shrink-0 sm:size-10">
      {comedian.imageUrl && <AvatarImage src={comedian.imageUrl} alt="" className="object-cover" />}
      <AvatarFallback className="text-[11px] font-semibold">{comedian.initials}</AvatarFallback>
    </UiAvatar>
  )
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-lg text-muted-foreground sm:size-8 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

/** Teksten fra ClickUp 869fgj8ph, med grammatikken rettet. */
const EXPLANATION =
  'The algorithm suggests a line-up based on your criteria, comedians availability and when they have performed at your club last. It aims to provide your audience with a varied line-up.'

/**
 * Start booking-kortet.
 *
 * «Suggest line-up now» åpner køen; Start booking uten den lar motoren velge
 * selv, som før.
 *
 * `remaining` er samme kort på et show som alt er i booking, men der
 * automatikken ikke er startet på alle plassene — typisk etter at bookeren
 * har sendt ett tilbud for hånd. Da gjelder forslaget bare resten; det
 * manuelle tilbudet og plassene som er startet, røres ikke.
 */
export function StartBookingCard({
  showId,
  canStartBooking,
  bookingBlockers,
  remaining,
  spotIds,
  suggestFromSubmissions,
}: {
  /** «Applicants first» under knappen. Utelatt = vises ikke. */
  suggestFromSubmissions?: boolean
  showId: string
  canStartBooking: boolean
  bookingBlockers: string[]
  /** Antall plasser forslaget gjelder når showet alt er i booking. */
  remaining?: number
  /** Plassene som startes. Utelatt = alle (utkast). */
  spotIds?: string[]
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [isStarting, startStarting] = React.useTransition()

  function startWithoutQueue() {
    const fd = new FormData()
    fd.set('show_id', showId)
    if (spotIds?.length) fd.set('spot_ids', spotIds.join(','))
    startStarting(async () => {
      try {
        await startBookingAction(fd)
        router.refresh()
        toast.success(remaining
          ? 'Auto-booking started on the remaining spots.'
          : 'Booking started! Offers go out to matching artists.')
      } catch (err: unknown) {
        toast.error((err as Error)?.message ?? 'Could not start booking')
      }
    })
  }

  return (
    <LineupCallout
      title={remaining
        ? `Fill the remaining ${remaining === 1 ? 'spot' : `${remaining} spots`} automatically?`
        : 'Ready to start booking?'}
    >
      <p className="text-sm text-muted-foreground">
        {remaining
          ? 'The spots you have already filled or offered stay as they are. '
          : ''}
        {EXPLANATION}
      </p>
      {!canStartBooking && (
        <ul className="space-y-0.5 pt-1">
          {bookingBlockers.map((reason) => (
            <li key={reason} className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
              <TriangleAlert className="size-3 shrink-0" />
              {reason}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-2.5">
        <Button type="button" className="rounded-xl px-5" onClick={() => setOpen(true)} disabled={isStarting}>
          <Sparkles data-icon="inline-start" />
          Suggest line-up now
        </Button>
        <Button type="button" variant="outline" className="rounded-xl" onClick={startWithoutQueue} disabled={isStarting || !canStartBooking}>
          {isStarting
            ? 'Starting…'
            : remaining
              ? 'Auto-book without a suggestion →'
              : 'Start booking without a suggestion →'}
        </Button>
      </div>
      {suggestFromSubmissions !== undefined && (
        <div className="pt-2">
          <SuggestFromSubmissionsToggle showId={showId} enabled={suggestFromSubmissions} variant="compact" />
        </div>
      )}
      <LineupQueueDialog
        showId={showId}
        open={open}
        onOpenChange={setOpen}
        mode="start"
        canStartBooking={canStartBooking}
        bookingBlockers={bookingBlockers}
        spotIds={spotIds}
      />
    </LineupCallout>
  )
}
