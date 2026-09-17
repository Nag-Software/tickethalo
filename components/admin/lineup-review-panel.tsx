'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatScore, PERFORMANCE_RATINGS, RATING_LABELS } from '@/lib/artist-score'
import { saveLineupReviewAction } from '@/app/admin-app/(protected)/shows/actions'
import type { PerformanceRating } from '@/types/database'

/**
 * «Hvordan gikk det?» — ett trykk per komiker etter showet.
 *
 * Dette er sløyfen som gjør køen bedre over tid: vurderingen endrer scoren,
 * scoren endrer rekkefølgen, og rekkefølgen avgjør hvem som får tilbud på
 * neste show. En klubb som vurderer hver kveld, får en liste som gradvis
 * sorterer seg selv.
 *
 * Derfor er det fire knapper og ikke et skjema. Et felt fra 1 til 10 blir
 * ikke fylt ut dagen etter et show, og to bookere mener ikke det samme med
 * en sjuer.
 */

export type ReviewableSpot = {
  spotId: string
  artistName: string
  roleName: string | null
  rating: PerformanceRating | null
  notes: string | null
  /** Scoren komikeren står på nå, etter vurderingene som finnes. */
  score: number | null
  reviewCount: number
}

const TONE: Record<PerformanceRating, string> = {
  strong: 'bg-emerald-600 text-white border-emerald-600',
  medium: 'bg-sky-600 text-white border-sky-600',
  weak: 'bg-amber-600 text-white border-amber-600',
  no_show: 'bg-red-600 text-white border-red-600',
}

export function LineupReviewPanel({ showId, spots }: { showId: string; spots: ReviewableSpot[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(spots)
  const [pendingSpots, setPendingSpots] = useState<ReadonlySet<string>>(() => new Set())
  const [, startSaving] = useTransition()

  /**
   * Følg serveren når den har regnet ut den nye scoren.
   *
   * Tilstanden ble satt fra propene én gang, ved første render. Etter en
   * vurdering skrev `router.refresh()` en ny score inn i propene, men raden
   * viste fortsatt den gamle — stikk i strid med det denne panelen lover.
   * Signaturen gjør at vi bare synker når tallene faktisk er endret, ikke
   * hver gang forelderen tegnes på nytt.
   */
  const signature = useMemo(
    () => spots.map((row) => `${row.spotId}:${row.rating ?? ''}:${row.score ?? ''}:${row.reviewCount}`).join('|'),
    [spots],
  )
  const [syncedTo, setSyncedTo] = useState(signature)
  if (signature !== syncedTo) {
    setSyncedTo(signature)
    setRows(spots)
  }

  if (rows.length === 0) return null

  const unreviewed = rows.filter((row) => !row.rating).length

  function save(spot: ReviewableSpot, rating: PerformanceRating, notes: string | null) {
    const previous = rows
    setRows((current) => current.map((row) => (row.spotId === spot.spotId ? { ...row, rating, notes } : row)))
    // Ett sett, ikke én id: to raske vurderinger på rad slo ut hverandres
    // «lagrer»-tilstand, og den første raden ble stående låst.
    setPendingSpots((current) => new Set(current).add(spot.spotId))

    const fd = new FormData()
    fd.set('show_id', showId)
    fd.set('spot_id', spot.spotId)
    fd.set('rating', rating)
    if (notes) fd.set('notes', notes)

    startSaving(async () => {
      try {
        await saveLineupReviewAction(fd)
        toast.success(`${spot.artistName}: ${RATING_LABELS[rating].toLowerCase()}`)
        // Hent den nye scoren. Den er regnet ut på serveren, og det er den
        // raden skal vise.
        router.refresh()
      } catch (error) {
        setRows(previous)
        toast.error((error as Error)?.message ?? 'The review could not be saved.')
      } finally {
        setPendingSpots((current) => {
          const next = new Set(current)
          next.delete(spot.spotId)
          return next
        })
      }
    })
  }

  return (
    <section className="mb-6 overflow-hidden rounded-xl border">
      <header className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3">
        <Star className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">How did it go?</h2>
        <span className="text-xs text-muted-foreground">
          {unreviewed === 0
            ? 'Every comedian is reviewed. You can change a review for 30 days.'
            : `${unreviewed} of ${rows.length} left. One tap each — it decides who gets offered your next show.`}
        </span>
      </header>

      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.spotId} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.artistName}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {row.roleName ?? 'No role'}
                {' · '}
                {row.reviewCount === 0
                  ? 'no reviews yet'
                  : `${formatScore(row.score)} · ${row.reviewCount} ${row.reviewCount === 1 ? 'review' : 'reviews'}`}
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {PERFORMANCE_RATINGS.map((rating) => (
                <button
                  key={rating}
                  type="button"
                  disabled={pendingSpots.has(row.spotId)}
                  onClick={() => save(row, rating, row.notes)}
                  aria-pressed={row.rating === rating}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                    row.rating === rating
                      ? TONE[rating]
                      : 'border-border text-muted-foreground hover:border-foreground hover:text-foreground',
                  )}
                >
                  {RATING_LABELS[rating]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
