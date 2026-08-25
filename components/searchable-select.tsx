'use client'

import { useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export type SelectOption = {
  value: string
  label: string
  /** Small muted text on the right of the row — a count, a hint. */
  hint?: string
}

/**
 * En select man kan søke i.
 *
 * Radix' `Select` er riktig for en håndfull faste valg, men ikke for en liste
 * med byer som vokser: da er søkefeltet forskjellen på ett tastetrykk og mye
 * rulling. Bygget på Popover framfor et nytt bibliotek — det er en knapp, et
 * felt og en liste.
 *
 * Søkefeltet vises først når lista er lang nok til å trenge det.
 */
export function SearchableSelect({
  id,
  value,
  options,
  onSelect,
  placeholder = 'Select',
  searchPlaceholder = 'Search',
  icon,
  searchThreshold = 8,
  className,
}: {
  /** Lets a `<Label htmlFor>` point at the trigger. */
  id?: string
  value: string
  options: SelectOption[]
  onSelect: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  icon?: React.ReactNode
  /** Under this many options the search field is just noise. */
  searchThreshold?: number
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const selected = options.find((option) => option.value === value)
  const showSearch = options.length >= searchThreshold

  const matches = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return options
    return options.filter((option) => option.label.toLowerCase().includes(text))
  }, [options, query])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger
        id={id}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-4xl border border-input bg-input/30 px-3.5 text-sm font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-expanded:bg-input/50',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-56 gap-0 p-1.5">
        {showSearch && (
          <div className="relative mb-1.5">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                listRef.current?.scrollTo({ top: 0 })
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-9 w-full rounded-2xl border bg-background pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}

        <div ref={listRef} className="max-h-64 overflow-y-auto">
          {matches.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matches.</p>
          ) : (
            matches.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onSelect(option.value)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint && <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>}
                {option.value === value && <Check className="size-4 shrink-0" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
