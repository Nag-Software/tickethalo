'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, LoaderCircle, MapPin, Navigation, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { ALL_CITIES } from '@/lib/event-filters'
import {
  PLACES,
  distanceToCity,
  foldName,
  formatDistance,
  nearestPlace,
  searchPlaces,
  type Coordinates,
  type Place,
} from '@/lib/geo'

/** A GPS fix, resolved to the nearest town so we can name it in the UI. */
export interface LocationOrigin extends Coordinates {
  label: string
}

export interface CityOption {
  /** Exactly as stored on the club, since that is what the filter compares against. */
  city: string
  /** Shows matching every *other* active filter — so the number is what you get if you pick it. */
  count: number
}

interface Props {
  options: CityOption[]
  /** `ALL_CITIES` or one city name. */
  value: string
  onValueChange: (city: string) => void
  origin: LocationOrigin | null
  onOriginChange: (origin: LocationOrigin | null) => void
  /** Total across every city, for the "All locations" row. */
  totalCount: number
  className?: string
}

/**
 * The rows the arrow keys walk over. Kept as one flat list so the keyboard
 * index means the same thing regardless of which sections are visible.
 */
type Row =
  | { kind: 'all'; key: string }
  | { kind: 'city'; key: string; city: string; count: number; km: number | null }
  | { kind: 'place'; key: string; place: Place; km: number | null }

type GeoStatus = 'idle' | 'locating' | 'denied' | 'unavailable' | 'failed'

const GEO_MESSAGES: Record<Exclude<GeoStatus, 'idle' | 'locating'>, string> = {
  denied: 'Location is blocked. Allow it in your browser settings, or search for a city instead.',
  unavailable: 'This browser cannot share a location. Search for a city instead.',
  failed: 'Could not get your location. Try again, or search for a city.',
}

