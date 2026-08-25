'use client'

import { useId, useState } from 'react'
import type { EarningsMonth } from '@/lib/finances'
import { cn } from '@/lib/utils'

/**
 * Klubbens andel per måned.
 *
 * Én serie, så ingen forklaringsboks — overskriften sier hva som er plottet.
 * Verdien står bare på siste måned; resten leses av aksen eller ved å holde
 * over en stolpe. Tallene ligger også i en tabell for skjermlesere, slik at
 * ingenting er låst inne i grafikken.
 */

const HEIGHT = 168
const BAR_MAX_WIDTH = 24
const RADIUS = 4

function money(value: number, currency: string, compact = false) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
    notation: compact ? 'compact' : 'standard',
  }).format(value / 100)
}

/** Runder toppen opp til et lesbart tall, slik at aksen får hele trinn. */
function niceCeiling(value: number) {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / magnitude) * magnitude
}

export function EarningsChart({
  months,
  currency,
}: {
  months: EarningsMonth[]
  currency: string
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const tableId = useId()

  const max = Math.max(...months.map((month) => month.net), 0)
  const hasEarnings = max > 0
  const ceiling = niceCeiling(max)
  const active = months.find((month) => month.key === hovered) ?? null

  return (
    <figure className="m-0">
      <div className="relative">
        {/* Aksen står utenfor SVG-en, så tallene arver tekstfargen og
            skalerer med brukerens skriftstørrelse. */}
        <div className="flex">
          <div
            className="flex w-12 shrink-0 flex-col justify-between pr-2 text-right text-[10px] tabular-nums text-muted-foreground"
            style={{ height: HEIGHT }}
            aria-hidden
          >
            <span>{hasEarnings ? money(ceiling, currency, true) : ''}</span>
            <span>{hasEarnings ? money(ceiling / 2, currency, true) : ''}</span>
            <span>0</span>
          </div>

          <div className="relative flex-1">
            {/* Hårfine, heltrukne linjer ett steg fra flaten. */}
            <div className="absolute inset-0 flex flex-col justify-between" aria-hidden>
              <div className="h-px w-full bg-border" />
              <div className="h-px w-full bg-border" />
              <div className="h-px w-full bg-border" />
            </div>

            <div className="relative flex items-end justify-between gap-2" style={{ height: HEIGHT }}>
              {months.map((month, index) => {
                const isLast = index === months.length - 1
                const ratio = ceiling > 0 ? month.net / ceiling : 0
                const barHeight = month.net > 0 ? Math.max(ratio * HEIGHT, RADIUS) : 0

                return (
                  <div
                    key={month.key}
                    className="group relative flex h-full flex-1 items-end justify-center"
                    onMouseEnter={() => setHovered(month.key)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(month.key)}
                    onBlur={() => setHovered(null)}
                    tabIndex={0}
                    // Treffområdet er hele kolonnen, ikke bare stolpen — en
                    // måned uten salg må også kunne peiles på.
                    role="button"
                    aria-label={`${month.label}: ${money(month.net, currency)}, ${month.tickets} tickets`}
                  >
                    {barHeight > 0 ? (
                      <div
                        className="w-full transition-opacity"
                        style={{
                          maxWidth: BAR_MAX_WIDTH,
                          height: barHeight,
                          background: 'var(--chart-earnings)',
                          borderRadius: `${RADIUS}px ${RADIUS}px 0 0`,
                          opacity: hovered && hovered !== month.key ? 0.45 : 1,
                        }}
                      />
                    ) : (
                      <div
                        className="h-px w-full bg-border"
                        style={{ maxWidth: BAR_MAX_WIDTH }}
                        aria-hidden
                      />
                    )}

                    {/* Direkte etikett bare på siste måned. Et tall på hver
                        stolpe blir støy og leses ikke. */}
                    {isLast && month.net > 0 && !hovered && (
                      <span
                        className="pointer-events-none absolute -top-5 text-[11px] font-medium text-foreground"
                        style={{ bottom: barHeight + 6, top: 'auto' }}
                      >
                        {money(month.net, currency, true)}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="mt-2 flex pl-12">
          {months.map((month) => (
            <span
              key={month.key}
              className={cn(
                'flex-1 text-center text-[11px]',
                hovered === month.key ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {month.label}
            </span>
          ))}
        </div>

        {/* Verdien ved peking. Fast plass, så grafen ikke hopper. */}
        <p className="mt-3 min-h-5 text-xs text-muted-foreground" aria-hidden>
          {active ? (
            <>
              <span className="font-medium text-foreground">{money(active.net, currency)}</span>
              {' · '}
              {active.tickets} {active.tickets === 1 ? 'ticket' : 'tickets'} in {active.label}
            </>
          ) : hasEarnings ? (
            'Hover a month for the detail.'
          ) : (
            'No ticket sales yet — the first sale shows up here.'
          )}
        </p>
      </div>

      <table id={tableId} className="sr-only">
        <caption>Your share per month, after commission</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Your share</th>
            <th scope="col">Tickets</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month.key}>
              <th scope="row">{month.label}</th>
              <td>{money(month.net, currency)}</td>
              <td>{month.tickets}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
