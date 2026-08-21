'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, LoaderCircle, MapPin, Navigation } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { PLACES, foldName, lookupCountry, nearestPlace, searchPlaces, type Place } from '@/lib/geo'

export interface SelectedLocation {
  city: string
  country: string
}

/**
 * Stedvelger for skjema — skjemautgaven av `components/public/location-picker`.
 *
 * Den offentlige velgeren er bygget for filtrering: den teller show per by,
 * har en «alle steder»-rad og skriver til en URL-parameter. Ingenting av det
 * gir mening i et registreringsskjema, så dette er en egen komponent i stedet
 * for enda et sett props på den andre.
 *
 * Rask fordi den må være det: `PLACES` er en lokal tabell på ~120 byer, så
 * hvert tastetrykk er et array-søk i minnet — ingen nettverkskall, ingen
 * debounce, ingen ventetid. Geolokasjon er det eneste som tar tid, og den er
 * frivillig.
 */
export function LocationField({
  value,
  onChange,
  id = 'location',
}: {
  value: SelectedLocation | null
  onChange: (location: SelectedLocation) => void
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'idle' | 'locating' | 'failed'>('idle')
  const [activeIndex, setActiveIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const aliveRef = useRef(true)
  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Uten søk vises et kort utvalg, ikke alle 120 — en liste du må scrolle
  // gjennom er ikke et bedre startpunkt enn å begynne å skrive.
  const rows = useMemo<Place[]>(
    () => (query.trim() ? searchPlaces(query, PLACES, 8) : PLACES.slice(0, 6)),
    [query]
  )

  const onQueryChange = (next: string) => {
    setQuery(next)
    setActiveIndex(0)
  }

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setQuery('')
      setStatus('idle')
      setActiveIndex(0)
    }
  }

  const select = (place: Place) => {
    onChange({ city: place.name, country: place.country })
    onOpenChange(false)
  }

  const locate = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('failed')
      return
    }

    setStatus('locating')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!aliveRef.current) return
        const place = nearestPlace({ lat: position.coords.latitude, lon: position.coords.longitude })
        setStatus('idle')
        if (place) select(place)
        else setStatus('failed')
      },
      () => {
        if (!aliveRef.current) return
        setStatus('failed')
      },
      // Bynivå holder, og den billige varianten er mye raskere.
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
      const place = rows[activeIndex]
      if (place) select(place)
    }
  }

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const countryName = value ? lookupCountry(value.country)?.name ?? value.country : null

  return (
    <>
      {/* Skjemaet postes som vanlig multipart-form, så verdien må ligge i DOM. */}
      <input type="hidden" name="city" value={value?.city ?? ''} />
      <input type="hidden" name="country" value={value?.country ?? ''} />

      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-label={value ? `Location: ${value.city}. Change` : 'Choose location'}
            className={cn(
              'flex h-11 w-full items-center gap-2 rounded-xl bg-[var(--ev-bg)] px-3.5 text-left text-[14px]',
              'outline-none ring-1 ring-inset ring-[var(--ev-line)] transition-[box-shadow]',
              'focus-visible:ring-2 focus-visible:ring-[var(--ev-accent-fill)]'
            )}
          >
            <MapPin className="size-4 shrink-0 text-[var(--ev-faint)]" aria-hidden />
            <span className={cn('min-w-0 flex-1 truncate', !value && 'text-[var(--ev-faint)]')}>
              {value ? `${value.city}, ${countryName}` : 'Select City'}
            </span>
            <ChevronDown
              className={cn('size-4 shrink-0 text-[var(--ev-faint)] transition-transform', open && 'rotate-180')}
              aria-hidden
            />
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 overflow-hidden rounded-2xl bg-[var(--ev-bg)] p-4 text-[var(--ev-text)] ring-1 ring-[var(--ev-line-strong)]"
          style={{ zIndex: 100 }}
        >
          <label htmlFor={`${id}-search`} className="sr-only">
            Search for a city
          </label>
          {/* 16px: alt mindre får iOS Safari til å zoome inn ved fokus. */}
          <input
            id={`${id}-search`}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls={`${id}-results`}
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="Search for a city..."
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-12 w-full shrink-0 rounded-xl bg-transparent px-4 text-[15px] outline-none ring-2 ring-inset ring-[var(--ev-line)] transition-[box-shadow] placeholder:text-[var(--ev-faint)] focus:ring-[var(--ev-accent-fill)]"
          />

          {rows.length > 0 && (
            <div
              id={`${id}-results`}
              ref={listRef}
              role="listbox"
              aria-label="Cities"
              className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"
            >
              {rows.map((place, index) => {
                const active = index === activeIndex
                const selected =
                  value != null &&
                  foldName(value.city) === foldName(place.name) &&
                  value.country === place.country

                return (
                  <button
                    key={`${place.country}:${place.name}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-active={active}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => select(place)}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                      active ? 'bg-[var(--ev-card-hover)]' : 'bg-transparent'
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{place.name}</span>
                      <span className="block truncate text-[12px] text-[var(--ev-faint)]">
                        {place.region} · {lookupCountry(place.country)?.name ?? place.country}
                      </span>
                    </span>
                    {selected && <Check className="size-4 shrink-0 text-[var(--ev-accent)]" aria-hidden />}
                  </button>
                )
              })}
            </div>
          )}

          {query.trim() && rows.length === 0 && (
            <p className="px-1 text-[12px] text-[var(--ev-muted)]">Nothing matches “{query}”.</p>
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
            className="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2.5 rounded-xl text-[15px] font-medium ring-1 ring-inset ring-[var(--ev-line-strong)] transition-colors hover:bg-[var(--ev-card)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ev-accent-fill)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {status === 'locating' ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
            ) : (
              <Navigation className="size-4" aria-hidden />
            )}
            {status === 'locating' ? 'Finding you...' : 'Find my location'}
          </button>

          {status === 'failed' && (
            <p className="px-1 text-[13px] text-[var(--ev-accent)]">
              Could not get your location. Search for a city instead.
            </p>
          )}
        </PopoverContent>
      </Popover>
    </>
  )
}
