'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { FIELD_ADDON_CLASS, FIELD_HINT_CLASS, FIELD_TRIGGER_CLASS } from '@/components/admin/form-fields'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  CURRENCIES,
  currencyMatches,
  findCurrency,
  formatCurrencyLabel,
  normalizeCurrency,
} from '@/lib/currencies'
import { cn } from '@/lib/utils'

/**
 * Currency picker with search.
 *
 * Som lokasjonsfeltet ligger selve verdien i et skjult felt utenfor popoveren:
 * Radix flytter innholdet ut av skjemaet i DOM-en, og et felt som havner der
 * blir aldri sendt med.
 *
 * Symbolet står i et eget felt-segment foran, som `/events/` og valutaen i
 * Show details, så navnet begynner på samme sted som teksten i de andre feltene.
 */
export function CurrencyField({
  value,
  className,
}: {
  value: string | null
  /** Kolonnene feltet tar i `FieldSection`-rutenettet. */
  className?: string
}) {
  const fieldId = useId()
  const labelId = `${fieldId}-label`
  const valueId = `${fieldId}-value`
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
    <Field className={cn('col-span-12 min-w-0 gap-1.5', className)}>
      <input type="hidden" name="currency" value={selected} />

      <FieldLabel id={labelId} htmlFor={fieldId}>
        Currency
      </FieldLabel>

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
            aria-labelledby={`${labelId} ${valueId}`}
            className={cn(FIELD_TRIGGER_CLASS, 'items-stretch gap-0 overflow-hidden p-0')}
          >
            <span aria-hidden className={cn(FIELD_ADDON_CLASS, 'w-11 justify-center border-r px-0')}>
              {current?.symbol}
            </span>
            <span className="flex min-w-0 flex-1 items-center px-3">
              <span id={valueId} className="truncate">
                {current ? formatCurrencyLabel(current) : selected}
              </span>
            </span>
            <span aria-hidden className="flex shrink-0 items-center pr-3 text-muted-foreground">
              <ChevronDown className="size-4" />
            </span>
          </button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] rounded-xl gap-0 p-0">
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter picks the top match. The form below must not be
                // submitted by a keypress here.
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
              placeholder="Search by currency or code"
              aria-label="Search currencies"
              className="h-10 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
            />
          </div>

          {matches.length === 0 ? (
            <p className="px-3.5 py-6 text-center text-sm text-muted-foreground">
              No currency matches “{query}”.
            </p>
          ) : (
            <ul ref={listRef} className="max-h-64 overflow-y-auto p-1.5">
              {matches.map((currency) => {
                const active = currency.code === selected

                return (
                  <li key={currency.code}>
                    <button
                      type="button"
                      onClick={() => choose(currency.code)}
                      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted"
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

      <FieldDescription className={FIELD_HINT_CLASS}>Default currency for new shows in the club.</FieldDescription>
    </Field>
  )
}