export function LocationPicker({
  options,
  value,
  onValueChange,
  origin,
  onOriginChange,
  totalCount,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<GeoStatus>('idle')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Guards the async geolocation callbacks: without it a slow fix that lands
  // after unmount sets state on a dead component.
  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const rows = useMemo<Row[]>(() => {
    const needle = foldName(query)

    const cityRows = options
      .filter((option) => !needle || foldName(option.city).includes(needle))
      .map((option) => ({
        kind: 'city' as const,
        key: `city:${option.city}`,
        city: option.city,
        count: option.count,
        km: origin ? distanceToCity(origin, option.city) : null,
      }))
      // With a fix, the nearest city is the one you most likely want. Without
      // one, alphabetical by Norwegian rules — the city names stay Norwegian.
      .sort((a, b) => {
        if (origin) {
          // Cities missing from the coordinate table sort last rather than first.
          const left = a.km ?? Infinity
          const right = b.km ?? Infinity
          if (left !== right) return left - right
        }
        return a.city.localeCompare(b.city, 'nb-NO')
      })

    // Places we do not have shows in yet. Only worth showing once someone has
    // typed — picking one lands them on the "notify me" form for that city.
    const known = new Set(options.map((option) => foldName(option.city)))
    const placeRows = needle
      ? searchPlaces(query, PLACES, 6)
          .filter((place) => !known.has(foldName(place.name)))
          .map((place) => ({
            kind: 'place' as const,
            key: `place:${place.name}`,
            place,
            km: origin ? distanceToCity(origin, place.name) : null,
          }))
      : []

    // "All locations" is a reset, so it only makes sense with nothing typed.
    const head: Row[] = needle ? [] : [{ kind: 'all', key: 'all' }]
    return [...head, ...cityRows, ...placeRows]
  }, [options, origin, query])

  // Typing changes the list under the cursor, so the highlight goes back to the
  // top — otherwise Enter picks whatever row happened to slide into the old index.
  const onQueryChange = (next: string) => {
    setQuery(next)
    setActiveIndex(0)
  }

  // Reopening should be a clean slate rather than last time's search and error.
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setQuery('')
      setStatus('idle')
      setActiveIndex(0)
    }
  }

  const select = (row: Row) => {
    if (row.kind === 'all') onValueChange(ALL_CITIES)
    else if (row.kind === 'city') onValueChange(row.city)
    else onValueChange(row.place.name)
    onOpenChange(false)
  }

  const locate = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable')
      return
    }

    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!aliveRef.current) return
        const coords = { lat: position.coords.latitude, lon: position.coords.longitude }
        setStatus('idle')
        onOriginChange({ ...coords, label: nearestPlace(coords)?.name ?? 'you' })
        // Sorting by distance is pointless while pinned to one city, so a fix
        // clears the filter — you asked for "nearest", not "nearest in Bergen".
        onValueChange(ALL_CITIES)
        onOpenChange(false)
      },
      (error) => {
        if (!aliveRef.current) return
        setStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'failed')
      },
      // A city-level fix is all this needs, and the cheap one is much faster.
      // A 5-minute cache means reopening the picker does not re-prompt.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 }
    )
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (rows.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % rows.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + rows.length) % rows.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const row = rows[activeIndex]
      if (row) select(row)
    }
  }

  // Keeps the highlighted row inside the scroll box during arrow-key walking.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const triggerLabel = origin ? `Near ${origin.label}` : value !== ALL_CITIES ? value : 'Choose location'
  const isSet = Boolean(origin) || value !== ALL_CITIES

  const cityRowCount = rows.filter((row) => row.kind === 'city').length
  const placeRowCount = rows.filter((row) => row.kind === 'place').length

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={isSet ? `Location: ${triggerLabel}. Change` : 'Choose location'}
            className={cn(
              'inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap px-4 text-[15px] font-medium transition-colors',
              'sm:h-auto sm:gap-1.5 sm:px-3.5 sm:py-1.5 sm:text-[13px]',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)]',
              isSet
                ? 'bg-[var(--ev-accent-fill)] font-semibold text-[var(--ev-accent-ink)]'
                : 'ring-1 ring-inset ring-[var(--ev-line-strong)] text-[var(--ev-text)] hover:bg-[var(--ev-card)]'
            )}
            style={{ borderRadius: 'var(--ev-r-chip)' }}
          >
            {origin ? (
              <Navigation className="size-4 sm:size-3.5" aria-hidden />
            ) : (
              <MapPin className="size-4 sm:size-3.5" aria-hidden />
            )}
            {triggerLabel}
            <ChevronDown
              className={cn('size-4 transition-transform sm:size-3.5', open && 'rotate-180')}
              aria-hidden
            />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={8}
          collisionPadding={12}
          // The panel lives in a sticky toolbar partway down the viewport. Left
          // to grow freely it is taller than the space either side of the
          // trigger, and Radix flips it up into the header and off the top of
          // the screen. Capping it at the space Radix reports keeps it on
          // screen; the results list is what gives way.
          className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 overflow-hidden rounded-2xl bg-[var(--ev-bg)] p-4 text-[var(--ev-text)] ring-1 ring-[var(--ev-line-strong)]"
          style={{ zIndex: 100 }}
        >
          <label htmlFor="location-search" className="sr-only">
            Search for a city...
          </label>
          {/* 16px is not decoration: anything smaller makes iOS Safari zoom into
              the field on focus, leaving the page wider than the screen. */}
          <input
            id="location-search"
            type="text"
            role="combobox"
            aria-expanded={true}
            aria-controls="location-results"
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="Search for a city..."
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-12 w-full shrink-0 bg-transparent px-4 text-[15px] text-[var(--ev-text)] outline-none ring-2 ring-inset ring-[var(--ev-line)] transition-[box-shadow] placeholder:text-[var(--ev-faint)] focus:ring-[var(--ev-accent-fill)]"
            style={{ borderRadius: '12px' }}
          />

          {rows.length > 0 && query.length > 0 && (
            <div
              id="location-results"
              ref={listRef}
              role="listbox"
              aria-label="Locations"
              className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
            >
              {rows.map((row, index) => {
                const active = index === activeIndex
                const selected =
                  row.kind === 'all'
                    ? value === ALL_CITIES && !origin
                    : row.kind === 'city'
                      ? value === row.city
                      : value === row.place.name

                // The catalogue section needs one heading, above its first row.
                const heading =
                  row.kind === 'place' && index === rows.length - placeRowCount ? 'No shows yet' : null

                return (
                  <div key={row.key}>
                    {heading && (
                      <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ev-faint)]">
                        {heading}
                      </div>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-active={active}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => select(row)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                        active ? 'bg-[var(--ev-card-hover)]' : 'bg-transparent'
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">
                          {row.kind === 'all'
                            ? 'All locations'
                            : row.kind === 'city'
                              ? row.city
                              : row.place.name}
                        </span>
                        <span className="block truncate text-[12px] text-[var(--ev-faint)]">
                          {row.kind === 'all'
                            ? `${totalCount} ${totalCount === 1 ? 'show' : 'shows'}`
                            : row.kind === 'city'
                              ? [
                                  `${row.count} ${row.count === 1 ? 'show' : 'shows'}`,
                                  row.km !== null ? formatDistance(row.km) : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')
                              : [row.place.region, row.km !== null ? formatDistance(row.km) : null]
                                  .filter(Boolean)
                                  .join(' · ')}
                        </span>
                      </span>
                      {selected && (
                        <Check className="size-4 shrink-0 text-[var(--ev-accent)]" aria-hidden />
                      )}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {query && cityRowCount === 0 && placeRowCount === 0 && (
            <p className="px-1 text-[12px] text-[var(--ev-muted)]">
              Nothing matches “{query}”.
            </p>
          )}

          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-[var(--ev-line)]" />
            <span className="text-[13px] text-[var(--ev-faint)]">or</span>
            <span className="h-px flex-1 bg-[var(--ev-line)]" />
          </div>

          <button
            type="button"
            onClick={locate}
            disabled={status === 'locating'}
            className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2.5 text-[15px] font-medium text-[var(--ev-text)] ring-1 ring-inset ring-[var(--ev-line-strong)] transition-colors hover:bg-[var(--ev-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] disabled:cursor-not-allowed disabled:opacity-70"
            style={{ borderRadius: '12px' }}
          >
            {status === 'locating' ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <Navigation className="size-4" aria-hidden />
            )}
            {status === 'locating' ? 'Finding you...' : 'Find my location'}
          </button>

          {/* aria-live: the geolocation prompt lives outside the page, so this
              is the only notice a screen reader user gets that it went wrong. */}
          <p aria-live="polite" className="sr-only">
            {status === 'locating' ? 'Finding your location' : ''}
          </p>
          {status !== 'idle' && status !== 'locating' && (
            <p className="px-1 text-[13px] text-[var(--ev-accent)]">{GEO_MESSAGES[status]}</p>
          )}
        </PopoverContent>
      </Popover>

      {isSet && (
        <button
          type="button"
          onClick={() => {
            onValueChange(ALL_CITIES)
            onOriginChange(null)
          }}
          aria-label="Clear location"
          className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--ev-muted)] transition-colors hover:bg-[var(--ev-card)] hover:text-[var(--ev-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] sm:size-7"
        >
          <X className="size-4 sm:size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}
