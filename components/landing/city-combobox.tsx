'use client'

import { useMemo, useRef, useState } from 'react'
import { Check, MapPin, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { foldName } from '@/lib/geo'
import { cn } from '@/lib/utils'

/**
 * EKSPERIMENTELL (branch experimental/landing-v2) — ikke merge til main.
 *
 * Søkbar byvelger. Listen er byene som faktisk har show, med antall — så et
 * valg aldri gir en tom side. Søket bretter æ/ø/å og aksenter, så «tromso»
 * finner Tromsø. Piltaster og Enter virker som i en vanlig kombinasjonsboks.
 */
export type CityCount = { city: string; count: number }

export function CityCombobox({
  options,
  total,
  value,
  onChange,
}: {
  options: CityCount[]
  total: number
  /** '' = all cities */
  value: string
  onChange: (city: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const rows = useMemo(() => {
    const needle = foldName(query.trim())
    const matches = needle ? options.filter((o) => foldName(o.city).includes(needle)) : options
    return needle ? matches : [{ city: '', count: total }, ...matches]
  }, [options, query, total])

  const pick = (city: string) => {
    onChange(city)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setActive(0)
        else setQuery('')
      }}
    >
      <PopoverTrigger className="flex h-14 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-[20px] px-3 text-left sm:gap-3 sm:rounded-full sm:px-4 transition-colors hover:bg-black/[0.04] data-[state=open]:bg-black/[0.05]">
        <MapPin className="size-5 shrink-0 text-[var(--ev-accent-fill)]" aria-hidden />
        <span className="flex min-w-0 flex-col">
          <span className="text-[11px] font-bold uppercase tracking-wide text-black/45">Where</span>
          <span className="truncate text-[15px] font-semibold text-black">{value || 'All cities'}</span>
        </span>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={10}
        collisionPadding={12}
        className="w-[min(340px,calc(100vw-24px))] gap-0 overflow-hidden rounded-3xl bg-white p-0 text-black"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-black/[0.07] px-4">
          <Search className="size-4 shrink-0 text-black/40" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => Math.min(i + 1, rows.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter' && rows[active]) {
                e.preventDefault()
                pick(rows[active].city)
              }
            }}
            placeholder="Search for a city"
            aria-label="Search for a city"
            role="combobox"
            aria-expanded
            aria-controls="city-options"
            aria-activedescendant={rows[active] ? `city-opt-${active}` : undefined}
            className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-black/40"
          />
        </div>

        <ul id="city-options" role="listbox" aria-label="Cities" className="max-h-72 overflow-y-auto p-1.5">
          {rows.length === 0 ? (
            <li className="px-3 py-6 text-center text-[14px] text-black/55">
              No shows in &ldquo;{query.trim()}&rdquo; yet.
            </li>
          ) : (
            rows.map((row, i) => {
              const selected = row.city === value
              return (
                <li
                  key={row.city || 'all'}
                  id={`city-opt-${i}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(row.city)}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-[15px]',
                    i === active && 'bg-black/[0.05]'
                  )}
                >
                  <span className={cn('flex items-center gap-2', selected && 'font-semibold')}>
                    {selected ? (
                      <Check className="size-4 text-[var(--ev-accent-fill)]" aria-hidden />
                    ) : (
                      <span className="size-4" aria-hidden />
                    )}
                    {row.city || 'All cities'}
                  </span>
                  <span className="text-[13px] tabular-nums text-black/45">
                    {row.count} {row.count === 1 ? 'show' : 'shows'}
                  </span>
                </li>
              )
            })
          )}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
