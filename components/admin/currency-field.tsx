'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  CURRENCIES,
  currencyMatches,
  findCurrency,
  formatCurrencyLabel,
  normalizeCurrency,
} from '@/lib/currencies'

/**
 * Valutavelger med søk.
 *
 * Som lokasjonsfeltet ligger selve verdien i et skjult felt utenfor popoveren:
 * Radix flytter innholdet ut av skjemaet i DOM-en, og et felt som havner der
 * blir aldri sendt med.
 */
export function CurrencyField({ value }: { value: string | null }) {
  const fieldId = useId()
  const [selected, setSelected] = useState(() => normalizeCurrency(value))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLUListElement>(null)

  const current = findCurrency(selected)
  const matches = useMemo(
    () => CURRENCIES.filter((currency) => currencyMatches(currency, query)),
    [query],
  )

  function choose(code: string) {
    setSelected(code)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name="currency" value={selected} />

      <label htmlFor={fieldId} className="text-sm font-medium text-foreground">
        Valuta
      </label>

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <PopoverTrigger asChild>
          <button
            id={fieldId}
            type="button"
            className="flex h-11 w-full items-center gap-2.5 rounded-2xl bg-zinc-100/80 px-4 text-left text-sm transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20"
          >
            <span className="w-6 shrink-0 text-center text-muted-foreground">{current?.symbol}</span>
            <span className="flex-1 truncate">{current ? formatCurrencyLabel(current) : selected}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] gap-0 p-0">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-3.5">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter velger det øverste treffet. Skjemaet under skal ikke
                // sendes inn av et tastetrykk her.
                if (event.key === 'Enter') {
                  event.preventDefault()
                  if (matches.length > 0) choose(matches[0].code)
                  return
                }

                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  listRef.current?.querySelector('button')?.focus()
                }
              }}
              placeholder="Søk på valuta eller kode"
              className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {matches.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-sm text-muted-foreground">
              Ingen valuta matcher «{query}».
            </p>
          ) : (
            <ul ref={listRef} className="max-h-64 overflow-y-auto p-2">
              {matches.map((currency) => {
                const active = currency.code === selected

                return (
                  <li key={currency.code}>
                    <button
                      type="button"
                      onClick={() => choose(currency.code)}
                      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none"
                    >
                      <span className="w-6 shrink-0 text-center text-muted-foreground">{currency.symbol}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{currency.name}</span>
                        <span className="block text-xs text-muted-foreground">{currency.code}</span>
                      </span>
                      {active && <Check className="size-4 shrink-0" aria-hidden />}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      <p className="text-xs text-muted-foreground">Standardvaluta for nye show i klubben.</p>
    </div>
  )
}
