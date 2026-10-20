'use client'

import * as React from 'react'
import { RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { SkillLevelBadge } from '@/components/admin/artist-badges'
import { SKILL_LEVEL_LABELS } from '@/lib/artist-score'
import { RoleIcon } from '@/components/admin/show-booking-card'
import type { LineupSuggestion, PlanSkipReason, SuggestedComedian, SuggestedSpot } from '@/lib/booking-engine'
import { startBookingAction, suggestLineupAction } from '../actions'
import { LineupCallout, SpotNumber, spotCardClass } from './lineup-ui'

/** Teksten fra ClickUp 869fgj8ph, med grammatikken rettet. */
const EXPLANATION =
  'The algorithm suggests a line-up based on your criteria, comedians availability and when they have performed at your club last. It aims to provide your audience with a varied line-up.'

const SKIP_TEXT: Record<PlanSkipReason, string> = {
  not_running: 'Booking has already started for this show.',
  no_spots: 'Add at least one lineup spot first.',
  show_day: 'It is the day of the show. No offers go out today — book comedians directly.',
  no_candidates: 'No comedians on your list can be booked for this date.',
  load_failed: 'Could not load the suggestion. Try again.',
}

const NOTE_TEXT: Record<NonNullable<SuggestedSpot['note']>, string> = {
  submissions_open: 'Open for submissions — comedians apply, so no offers go out automatically.',
  nothing_to_send: 'Nothing to send — this spot is already covered.',
  no_candidates: 'No one on your list matches this spot and is free that evening.',
}

type Picks = Record<string, SuggestedComedian[]>

/**
 * Start booking-kortet, med forslaget før noe sendes.
 *
 * Bookerne var redde for å slippe en automatisk booker løs uten å se hvem
 * den skriver til. «Suggest line-up now» viser den første bølgen — samme
 * utvalg motoren ville sendt — og bookeren kan bytte ut hvem som helst før
 * Start booking sender akkurat de tilbudene. Forslaget er valgfritt: Start
 * booking uten forslag virker som før.
 */
export function LineupSuggestionCard({
  showId,
  canStartBooking,
  bookingBlockers,
}: {
  showId: string
  canStartBooking: boolean
  bookingBlockers: string[]
}) {
  const router = useRouter()
  const [suggestion, setSuggestion] = React.useState<Extract<LineupSuggestion, { ok: true }> | null>(null)
  const [picks, setPicks] = React.useState<Picks>({})
  const [replacing, setReplacing] = React.useState<{ requirementId: string; index: number } | null>(null)
  const [isSuggesting, startSuggesting] = React.useTransition()
  const [isStarting, startStarting] = React.useTransition()

  function suggest() {
    startSuggesting(async () => {
      try {
        const result = await suggestLineupAction(showId)
        if (!result.ok) {
          toast.error(SKIP_TEXT[result.reason])
          return
        }
        setSuggestion(result)
        setPicks(Object.fromEntries(result.spots.map((spot) => [spot.requirementId, spot.picks])))
        setReplacing(null)
      } catch (err: unknown) {
        toast.error((err as Error)?.message ?? 'Could not suggest a line-up')
      }
    })
  }

  function startBooking(withPicks: boolean) {
    const fd = new FormData()
    fd.set('show_id', showId)
    if (withPicks) {
      fd.set('picks', JSON.stringify(Object.fromEntries(
        Object.entries(picks).map(([requirementId, comedians]) => [requirementId, comedians.map((c) => c.artistId)]),
      )))
    }

    startStarting(async () => {
      try {
        const result = await startBookingAction(fd)
        router.refresh()
        if (!withPicks || !result || result.offersSent == null) {
          toast.success('Booking started! Offers go out to matching artists.')
        } else if (result.notSent > 0) {
          toast.success(
            `Booking started! ${result.notSent} of the suggested ${result.notSent === 1 ? 'comedian is' : 'comedians are'} no longer available, so the next in line got the offer instead.`,
          )
        } else {
          toast.success('Booking started! Offers sent to the suggested comedians.')
        }
      } catch (err: unknown) {
        toast.error((err as Error)?.message ?? 'Could not start booking')
      }
    })
  }

  function replace(requirementId: string, index: number, comedian: SuggestedComedian) {
    setPicks((prev) => {
      const next = [...(prev[requirementId] ?? [])]
      next[index] = comedian
      return { ...prev, [requirementId]: next }
    })
    setReplacing(null)
  }

  const busy = isSuggesting || isStarting
  const blockers = !canStartBooking && (
    <ul className="space-y-0.5 pt-1">
      {bookingBlockers.map((reason) => (
        <li key={reason} className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-3 shrink-0" />
          {reason}
        </li>
      ))}
    </ul>
  )

  if (!suggestion) {
    return (
      <LineupCallout
        title="Ready to start booking?"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => startBooking(false)} disabled={busy || !canStartBooking}>
              {isStarting ? 'Starting…' : 'Start booking →'}
            </Button>
            <Button type="button" className="rounded-xl px-5" onClick={suggest} disabled={busy}>
              <Sparkles data-icon="inline-start" />
              {isSuggesting ? 'Suggesting…' : 'Suggest line-up now'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">{EXPLANATION}</p>
        {blockers}
      </LineupCallout>
    )
  }

  const chosenIds = new Set(Object.values(picks).flat().map((comedian) => comedian.artistId))

  return (
    <div className={cn(spotCardClass, 'px-4 py-4 sm:px-5')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="flex items-center gap-1.5 text-sm font-bold">
            <Sparkles className="size-4 text-[var(--ev-accent-fill)]" />
            Suggestion for line-up is ready!
          </h3>
          <p className="text-sm text-muted-foreground">
            These comedians get the first offers when you start booking. Replace anyone you would rather not ask.
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={suggest} disabled={busy}>
          <RefreshCw data-icon="inline-start" className={cn(isSuggesting && 'animate-spin')} />
          Suggest again
        </Button>
      </div>

      <ol className="mt-3 space-y-2">
        {suggestion.spots.map((spot, spotIndex) => {
          const spotPicks = picks[spot.requirementId] ?? []
          return (
            <li key={spot.requirementId} className="rounded-xl border bg-background/60 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <SpotNumber position={spotIndex + 1} className="size-[22px] text-[11px]" />
                <RoleIcon roleName={spot.roleName} className="size-4 shrink-0 text-[var(--ev-accent-fill)]" />
                <span className="text-sm font-semibold">{spot.roleName}</span>
              </div>

              {spot.note ? (
                <p className="mt-1.5 pl-[30px] text-xs text-muted-foreground">{NOTE_TEXT[spot.note]}</p>
              ) : (
                <ul className="mt-1.5 space-y-1 pl-[30px]">
                  {spotPicks.map((comedian, index) => {
                    const isReplacing = replacing?.requirementId === spot.requirementId && replacing.index === index
                    const alternatives = spot.eligible.filter((option) => !chosenIds.has(option.artistId))
                    return (
                      <li key={`${comedian.artistId}-${index}`} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="min-w-0 truncate font-medium">{comedian.name}</span>
                        <SkillLevelBadge level={comedian.skillLevel} compact />
                        {isReplacing ? (
                          <select
                            autoFocus
                            defaultValue=""
                            aria-label={`Replace ${comedian.name}`}
                            onChange={(event) => {
                              const option = alternatives.find((alt) => alt.artistId === event.target.value)
                              if (option) replace(spot.requirementId, index, option)
                            }}
                            onBlur={() => setReplacing(null)}
                            className="ml-auto min-w-48 rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            <option value="" disabled>
                              {alternatives.length > 0 ? 'Pick another comedian…' : 'No one else matches'}
                            </option>
                            {alternatives.map((option) => (
                              <option key={option.artistId} value={option.artistId}>
                                {option.name} · {SKILL_LEVEL_LABELS[option.skillLevel]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setReplacing({ requirementId: spot.requirementId, index })}
                            disabled={busy}
                            className="ml-auto rounded-md px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                          >
                            Replace
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ol>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">{blockers}</div>
        <Button type="button" className="ml-auto rounded-xl px-5" onClick={() => startBooking(true)} disabled={busy || !canStartBooking}>
          {isStarting ? 'Starting…' : 'Start booking →'}
        </Button>
      </div>
    </div>
  )
}
