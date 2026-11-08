'use client'

import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { enGB } from 'date-fns/locale'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { parseIsoDate, type TimeRange } from '@/lib/event-filters'
import { cn } from '@/lib/utils'

/**
 * EKSPERIMENTELL (branch experimental/landing-v2) — ikke merge til main.
 *
 * «When»: snarveier øverst (i kveld, helgen …) og kalenderen under — samme
 * kalender som «Pick a date» på tickethalo.com. Dager med show er markert, og
 * dager som har vært er låst.
 */
export const QUICK: Array<{ value: TimeRange; label: string }> = [
  { value: 'all', label: 'Anytime' },
  { value: 'tonight', label: 'Tonight' },
  { value: 'this-weekend', label: 'This weekend' },
  { value: 'this-month', label: 'This month' },
]

export function whenLabel(range: TimeRange, date: Date | undefined) {
  if (date) return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  return QUICK.find((q) => q.value === range)?.label ?? 'Anytime'
}

export function WhenPicker({
  range,
  date,
  today,
  showDates,
  onRange,
  onDate,
}: {
  range: TimeRange
  date: Date | undefined
  today: string
  /** YYYY-MM-DD for every day that has at least one show. */
  showDates: string[]
  onRange: (range: TimeRange) => void
  onDate: (date: Date | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const todayDate = parseIsoDate(today)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex h-14 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-[20px] px-3 text-left sm:gap-3 sm:rounded-full sm:px-4 transition-colors hover:bg-black/[0.04] data-[state=open]:bg-black/[0.05]">
        <CalendarDays className="size-5 shrink-0 text-[var(--ev-accent-fill)]" aria-hidden />
        <span className="flex min-w-0 flex-col">
          <span className="text-[11px] font-bold uppercase tracking-wide text-black/45">When</span>
          <span className="truncate text-[15px] font-semibold text-black">{whenLabel(range, date)}</span>
        </span>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={10}
        collisionPadding={12}
        className="w-[min(340px,calc(100vw-24px))] gap-0 rounded-3xl bg-white p-0 text-black"
      >
        <div className="flex flex-wrap gap-1.5 border-b border-black/[0.07] p-3">
          {QUICK.map((q) => {
            const on = !date && range === q.value
            return (
              <button
                key={q.value}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  onDate(undefined)
                  onRange(q.value)
                  setOpen(false)
                }}
                className={cn(
                  'cursor-pointer rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors',
                  on ? 'bg-[var(--ev-text)] text-[var(--ev-bg)]' : 'bg-black/[0.05] text-black/70 hover:bg-black/[0.09]'
                )}
              >
                {q.label}
              </button>
            )
          })}
        </div>
        <Calendar
          mode="single"
          selected={date}
          defaultMonth={date ?? todayDate}
          onSelect={(value) => {
            onDate(value)
            if (value) {
              onRange('all')
              setOpen(false)
            }
          }}
          disabled={{ before: todayDate }}
          modifiers={{ hasShow: showDates.map(parseIsoDate) }}
          modifiersClassNames={{
            hasShow:
              "relative after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-[var(--ev-accent-fill)] after:content-['']",
          }}
          locale={enGB}
          // 40px dager: en tommel treffer, og sju av dem får plass på 320px.
          className="mx-auto bg-white [--cell-size:--spacing(10)]"
        />
        <p className="flex items-center gap-1.5 px-4 pb-3 text-[12px] text-black/50">
          <span className="size-1.5 rounded-full bg-[var(--ev-accent-fill)]" aria-hidden /> Days with shows
        </p>
      </PopoverContent>
    </Popover>
  )
}
